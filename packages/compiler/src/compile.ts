import type {
  CandidateWorkflow,
  LlmPort,
  Selector,
  Step,
  StepAction,
  Variable,
  WorkflowIR,
} from '@workflowos/core';
import { WORKFLOW_IR_VERSION, aggregateRisk, hashId } from '@workflowos/core';
import type { SessionTokens } from '@workflowos/discovery';
import { alignCandidate, type AlignedStep } from './steps.js';
import { buildBinding } from './bindings.js';
import { classifyRisk, isDataEntryStep, isLookupStep, toStepAction } from './risk.js';
import { preferredTiers } from './tiers.js';
import { buildConditions, buildLookupVariable, buildOutputVariable, extractVariables, lookupVariableName } from './variables.js';
import { heuristicLabel, interpret } from './intent.js';

export interface CompileOptions {
  candidate: CandidateWorkflow;
  streams: readonly SessionTokens[];
  llm: LlmPort;
  now: number;
  /** Overrides the generated workflow id; defaults to a content hash. */
  workflowId?: string;
  /** Retries granted to every generated step. */
  retries?: number;
  timeoutMs?: number;
}

export const DEFAULT_STEP_TIMEOUT_MS = 20_000;

/**
 * Compiles a discovered candidate into the workflow the user will be asked to
 * approve.
 *
 * The split of responsibility matters: the model supplies only the
 * human-facing interpretation (name, intent, trigger, step labels), while
 * bindings, variables, risk classification, and tier preferences are computed
 * from the observation itself. A model that hallucinates cannot invent a
 * selector, an input variable, or a risk level.
 */
export async function compileCandidate(options: CompileOptions): Promise<WorkflowIR> {
  const { candidate, streams, llm, now } = options;
  const workflowId = options.workflowId ?? hashId('wf', candidate.id);

  const aligned = alignCandidate(
    candidate.tokenSequence,
    streams,
    candidate.occurrences.map((o) => ({
      sessionId: o.sessionId,
      startIndex: o.startIndex,
      endIndex: o.endIndex,
    })),
  ).filter((s) => s.representative.action.type !== 'idle');

  const interpretation = await interpret(
    llm,
    {
      steps: aligned,
      appChain: candidate.appChain,
      occurrenceCount: candidate.occurrences.length,
      tokens: candidate.tokenSequence,
    },
    `interpret:${candidate.id}`,
  );

  const steps = buildSteps(aligned, workflowId, interpretation.stepLabels, options);
  const variables = collectVariables(aligned, steps);
  const conditions = buildConditions(steps);

  return {
    version: WORKFLOW_IR_VERSION,
    id: workflowId,
    name: interpretation.name,
    intent: interpretation.intent,
    traceIds: candidate.traceIds,
    trigger: interpretation.trigger,
    variables,
    steps,
    conditions,
    risk: aggregateRisk(steps),
    status: 'candidate',
    candidateId: candidate.id,
    degraded: interpretation.degraded,
    createdAt: now,
    updatedAt: now,
    reliability: 0,
    revision: 1,
  };
}

function buildSteps(
  aligned: readonly AlignedStep[],
  workflowId: string,
  labels: readonly string[],
  options: CompileOptions,
): Step[] {
  const steps: Step[] = [];

  for (const alignedStep of aligned) {
    const event = alignedStep.representative;
    if (toStepAction(event.action.type) === 'wait') continue;
    const { binding, confidence, evidence } = buildBinding(alignedStep.events);
    const action = normalizeAction(toStepAction(event.action.type), event.element?.name);
    const risk = classifyRisk(action, event.element?.name, event.app.id);
    const hasApiCandidate = (binding.selectorCandidates ?? []).some((s) => s.strategy === 'api');

    const inputs: Record<string, string> = {};
    if (isDataEntryStep(action, event.element?.name)) inputs.field = '{{input}}';
    if (binding.urlPattern) inputs.destination = binding.urlPattern;

    const outputs: Record<string, string> = {};
    if (isLookupStep(action, event.element?.name)) {
      outputs.recordId = lookupVariableName(binding);
    }
    if (action === 'download') {
      outputs.attachmentPath = 'attachmentPath';
    }

    const label =
      labels[alignedStep.index] && labels.length === aligned.length
        ? labels[alignedStep.index]
        : labels[steps.length] ?? heuristicLabel(event);

    steps.push({
      id: hashId('step', workflowId, alignedStep.index),
      action,
      label,
      target: binding,
      inputs,
      outputs: Object.keys(outputs).length > 0 ? outputs : undefined,
      risk,
      resolveTier: preferredTiers(binding.appKind, hasApiCandidate),
      confidence,
      evidence,
      timeoutMs: options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
      retries: options.retries ?? 1,
      sourceTokenIndex: alignedStep.index,
    });
  }

  return steps;
}

/**
 * A click on a control literally named "Send" is a send, not a click, and a
 * click on "Download attachment" is a download.
 *
 * Adapters dispatch on the action, so the API tier for a messaging app needs to
 * know the difference between clicking "Send" and clicking "Cancel", and the
 * app-integration tier can only claim an attachment fetch if the step says it
 * wants one. The normalisation is narrow on purpose: it fires for one
 * unambiguous control name, never for a guess about intent.
 */
function normalizeAction(action: StepAction, elementName: string | undefined): StepAction {
  const name = (elementName ?? '').trim();
  if (action === 'click' && /^(send|send message|post message)$/i.test(name)) {
    return 'send';
  }
  if (action === 'click' && /^(download|download attachment|save attachment|export)$/i.test(name)) {
    return 'download';
  }
  return action;
}

function collectVariables(aligned: readonly AlignedStep[], steps: Step[]): Variable[] {  const extraction = extractVariables(aligned);
  const variables = [...extraction.variables];

  // Rename the generic `{{input}}` template to the variable that actually feeds
  // that step, so the generated workflow has no unresolved placeholders.
  for (const step of steps) {
    if (step.inputs.field !== '{{input}}') continue;
    const alignedIndex = step.sourceTokenIndex;
    const variableName = extraction.byStepIndex.get(alignedIndex);
    if (!variableName) {
      delete step.inputs.field;
      continue;
    }
    step.inputs.field = `{{${variableName}}}`;
  }

  for (const step of steps) {
    for (const output of Object.values(step.outputs ?? {})) {
      if (variables.some((v) => v.name === output)) continue;
      // Identifier-shaped outputs are lookups other steps depend on, so they
      // get a named variable; a downloaded artefact is just a path the step
      // produced and is declared under its own name.
      variables.push(/id$/i.test(output) ? buildLookupVariable(step.target, step.id) : buildOutputVariable(step, output));
    }
  }

  propagatePayloads(steps);

  return variables;
}

/**
 * A send/submit step consumes whatever was most recently typed.
 *
 * Without this, the API tier would have no way to know the message body: the
 * user typed it into a field one step earlier, exactly as they would have done
 * by hand. The compiler states that dependency explicitly instead of leaving
 * the adapter to guess.
 */
function propagatePayloads(steps: Step[]): void {
  let lastField: string | undefined;
  for (const step of steps) {
    if (step.inputs.field) lastField = step.inputs.field;
    if (step.action !== 'send' && step.action !== 'submit') continue;
    if (lastField) step.inputs.payload = lastField;
  }
}

export async function compileCandidates(
  candidates: readonly CandidateWorkflow[],
  streams: readonly SessionTokens[],
  llm: LlmPort,
  now: number,
): Promise<WorkflowIR[]> {
  const out: WorkflowIR[] = [];
  for (const candidate of candidates) {
    out.push(await compileCandidate({ candidate, streams, llm, now }));
  }
  return out;
}

/** Selector weights learned from a successful healing run. */
export function promoteSelector(step: Step, healed: Selector): Step {
  const existing = step.target.selectorCandidates.map((s) =>
    selectorEqual(s, healed) ? { ...s, weight: Math.min(1, s.weight + 0.2), evidence: 'boosted by healing' } : s,
  );
  const known = existing.some((s) => selectorEqual(s, healed));
  return {
    ...step,
    target: {
      ...step.target,
      selectorCandidates: known
        ? existing.sort((a, b) => b.weight - a.weight)
        : [...existing, { ...healed, weight: 0.9, evidence: 'learned by healing' }],
    },
    confidence: Math.min(1, step.confidence + 0.1),
  };
}

export function demoteTier(step: Step, failedTier: string): Step {
  const order = [...step.resolveTier];
  const index = order.indexOf(failedTier as Step['resolveTier'][number]);
  if (index < 0 || index === order.length - 1) return step;
  order.splice(index, 1);
  order.splice(index + 1, 0, failedTier as Step['resolveTier'][number]);
  return { ...step, resolveTier: order };
}

function selectorEqual(a: Selector, b: Selector): boolean {
  return (
    a.strategy === b.strategy &&
    a.role === b.role &&
    a.name === b.name &&
    a.testId === b.testId &&
    a.value === b.value
  );
}
