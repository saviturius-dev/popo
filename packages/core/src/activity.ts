/**
 * Domain types for the observation half of the pipeline.
 *
 * Everything downstream of `ActivityEvent` is derived deterministically, so these
 * types are intentionally flat and JSON-serialisable: they are written to SQLite,
 * replayed from fixtures, and sent to the LLM as compact context.
 */

export type AppKind = 'web' | 'desktop' | 'system';

export interface AppRef {
  /** Stable identifier, e.g. `chrome`, `outlook`, `slack`. */
  id: string;
  name: string;
  kind: AppKind;
}

export type ActionType =
  | 'launch'
  | 'focus'
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'download'
  | 'copy'
  | 'submit'
  | 'keypress'
  | 'idle';

export type SelectorStrategy =
  | 'role-name'
  | 'css'
  | 'text'
  | 'uia'
  | 'testid'
  | 'api';

export interface Selector {
  strategy: SelectorStrategy;
  role?: string;
  name?: string;
  /** Text or label pattern the target is expected to contain. */
  textPattern?: string;
  value?: string;
  testId?: string;
  /** Relative weight in [0, 1]; higher is tried first. */
  weight: number;
  /** Where this candidate came from, for explainability in the dashboard. */
  evidence?: string;
}

export interface ElementRef {
  role?: string;
  name?: string;
  text?: string;
  selectorCandidates?: Selector[];
}

export interface EventTarget {
  url?: string;
  windowTitle?: string;
  framePath?: string;
}

export interface EventValue {
  text?: string;
  /** Set when the producing source knows the value must not leave the machine. */
  sensitive?: boolean;
}

export type ActivitySourceKind = 'replay' | 'generator' | 'capture';

export interface ActivityEvent {
  id: string;
  /** Monotonic within a single source run. */
  seq: number;
  /** Milliseconds since epoch. */
  ts: number;
  app: AppRef;
  target?: EventTarget;
  action: { type: ActionType };
  element?: ElementRef;
  value?: EventValue;
  source: ActivitySourceKind;
  /** Fixture persona/scenario label, present for replayed and generated traces. */
  scenario?: string;
  /** Marks the event as belonging to a sensitive flow; redacted at ingest. */
  sensitive?: boolean;
}

export type PlaceholderKind = 'id' | 'email' | 'url' | 'num' | 'date' | 'text' | 'path';

export interface Placeholder {
  /** Stable placeholder name used in tokens and templates, e.g. `v_email_1`. */
  name: string;
  kind: PlaceholderKind;
  /** Concrete observed value, redacted if the event was sensitive. */
  example: string;
  /** 0..1 heuristic confidence that this slot is a real variable. */
  confidence: number;
}

export interface NormalizedEvent {
  event: ActivityEvent;
  token: string;
  placeholders: Placeholder[];
  /**
   * The single variable this event contributes, if any.
   *
   * A typed value can contain several placeholder spans ("order <num> for
   * <email>"), but it is still one thing the user typed and therefore one
   * workflow input. `primary` collapses that to the variable the compiler
   * should declare, while `placeholders` keeps the detail for the UI.
   */
  primary?: Placeholder;
  /** Fraction of the event's textual surface replaced by placeholders. */
  volatility: number;
}

export interface Session {
  id: string;
  traceId: string;
  startTs: number;
  endTs: number;
  eventIds: string[];
  appChain: string[];
}

export interface Occurrence {
  sessionId: string;
  /** Index of the first token of this occurrence inside its session. */
  startIndex: number;
  /** Index one past the last token of this occurrence. */
  endIndex: number;
  eventIds: string[];
  startTs: number;
  endTs: number;
  /** Placeholder examples collected from this single occurrence. */
  placeholders: Placeholder[];
  /** 0..1, how closely this occurrence matched the candidate's token sequence. */
  similarity: number;
}

export interface ScoreBreakdown {
  support: number;
  duration: number;
  crossAppTransitions: number;
  consistency: number;
  noisePenalty: number;
  total: number;
}

export interface CandidateWorkflow {
  id: string;
  traceIds: string[];
  tokenSequence: string[];
  occurrences: Occurrence[];
  appChain: string[];
  score: ScoreBreakdown;
}
