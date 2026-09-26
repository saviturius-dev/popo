import type {
  ActivityEvent,
  ActivitySource,
  CandidateWorkflow,
  EventPublisher,
  LlmPort,
  PipelineProgress,
  RedactionPolicy,
  WorkflowIR,
} from '@workflowos/core';
import { hashId, redactEvents } from '@workflowos/core';
import { discover } from '@workflowos/discovery';
import { compileCandidate } from '@workflowos/compiler';
import type { Store } from '@workflowos/store';

export interface PipelineDeps {
  store: Store;
  bus: EventPublisher;
  llm: LlmPort;
}

export interface PipelineOptions {
  /** Minimum occurrences before a candidate is even considered. */
  minSupport?: number;
  /** Minimum total score to surface a candidate for approval. */
  minScore?: number;
  idleGapMs?: number;
  redaction?: RedactionPolicy;
  /** Overrides the generated workflow id; useful for deterministic tests. */
  workflowIdFor?: (candidate: CandidateWorkflow) => string;
}

export interface PipelineResult {
  progress: PipelineProgress;
  candidates: CandidateWorkflow[];
  workflows: WorkflowIR[];
  redactedCount: number;
}

/**
 * Observe -> Understand -> Detect Repetition -> Generate Workflow -> Approval.
 *
 * The pipeline never auto-approves: it ends by creating review requests, and
 * the Automation Engine only ever sees workflows a human has accepted.
 */
export async function runPipeline(
  deps: PipelineDeps,
  source: ActivitySource,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const traceId = source.traceId;
  const startedAt = Date.now();
  const progress: PipelineProgress = {
    traceId,
    stage: 'ingest',
    eventsIngested: 0,
    candidates: 0,
    startedAt,
  };
  const save = (patch: Partial<PipelineProgress>) => {
    Object.assign(progress, patch);
    deps.store.discovery.saveProgress(progress);
    deps.bus.publish({ type: 'progress', payload: { ...progress } });
  };

  try {
    // 1. Observe
    save({ stage: 'ingest' });
    const raw: ActivityEvent[] = [];
    await source.start((event) => {
      raw.push(event);
      progress.eventsIngested = raw.length;
    });
    const { events, redactedCount } = redactEvents(raw, options.redaction);
    deps.store.events.insertMany(events, traceId);
    deps.bus.publish({ type: 'event.ingested', traceId, count: events.length });
    save({ stage: 'sessionize', eventsIngested: events.length });

    // 2 + 3. Detect repetition
    const rejections = deps.store.feedback
      .list(500)
      .filter((f) => f.kind === 'reject').length;
    const discovery = discover(events, {
      traceId,
      minSupport: options.minSupport ?? 3,
      idleGapMs: options.idleGapMs,
      rejections,
    });
    deps.store.discovery.replaceSessions(traceId, discovery.sessions);
    deps.store.discovery.replaceCandidates(traceId, discovery.candidates);
    save({ stage: 'compile', candidates: discovery.candidates.length });

    // 4 + 5. Generate and request approval
    const minScore = options.minScore ?? 0.3;
    const surfaced = discovery.candidates.filter((c) => c.score.total >= minScore);
    const workflows: WorkflowIR[] = [];

    for (const candidate of surfaced) {
      const existing = deps.store.workflows
        .list()
        .find((w) => w.candidateId === candidate.id && w.status !== 'archived');
      if (existing) {
        workflows.push(existing);
        continue;
      }
      const workflow = await compileCandidate({
        candidate,
        streams: discovery.streams,
        llm: deps.llm,
        now: Date.now(),
        workflowId: options.workflowIdFor?.(candidate) ?? hashId('wf', candidate.id),
      });
      deps.store.workflows.upsert(workflow, 'compiler');
      deps.store.reviews.insert({
        id: `rev_wf_${workflow.id}`,
        kind: 'workflow-approval',
        workflowId: workflow.id,
        candidateId: candidate.id,
        createdAt: Date.now(),
        risk: workflow.risk,
        message: `WorkFlowOS found a repeated workflow: "${workflow.name}" (${candidate.occurrences.length} occurrences). Approve to automate it?`,
        payload: {
          name: workflow.name,
          intent: workflow.intent,
          risk: workflow.risk,
          degraded: workflow.degraded,
          occurrences: candidate.occurrences.length,
          score: candidate.score,
          appChain: candidate.appChain,
        },
      });
      deps.bus.publish({
        type: 'review.created',
        requestId: `rev_wf_${workflow.id}`,
        kind: 'workflow-approval',
        workflowId: workflow.id,
      });
      deps.bus.publish({ type: 'candidate.found', candidateId: candidate.id, traceId });
      workflows.push(workflow);
    }

    save({ stage: 'done', finishedAt: Date.now() });
    return { progress, candidates: discovery.candidates, workflows, redactedCount };
  } catch (cause) {
    save({
      stage: 'failed',
      finishedAt: Date.now(),
      error: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
  }
}
