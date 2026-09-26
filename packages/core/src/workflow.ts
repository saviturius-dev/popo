import type { Selector } from './activity.js';

export const WORKFLOW_IR_VERSION = 1;

export type WorkflowStatus = 'candidate' | 'approved' | 'rejected' | 'archived';
export type Risk = 'read' | 'write' | 'irreversible';

export type StepAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'download'
  | 'submit'
  | 'send'
  | 'api-call'
  | 'wait';

export type Tier =
  | 'api'
  | 'app-integration'
  | 'web-semantic'
  | 'desktop-uia'
  | 'browser-automation'
  | 'cv-fallback'
  | 'unsupported';

export const TIER_ORDER: readonly Tier[] = [
  'api',
  'app-integration',
  'web-semantic',
  'desktop-uia',
  'browser-automation',
  'cv-fallback',
];

export interface TargetBinding {
  appId: string;
  appKind: 'web' | 'desktop' | 'system';
  urlPattern?: string;
  windowTitlePattern?: string;
  /** Ordered candidates; the resolver tries them in weight order. */
  selectorCandidates: Selector[];
  /** Resource identifier when the target is data rather than UI, e.g. a CRM record id. */
  resourceHint?: string;
}

export interface Variable {
  name: string;
  description: string;
  /** Where in the observed sequence the value was captured. */
  inferredFrom: string;
  type: 'string' | 'number' | 'email' | 'url' | 'date' | 'boolean';
  required: boolean;
  /** Up to three redacted example values, for the dashboard. */
  examples: string[];
  confidence: number;
}

export interface Condition {
  id: string;
  /** Human readable, e.g. "customer not found in CRM". */
  description: string;
  when: { variable?: string; literal?: string };
  operator: 'equals' | 'not_equals' | 'empty' | 'not_empty' | 'contains' | 'gt' | 'lt';
  /** Guard target: the step the condition is evaluated before. */
  stepId: string;
  onFail: 'stop' | 'skip' | 'escalate';
  /** Message surfaced to the user when the guard trips. */
  message?: string;
}

export interface Step {
  id: string;
  action: StepAction;
  /** Human readable label shown in the approval view. */
  label: string;
  target: TargetBinding;
  /** Values are templates; `{{varName}}` is substituted at run time. */
  inputs: Record<string, string>;
  /** Values this step produces, declared so later steps can reference them. */
  outputs?: Record<string, string>;
  risk: Risk;
  /** Ordered tier preference; the resolver picks the first available adapter. */
  resolveTier: Tier[];
  /** 0..1 agreement across occurrences on the top selector. */
  confidence: number;
  evidence: string[];
  timeoutMs: number;
  retries: number;
  /** Index into the originating candidate's token sequence. */
  sourceTokenIndex: number;
}

export type TriggerType = 'event' | 'manual' | 'schedule';

export interface Trigger {
  type: TriggerType;
  /** Human description, always shown to the user before approval. */
  description: string;
  eventMatch?: { appId?: string; action?: string; urlPattern?: string; subjectContains?: string };
  cron?: string;
}

export interface WorkflowIR {
  version: number;
  id: string;
  /** Short gerund name, e.g. "Process Customer Request". */
  name: string;
  intent: string;
  traceIds: string[];
  trigger: Trigger;
  variables: Variable[];
  steps: Step[];
  conditions: Condition[];
  risk: Risk;
  status: WorkflowStatus;
  /** Candidate this IR was compiled from, for traceability. */
  candidateId: string;
  /** True when the LLM was unavailable and heuristics produced the result. */
  degraded: boolean;
  createdAt: number;
  updatedAt: number;
  /** Empirically observed reliability in [0, 1], maintained by the learning loop. */
  reliability: number;
  /** Bumped on every user edit; runs always reference a concrete version. */
  revision: number;
}

export function aggregateRisk(steps: readonly Step[]): Risk {
  if (steps.some((s) => s.risk === 'irreversible')) return 'irreversible';
  if (steps.some((s) => s.risk === 'write')) return 'write';
  return 'read';
}
