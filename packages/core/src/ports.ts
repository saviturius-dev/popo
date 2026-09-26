import type { z } from 'zod';
import type { ActivityEvent, AppKind, Selector } from './activity.js';
import type { Step, Tier } from './workflow.js';

/* ------------------------------------------------------------------ ingest */

export type EventSink = (event: ActivityEvent) => void | Promise<void>;

export interface IngestWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * The single seam through which observed activity enters the system.
 *
 * v1 ships `ReplaySource` and `GeneratorSource`. A future Windows implementation
 * (UIAutomation event subscribers + Win32 hooks) implements this same interface
 * and nothing downstream changes.
 */
export interface ActivitySource {
  readonly kind: ActivityEvent['source'];
  readonly traceId: string;
  /**
   * Resolves once the source has finished emitting (or been stopped). The
   * resolved value is source-specific (a replay returns counts) and is ignored
   * by the pipeline, which only cares that it settled.
   */
  start(sink: EventSink, onWarning?: (w: IngestWarning) => void): Promise<unknown>;
  stop(): void;
}

/* --------------------------------------------------------------------- llm */

export interface LlmRequest<S extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: S;
  maxTokens?: number;
  /** Set by the caller to make fixture-driven runs reproducible. */
  fixtureKey?: string;
}

export interface LlmResponse<T> {
  value: T;
  provider: string;
  model: string;
  degraded: boolean;
  /** Set when `degraded` is true and a heuristic fallback produced the value. */
  fallbackReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmPort {
  readonly name: string;
  complete<S extends z.ZodTypeAny, T = z.infer<S>>(request: LlmRequest<S>): Promise<LlmResponse<T>>;
}

/* --------------------------------------------------------------- execution */

export interface AdapterAvailability {
  available: boolean;
  reason?: string;
}

export interface StepExecutionResult {
  outputs: Record<string, string>;
  resolvedSelector?: Selector;
  /** True when the binding had to be healed from the live target. */
  healed?: boolean;
  /** Extra data for the run log, e.g. the endpoint that was called. */
  detail?: string;
}

export interface ExecutionEnvironment {
  runId: string;
  signal: AbortSignal;
  /** Base URL for a registered app/integration, when one exists. */
  resolveEndpoint(appId: string): string | undefined;
  /** Human-in-the-loop gate for write and irreversible steps. */
  confirm(step: Step, context: { tier: Tier; detail?: string }): Promise<boolean>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Record a value a step produced, so later steps can consume it. */
  setOutput(stepId: string, key: string, value: string): void;
}

export interface AutomationAdapter {
  readonly tier: Tier;
  readonly appKinds: readonly AppKind[];
  /**
   * App ids this adapter can serve at all, checked before the tier is even
   * considered. Integrations declare it so the runner can promote `api` and
   * `app-integration` to the front of the preference order for those apps.
   */
  handlesApp?(appId: string): boolean;
  isAvailable(step: Step, env: ExecutionEnvironment): Promise<AdapterAvailability>;
  execute(
    step: Step,
    inputs: Record<string, string>,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult>;
  dispose?(): Promise<void>;
}

export interface BindingHealer {
  /**
   * Re-resolve a target from the live application when the recorded selector
   * candidates all fail. Bounded to a single attempt; ambiguity is escalated
   * rather than guessed.
   */
  heal(step: Step, env: ExecutionEnvironment): Promise<Selector | null>;
}

/* -------------------------------------------------------------- publishing */

export type BusEvent =
  | { type: 'event.ingested'; traceId: string; count: number }
  | { type: 'progress'; payload: unknown }
  | { type: 'candidate.found'; candidateId: string; traceId: string }
  | { type: 'review.created'; requestId: string; kind: string; workflowId?: string }
  | { type: 'review.resolved'; requestId: string; resolution: string }
  | { type: 'workflow.changed'; workflowId: string; status: string; revision: number }
  | { type: 'run.started'; runId: string; workflowId: string }
  | { type: 'run.step'; runId: string; stepId: string; status: string; tier: Tier }
  | { type: 'run.finished'; runId: string; status: string }
  | { type: 'log'; runId: string; level: string; message: string };

export interface EventPublisher {
  publish(event: BusEvent): void;
  subscribe(listener: (event: BusEvent) => void): () => void;
}

/* ------------------------------------------------------------------- clock */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
