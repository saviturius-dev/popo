export type ErrorStage =
  | 'ingest'
  | 'discovery'
  | 'compile'
  | 'store'
  | 'execute'
  | 'bind'
  | 'tier'
  | 'llm'
  | 'api';

export class WorkflowOsError extends Error {
  readonly stage: ErrorStage;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    stage: ErrorStage,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'WorkflowOsError';
    this.stage = stage;
    this.code = code;
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      stage: this.stage,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export const errors = {
  ingest(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('ingest', code, message, details);
  },
  discovery(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('discovery', code, message, details);
  },
  compile(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('compile', code, message, details);
  },
  store(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('store', code, message, details);
  },
  execution(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('execute', code, message, details);
  },
  binding(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('bind', code, message, details);
  },
  tier(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('tier', code, message, details);
  },
  llm(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('llm', code, message, details);
  },
  api(code: string, message: string, details?: Record<string, unknown>) {
    return new WorkflowOsError('api', code, message, details);
  },
};
