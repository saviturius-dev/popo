import type {
  ActivitySource,
  Clock,
  EventBus,
  LlmPort,
  RunRecord,
  Selector,
  WorkflowIR,
} from '@workflowos/core';
import { EventBus as Bus, createIdFactory, errors, systemClock } from '@workflowos/core';
import { openDb, Store } from '@workflowos/store';
import { selectLlm } from '@workflowos/llm';
import { createDefaultRegistry, setKnownAppIds, WorkflowRunner, type DefaultEngine } from '@workflowos/execution';
import { ReviewBroker, type ReviewAnswer } from './confirmBroker.js';
import { runPipeline, type PipelineOptions, type PipelineResult } from './pipeline.js';
import { learnFromRun, type LearningReport } from './learn.js';

export interface OrchestratorOptions {
  dbFile?: string;
  llm?: LlmPort;
  headless?: boolean;
  enableUia?: boolean;
  downloadDir?: string;
  clock?: Clock;
  reviewTimeoutMs?: number;
}

export interface StartRunInput {
  workflowId: string;
  variables?: Record<string, string>;
  endpoints?: Record<string, string>;
}

export interface RunSummary {
  run: RunRecord;
  learning?: LearningReport;
}

/**
 * Wires the seven stages together and owns the only two pieces of global state
 * that matter: which run is active, and which endpoints integrations may use.
 *
 * Runs are strictly serialised. Two automations driving the same browser
 * profile or the same mock app concurrently would produce results nobody could
 * interpret, so the second request is queued rather than raced.
 */
export class Orchestrator {
  readonly store: Store;
  readonly bus: EventBus;
  readonly llm: LlmPort;
  readonly engine: DefaultEngine;
  readonly runner: WorkflowRunner;
  readonly broker: ReviewBroker;
  private readonly clock: Clock;
  private readonly nextRunId = createIdFactory('run');
  private endpoints: Record<string, string> = {};
  private activeRunId?: string;

  private constructor(options: OrchestratorOptions) {
    this.clock = options.clock ?? systemClock;
    this.store = new Store(openDb({ file: options.dbFile }));
    this.bus = new Bus();
    this.llm = options.llm ?? selectLlm();
    this.engine = createDefaultRegistry({
      headless: options.headless ?? true,
      enableUia: options.enableUia ?? false,
      downloadDir: options.downloadDir,
    });
    this.broker = new ReviewBroker(this.store, this.bus, {
      timeoutMs: options.reviewTimeoutMs,
    });
    this.runner = new WorkflowRunner({
      registry: this.engine.registry,
      broker: this.broker,
      pool: this.engine.pool,
      publisher: this.bus,
      clock: this.clock,
      onUpdate: (run) => {
        this.store.runs.update(run);
      },
    });
  }

  static create(options: OrchestratorOptions = {}): Orchestrator {
    return new Orchestrator(options);
  }

  /** appId -> live base URL. Integrations are only reachable through this map. */
  registerEndpoints(endpoints: Record<string, string>): void {
    this.endpoints = { ...this.endpoints, ...endpoints };
    setKnownAppIds(Object.keys(this.endpoints));
  }

  getEndpoints(): Record<string, string> {
    return { ...this.endpoints };
  }

  async ingest(source: ActivitySource, options?: PipelineOptions): Promise<PipelineResult> {
    return runPipeline({ store: this.store, bus: this.bus, llm: this.llm }, source, options);
  }

  /** Approves a candidate workflow and records the user's decision. */
  approveWorkflow(workflowId: string): WorkflowIR {
    const now = this.clock.now();
    const workflow = this.store.workflows.setStatus(workflowId, 'approved', now);
    this.store.reviews.resolve(`rev_wf_${workflowId}`, 'approved', now);
    this.store.feedback.insert({
      id: `fb_apr_${workflowId}_${now}`,
      kind: 'approve',
      workflowId,
      createdAt: now,
      appliedEffects: ['workflow approved'],
    });
    this.bus.publish({
      type: 'workflow.changed',
      workflowId,
      status: 'approved',
      revision: workflow.revision,
    });
    this.bus.publish({ type: 'review.resolved', requestId: `rev_wf_${workflowId}`, resolution: 'approved' });
    return workflow;
  }

  rejectWorkflow(workflowId: string, note?: string): WorkflowIR {
    const now = this.clock.now();
    const workflow = this.store.workflows.setStatus(workflowId, 'rejected', now);
    this.store.reviews.resolve(`rev_wf_${workflowId}`, 'rejected', now);
    // A rejection is a training signal for the scorer: this pattern should stop
    // competing with the ones the user kept.
    const weight = this.store.feedback.addWeight(0.15);
    this.store.feedback.insert({
      id: `fb_rej_${workflowId}_${now}`,
      kind: 'reject',
      workflowId,
      createdAt: now,
      note,
      appliedEffects: [`scorer rejection weight -> ${weight}`],
    });
    this.bus.publish({
      type: 'workflow.changed',
      workflowId,
      status: 'rejected',
      revision: workflow.revision,
    });
    this.bus.publish({ type: 'review.resolved', requestId: `rev_wf_${workflowId}`, resolution: 'rejected' });
    return workflow;
  }

  /** User edits produce a new revision rather than mutating history. */
  updateWorkflow(workflowId: string, patch: Partial<WorkflowIR>): WorkflowIR {
    const current = this.store.workflows.get(workflowId);
    if (!current) {
      throw errors.api('workflow_not_found', `No workflow with id ${workflowId}`, { workflowId });
    }
    const next: WorkflowIR = {
      ...current,
      ...patch,
      id: current.id,
      revision: current.revision + 1,
      updatedAt: this.clock.now(),
    };
    const saved = this.store.workflows.upsert(next, 'user:edit');
    this.bus.publish({
      type: 'workflow.changed',
      workflowId,
      status: saved.status,
      revision: saved.revision,
    });
    return saved;
  }

  async startRun(input: StartRunInput): Promise<RunSummary> {
    const workflow = this.store.workflows.get(input.workflowId);
    if (!workflow) {
      throw errors.api('workflow_not_found', `No workflow with id ${input.workflowId}`, {
        workflowId: input.workflowId,
      });
    }
    if (workflow.status !== 'approved') {
      throw errors.api(
        'not_approved',
        'Only approved workflows can be executed; approve it first',
        { workflowId: input.workflowId, status: workflow.status },
      );
    }

    const runId = this.nextRunId();
    const request = { workflow, runId, variables: input.variables ?? {}, endpoints: input.endpoints ?? this.endpoints };

    if (this.activeRunId) {
      throw errors.api(
        'run_in_progress',
        `Run ${this.activeRunId} is still in progress; runs are serialised`,
        { activeRunId: this.activeRunId },
      );
    }
    return this.execute(request);
  }

  private async execute(request: {
    workflow: WorkflowIR;
    runId: string;
    variables: Record<string, string>;
    endpoints: Record<string, string>;
  }): Promise<RunSummary> {
    this.activeRunId = request.runId;
    try {
      const outcome = await this.runner.run(request);
      this.store.runs.update(outcome.run);
      const learning = learnFromRun(this.store, request.workflow, outcome, this.clock.now());
      return { run: outcome.run, learning };
    } finally {
      this.activeRunId = undefined;
    }
  }

  abortRun(runId: string, reason?: string): boolean {
    const stopped = this.runner.abort(runId, reason);
    if (stopped) this.broker.cancelForRun(runId, reason);
    return stopped;
  }

  respondToReview(reviewId: string, answer: ReviewAnswer): boolean {
    return this.broker.respond(reviewId, answer);
  }

  isBusy(): boolean {
    return this.activeRunId !== undefined;
  }

  activeRun(): string | undefined {
    return this.activeRunId;
  }

  async close(): Promise<void> {
    await this.engine.dispose();
    this.store.close();
  }
}

export type { Selector };
