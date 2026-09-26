import type { Selector } from './activity.js';
import type { Risk, Tier, WorkflowIR } from './workflow.js';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting-confirmation'
  | 'awaiting-binding'
  | 'succeeded'
  | 'failed'
  | 'aborted';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'aborted';

export interface StepRun {
  stepId: string;
  /** Copied from the step at run time so the journal stays readable on its own. */
  label: string;
  tier: Tier;
  attempts: number;
  status: StepStatus;
  resolvedSelector?: Selector;
  /** Binding that was healed during this step, if any. */
  healedSelector?: Selector;
  error?: string;
  durationMs: number;
  startedAt: number;
  endedAt?: number;
  /** Values the step produced, e.g. an extracted record id. */
  outputs: Record<string, string>;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowRevision: number;
  workflowName: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  steps: StepRun[];
  abortReason?: string;
  error?: string;
  /** Log lines streamed to the dashboard while the run was in flight. */
  log: RunLogEntry[];
  /** Steps whose side effects had already landed when the run stopped. */
  partialEffects: string[];
}

export interface RunLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type ReviewRequestKind =
  | 'workflow-approval'
  | 'step-confirmation'
  | 'binding-confirmation'
  | 'workflow-edit';

export interface ReviewRequest {
  id: string;
  kind: ReviewRequestKind;
  /** Workflow the request belongs to; for binding requests this is the running workflow. */
  workflowId?: string;
  candidateId?: string;
  runId?: string;
  stepId?: string;
  risk?: Risk;
  createdAt: number;
  resolvedAt?: number;
  resolution?: 'approved' | 'rejected' | 'confirmed' | 'cancelled';
  payload: Record<string, unknown>;
  message: string;
}

export type FeedbackKind = 'approve' | 'reject' | 'edit' | 'abort' | 'binding-heal' | 'correction';

export interface Feedback {
  id: string;
  kind: FeedbackKind;
  workflowId?: string;
  candidateId?: string;
  runId?: string;
  /** Free-form note from the user, e.g. "step 3 is optional". */
  note?: string;
  createdAt: number;
  /** Pipeline-level effect applied by the learning loop. */
  appliedEffects: string[];
}

export interface PipelineProgress {
  traceId: string;
  stage: 'ingest' | 'sessionize' | 'mine' | 'score' | 'compile' | 'done' | 'failed';
  eventsIngested: number;
  candidates: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export function emptyRun(
  id: string,
  workflow: WorkflowIR,
  now: number,
): RunRecord {
  return {
    id,
    workflowId: workflow.id,
    workflowRevision: workflow.revision,
    workflowName: workflow.name,
    startedAt: now,
    status: 'queued',
    steps: workflow.steps.map((s) => ({
      stepId: s.id,
      label: s.label,
      tier: 'unsupported' as Tier,
      attempts: 0,
      status: 'pending' as const,
      durationMs: 0,
      startedAt: now,
      outputs: {},
    })),
    log: [],
    partialEffects: [],
  };
}
