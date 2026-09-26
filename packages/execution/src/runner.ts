import type {
  Clock,
  EventPublisher,
  RunRecord,
  Selector,
  Step,
  StepRun,
  Tier,
  WorkflowIR,
} from '@workflowos/core';
import { WorkflowOsError, emptyRun, systemClock } from '@workflowos/core';
import { renderInputs } from './outputs.js';
import { evaluateConditions } from './outputs.js';
import { resolveTier, type TierRegistry } from './tierResolver.js';
import type { BrowserPool } from './browserPool.js';

export interface ConfirmationRequest {
  kind: 'step' | 'binding' | 'mechanism' | 'condition';
  runId: string;
  workflowId: string;
  step?: Step;
  stepId?: string;
  tier?: Tier;
  risk?: Step['risk'];
  message: string;
  detail?: string;
  candidates?: unknown[];
}

/**
 * The human-in-the-loop gate.
 *
 * Implementations turn these calls into review requests the user can answer
 * from the dashboard. The runner never resolves a gate on its own.
 */
export interface ConfirmationBroker {
  confirmStep(request: ConfirmationRequest): Promise<boolean>;
  confirmBinding(request: ConfirmationRequest & { candidates: unknown[] }): Promise<Selector | null>;
}

export interface RunRequest {
  workflow: WorkflowIR;
  variables?: Record<string, string>;
  runId: string;
  /** appId -> live base URL, e.g. `{ gmail: 'http://127.0.0.1:41234' }`. */
  endpoints?: Record<string, string>;
}

export interface TierChoice {
  stepId: string;
  tier: Tier;
  considered: { tier: Tier; available: boolean; reason?: string }[];
}

export interface RunOutcome {
  run: RunRecord;
  tierChoices: TierChoice[];
  /** Selectors that had to be healed; the learning loop boosts their weights. */
  healedSelectors: { stepId: string; selector: Selector }[];
  /** Tiers that failed, in order, so a flaky mechanism can be demoted. */
  failedTiers: { stepId: string; tier: Tier }[];
}

export interface RunnerDeps {
  registry: TierRegistry;
  broker: ConfirmationBroker;
  pool?: BrowserPool;
  publisher?: EventPublisher;
  clock?: Clock;
  onUpdate?: (run: RunRecord) => void | Promise<void>;
}

/**
 * Executes an approved workflow, one step at a time, with the user's approval
 * as a gate rather than a formality.
 *
 * Ordering of concerns is deliberate: conditions are checked before the step
 * runs, risk is confirmed before any side effect, and an unresolvable binding
 * escalates instead of guessing. Every decision is journalled so the dashboard
 * can replay what happened.
 */
export class WorkflowRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly deps: RunnerDeps;
  private readonly clock: Clock;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
  }

  abort(runId: string, reason = 'aborted by user'): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    this.abortReasons.set(runId, reason);
    controller.abort();
    return true;
  }

  private readonly abortReasons = new Map<string, string>();

  async run(request: RunRequest): Promise<RunOutcome> {
    const { workflow, runId } = request;
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    this.activeEndpoints.set(runId, { ...(request.endpoints ?? {}) });

    const run = emptyRun(runId, workflow, this.clock.now());
    run.status = 'running';
    const variables: Record<string, string> = { ...(request.variables ?? {}) };
    const tierChoices: TierChoice[] = [];
    const healedSelectors: RunOutcome['healedSelectors'] = [];
    const failedTiers: RunOutcome['failedTiers'] = [];

    const log = (level: 'info' | 'warn' | 'error', message: string) => {
      run.log.push({ ts: this.clock.now(), level, message });
      this.deps.publisher?.publish({ type: 'log', runId, level, message });
    };

    const persist = async () => {
      await this.deps.onUpdate?.(structuredClone(run));
    };

    this.deps.publisher?.publish({ type: 'run.started', runId, workflowId: workflow.id });
    log('info', `Run started for "${workflow.name}" (revision ${workflow.revision})`);
    await persist();

    for (let index = 0; index < workflow.steps.length; index++) {
      const step = workflow.steps[index];
      const stepRun = run.steps.find((s) => s.stepId === step.id);
      if (!stepRun) continue;

      if (controller.signal.aborted) {
        stepRun.status = 'aborted';
        run.status = 'aborted';
        run.abortReason = this.abortReasons.get(runId) ?? 'aborted';
        break;
      }

      // 1. Guards, before anything observable happens.
      const outcomes = evaluateConditions(workflow.conditions, step.id, variables);
      const failure = outcomes.find((o) => o.action === 'fail');
      if (failure && failure.condition.onFail !== 'skip') {
        const escalate = failure.condition.onFail === 'escalate';
        run.status = escalate ? 'awaiting-confirmation' : 'failed';
        log('warn', failure.condition.message ?? failure.condition.description);
        const proceed = escalate
          ? await this.deps.broker.confirmStep({
              kind: 'condition',
              runId,
              workflowId: workflow.id,
              step,
              message:
                failure.condition.message ??
                `Guard failed: ${failure.condition.description}`,
            })
          : false;
        if (!proceed) {
          run.status = escalate ? 'failed' : 'failed';
          run.error = failure.condition.message ?? failure.condition.description;
          stepRun.status = 'skipped';
          stepRun.error = run.error;
          markRemaining(run, workflow, index + 1, 'skipped');
          break;
        }
        log('info', 'User confirmed the guard was resolved; continuing');
        run.status = 'running';
      }

      // 2. Mechanism, most reliable first.
      let resolution;
      try {
        resolution = await resolveTier(step, this.deps.registry, this.env(run, variables, log));
      } catch (cause) {
        if (cause instanceof WorkflowOsError && cause.code === 'no_mechanism') {
          const proceed = await this.deps.broker.confirmStep({
            kind: 'mechanism',
            runId,
            workflowId: workflow.id,
            step,
            message: `No mechanism can perform "${step.label}". Run this step manually?`,
            detail: JSON.stringify(cause.details.considered ?? []),
          });
          if (!proceed) {
            stepRun.status = 'failed';
            stepRun.error = cause.message;
            run.status = 'failed';
            run.error = cause.message;
            markRemaining(run, workflow, index + 1, 'skipped');
            break;
          }
          stepRun.status = 'skipped';
          this.deps.publisher?.publish({ type: 'run.step', runId, stepId: step.id, status: 'skipped', tier: 'unsupported' });
          continue;
        }
        throw cause;
      }

      const tier = resolution.tier;
      stepRun.tier = tier;
      tierChoices.push({ stepId: step.id, tier, considered: resolution.considered });
      log('info', `Step ${index + 1}/${workflow.steps.length} "${step.label}" via ${tier}`);
      this.deps.publisher?.publish({ type: 'run.step', runId, stepId: step.id, status: 'running', tier });
      await persist();

      // 3. Human gate for anything that changes the world.
      if (step.risk !== 'read') {
        const approved = await this.deps.broker.confirmStep({
          kind: 'step',
          runId,
          workflowId: workflow.id,
          step,
          tier,
          risk: step.risk,
          message: `${step.risk === 'irreversible' ? 'This step cannot be undone: ' : 'This step changes data: '}"${step.label}"`,
          detail: `Mechanism: ${tier}`,
        });
        if (!approved) {
          stepRun.status = 'aborted';
          run.status = 'aborted';
          run.abortReason = `user declined "${step.label}"`;
          markRemaining(run, workflow, index + 1, 'skipped');
          log('warn', run.abortReason);
          break;
        }
      }

      // 4. Execute, with a single bounded healing attempt on binding failure.
      stepRun.status = 'running';
      stepRun.startedAt = this.clock.now();
      const started = this.clock.now();
      const inputs = renderInputs(step.inputs, variables);
      let lastError: unknown;

      for (let attempt = 0; attempt <= step.retries; attempt++) {
        stepRun.attempts = attempt + 1;
        try {
          const result = await resolution.adapter!.execute(step, inputs, this.env(run, variables, log));
          stepRun.status = 'succeeded';
          stepRun.resolvedSelector = result.resolvedSelector;
          if (result.healed) stepRun.healedSelector = undefined;
          stepRun.outputs = result.outputs;
          mergeOutputs(variables, step, result.outputs);
          if (result.detail) log('info', result.detail);
          if (step.risk !== 'read') run.partialEffects.push(`${step.id}: ${step.label}`);
          lastError = undefined;
          break;
        } catch (cause) {
          lastError = cause;
          const isBinding = cause instanceof WorkflowOsError && cause.stage === 'bind';
          if (isBinding) {
            const candidates = (cause.details.candidates as unknown[]) ?? [];
            const choice = await this.deps.broker.confirmBinding({
              kind: 'binding',
              runId,
              workflowId: workflow.id,
              step,
              tier,
              message: `Could not uniquely resolve "${step.label}". Choose the right target, or take over manually.`,
              candidates,
            });
            if (choice) {
              stepRun.healedSelector = choice;
              healedSelectors.push({ stepId: step.id, selector: choice });
              const patched: Step = {
                ...step,
                target: {
                  ...step.target,
                  selectorCandidates: [
                    { ...choice, weight: 1 },
                    ...step.target.selectorCandidates.filter(
                      (s) => !(s.role === choice.role && s.name === choice.name),
                    ),
                  ],
                },
              };
              try {
                const result = await resolution.adapter!.execute(patched, inputs, this.env(run, variables, log));
                stepRun.status = 'succeeded';
                stepRun.resolvedSelector = choice;
                stepRun.outputs = result.outputs;
                mergeOutputs(variables, step, result.outputs);
                if (result.detail) log('info', result.detail);
                if (step.risk !== 'read') run.partialEffects.push(`${step.id}: ${step.label}`);
                lastError = undefined;
                break;
              } catch (retryCause) {
                lastError = retryCause;
              }
            }
          } else {
            failedTiers.push({ stepId: step.id, tier });
          }
          log('error', `Attempt ${attempt + 1} for "${step.label}" failed: ${describe(cause)}`);
        }
      }

      stepRun.endedAt = this.clock.now();
      stepRun.durationMs = stepRun.endedAt - started;
      if (lastError) {
        stepRun.status = 'failed';
        stepRun.error = describe(lastError);
        run.status = 'failed';
        run.error = `${step.label}: ${describe(lastError)}`;
        markRemaining(run, workflow, index + 1, 'skipped');
        this.deps.publisher?.publish({ type: 'run.step', runId, stepId: step.id, status: 'failed', tier });
        await persist();
        break;
      }

      this.deps.publisher?.publish({ type: 'run.step', runId, stepId: step.id, status: 'succeeded', tier });
      await persist();
    }

    if (run.status === 'running') run.status = 'succeeded';
    run.endedAt = this.clock.now();
    this.controllers.delete(runId);
    this.abortReasons.delete(runId);
    this.activeEndpoints.delete(runId);
    await this.deps.pool?.closeRun(runId);

    log('info', `Run ${run.status}`);
    this.deps.publisher?.publish({ type: 'run.finished', runId, status: run.status });
    await persist();

    return { run, tierChoices, healedSelectors, failedTiers };
  }

  private env(
    run: RunRecord,
    variables: Record<string, string>,
    log: (level: 'info' | 'warn' | 'error', message: string) => void,
  ) {
    const controller = this.controllers.get(run.id);
    const endpoints = this.endpointsFor(run.id);
    return {
      runId: run.id,
      signal: controller?.signal ?? new AbortController().signal,
      resolveEndpoint: (appId: string) => endpoints[appId],
      confirm: async (step: Step, context: { tier: Tier; detail?: string }) =>
        this.deps.broker.confirmStep({
          kind: 'step',
          runId: run.id,
          workflowId: '',
          step,
          tier: context.tier,
          message: `Allow "${step.label}"?`,
          detail: context.detail,
        }),
      log,
      setOutput: (stepId: string, key: string, value: string) => {
        variables[key] = value;
        const stepRun = run.steps.find((s) => s.stepId === stepId);
        if (stepRun) stepRun.outputs[key] = value;
      },
    };
  }

  private readonly activeEndpoints = new Map<string, Record<string, string>>();

  private endpointsFor(runId: string): Record<string, string> {
    return this.activeEndpoints.get(runId) ?? {};
  }
}

function markRemaining(run: RunRecord, workflow: WorkflowIR, fromIndex: number, status: StepRun['status']): void {
  for (let i = fromIndex; i < workflow.steps.length; i++) {
    const stepRun = run.steps.find((s) => s.stepId === workflow.steps[i].id);
    if (stepRun && stepRun.status === 'pending') stepRun.status = status;
  }
}

/**
 * Publishes a step's outputs under both their own key and the variable name the
 * workflow declared for them, so a guard written against `v_record_id` sees the
 * value an adapter reported as `recordId`.
 */
function mergeOutputs(
  variables: Record<string, string>,
  step: Step,
  outputs: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(outputs)) {
    variables[key] = value;
    const declared = step.outputs?.[key];
    if (declared) variables[declared] = value;
  }
}

function describe(cause: unknown): string {
  if (cause instanceof WorkflowOsError) return `${cause.code}: ${cause.message}`;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
