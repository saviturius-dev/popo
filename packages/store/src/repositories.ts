import type {
  ActivityEvent,
  CandidateWorkflow,
  Feedback,
  PipelineProgress,
  ReviewRequest,
  RunRecord,
  Session,
  StepRun,
  WorkflowIR,
  WorkflowStatus,
} from '@workflowos/core';
import { errors } from '@workflowos/core';
import type { Db } from './db.js';

const J = (v: unknown): string => JSON.stringify(v);
const P = <T>(v: string): T => JSON.parse(v) as T;

/* ------------------------------------------------------------------ events */

export class EventRepository {
  constructor(private readonly db: Db) {}

  insertMany(events: readonly ActivityEvent[], traceId: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO events
        (id, trace_id, seq, ts, app_id, app_name, app_kind, action, url, window_title,
         role, name, text, value_text, selectors, sensitive, scenario, source, payload)
      VALUES
        (@id, @traceId, @seq, @ts, @appId, @appName, @appKind, @action, @url, @windowTitle,
         @role, @name, @text, @valueText, @selectors, @sensitive, @scenario, @source, @payload)
    `);
    const tx = this.db.transaction((rows: ActivityEvent[]) => {
      for (const e of rows) {
        stmt.run({
          id: e.id,
          traceId,
          seq: e.seq,
          ts: e.ts,
          appId: e.app.id,
          appName: e.app.name,
          appKind: e.app.kind,
          action: e.action.type,
          url: e.target?.url ?? null,
          windowTitle: e.target?.windowTitle ?? null,
          role: e.element?.role ?? null,
          name: e.element?.name ?? null,
          text: e.element?.text ?? null,
          valueText: e.value?.text ?? null,
          selectors: e.element?.selectorCandidates ? J(e.element.selectorCandidates) : null,
          sensitive: e.sensitive ? 1 : 0,
          scenario: e.scenario ?? null,
          source: e.source,
          payload: J(e),
        });
      }
    });
    tx([...events]);
  }

  listByTrace(traceId: string): ActivityEvent[] {
    return this.db
      .prepare<{ payload: string }>(
        'SELECT payload FROM events WHERE trace_id = ? ORDER BY seq ASC',
      )
      .all(traceId)
      .map((r) => P<ActivityEvent>(r.payload));
  }

  listAll(): ActivityEvent[] {
    return this.db
      .prepare<{ payload: string }>('SELECT payload FROM events ORDER BY trace_id ASC, seq ASC')
      .all()
      .map((r) => P<ActivityEvent>(r.payload));
  }

  traceIds(): string[] {
    return this.db
      .prepare<{ trace_id: string }>('SELECT DISTINCT trace_id FROM events ORDER BY trace_id')
      .all()
      .map((r) => r.trace_id);
  }

  countByTrace(traceId: string): number {
    const row = this.db
      .prepare<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE trace_id = ?')
      .get(traceId);
    return row?.n ?? 0;
  }
}

/* --------------------------------------------------------------- discovery */

export class DiscoveryRepository {
  constructor(private readonly db: Db) {}

  replaceSessions(traceId: string, sessions: readonly Session[]): void {
    const del = this.db.prepare('DELETE FROM sessions WHERE trace_id = ?');
    const ins = this.db.prepare(`
      INSERT INTO sessions (id, trace_id, start_ts, end_ts, event_ids, app_chain)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      del.run(traceId);
      for (const s of sessions) {
        ins.run(s.id, traceId, s.startTs, s.endTs, J(s.eventIds), J(s.appChain));
      }
    });
    tx();
  }

  listSessions(traceId?: string): Session[] {
    const rows = traceId
      ? this.db
          .prepare<{ id: string; trace_id: string; start_ts: number; end_ts: number; event_ids: string; app_chain: string }>(
            'SELECT * FROM sessions WHERE trace_id = ? ORDER BY start_ts ASC',
          )
          .all(traceId)
      : this.db
          .prepare<{ id: string; trace_id: string; start_ts: number; end_ts: number; event_ids: string; app_chain: string }>(
            'SELECT * FROM sessions ORDER BY start_ts ASC',
          )
          .all();
    return rows.map((r) => ({
      id: r.id,
      traceId: r.trace_id,
      startTs: r.start_ts,
      endTs: r.end_ts,
      eventIds: P<string[]>(r.event_ids),
      appChain: P<string[]>(r.app_chain),
    }));
  }

  replaceCandidates(traceId: string, candidates: readonly CandidateWorkflow[]): void {
    const del = this.db.prepare('DELETE FROM candidates WHERE trace_id = ?');
    const ins = this.db.prepare(`
      INSERT OR REPLACE INTO candidates (id, trace_id, token_seq, occurrences, app_chain, score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    const tx = this.db.transaction(() => {
      del.run(traceId);
      for (const c of candidates) {
        ins.run(
          c.id,
          traceId,
          J(c.tokenSequence),
          J(c.occurrences),
          J(c.appChain),
          J(c.score),
          now,
        );
      }
    });
    tx();
  }

  listCandidates(traceId?: string): CandidateWorkflow[] {
    const rows = traceId
      ? this.db
          .prepare<any>('SELECT * FROM candidates WHERE trace_id = ? ORDER BY id')
          .all(traceId)
      : this.db.prepare<any>('SELECT * FROM candidates ORDER BY id').all();
    return rows.map((r) => ({
      id: r.id,
      traceIds: [r.trace_id],
      tokenSequence: P<string[]>(r.token_seq),
      occurrences: P<CandidateWorkflow['occurrences']>(r.occurrences),
      appChain: P<string[]>(r.app_chain),
      score: P<CandidateWorkflow['score']>(r.score),
    }));
  }

  saveProgress(progress: PipelineProgress): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO pipeline_progress
          (trace_id, stage, events_ingested, candidates, started_at, finished_at, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        progress.traceId,
        progress.stage,
        progress.eventsIngested,
        progress.candidates,
        progress.startedAt,
        progress.finishedAt ?? null,
        progress.error ?? null,
      );
  }

  listProgress(): PipelineProgress[] {
    return this.db
      .prepare<any>('SELECT * FROM pipeline_progress ORDER BY started_at DESC')
      .all()
      .map((r) => ({
        traceId: r.trace_id,
        stage: r.stage,
        eventsIngested: r.events_ingested,
        candidates: r.candidates,
        startedAt: r.started_at,
        finishedAt: r.finished_at ?? undefined,
        error: r.error ?? undefined,
      }));
  }
}

/* ---------------------------------------------------------------- workflows */

export class WorkflowRepository {
  constructor(private readonly db: Db) {}

  upsert(ir: WorkflowIR, changedBy = 'system'): WorkflowIR {
    const existing = this.get(ir.id);
    if (!existing) {
      this.db
        .prepare(`
          INSERT INTO workflows (id, candidate_id, status, revision, reliability, ir, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(ir.id, ir.candidateId, ir.status, ir.revision, ir.reliability, J(ir), ir.createdAt, ir.updatedAt);
    } else {
      this.db
        .prepare(`
          UPDATE workflows SET candidate_id = ?, status = ?, revision = ?, reliability = ?, ir = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          ir.candidateId,
          ir.status,
          ir.revision,
          ir.reliability,
          J(ir),
          ir.updatedAt,
          ir.id,
        );
    }
    this.db
      .prepare(`
        INSERT OR REPLACE INTO workflow_versions (workflow_id, revision, ir, changed_at, changed_by)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(ir.id, ir.revision, J(ir), ir.updatedAt, changedBy);
    return ir;
  }

  get(id: string): WorkflowIR | null {
    const row = this.db.prepare<{ ir: string }>('SELECT ir FROM workflows WHERE id = ?').get(id);
    return row ? P<WorkflowIR>(row.ir) : null;
  }

  list(status?: WorkflowStatus): WorkflowIR[] {
    const rows = status
      ? this.db
          .prepare<{ ir: string }>('SELECT ir FROM workflows WHERE status = ? ORDER BY updated_at DESC')
          .all(status)
      : this.db.prepare<{ ir: string }>('SELECT ir FROM workflows ORDER BY updated_at DESC').all();
    return rows.map((r) => P<WorkflowIR>(r.ir));
  }

  setStatus(id: string, status: WorkflowStatus, now: number): WorkflowIR {
    const ir = this.get(id);
    if (!ir) {
      throw errors.store('workflow_not_found', `No workflow with id ${id}`, { id });
    }
    const next: WorkflowIR = {
      ...ir,
      status,
      revision: ir.revision + 1,
      updatedAt: now,
    };
    return this.upsert(next, `status:${status}`);
  }

  setReliability(id: string, reliability: number, now: number): WorkflowIR {
    const ir = this.get(id);
    if (!ir) {
      throw errors.store('workflow_not_found', `No workflow with id ${id}`, { id });
    }
    const next: WorkflowIR = {
      ...ir,
      reliability: Math.max(0, Math.min(1, reliability)),
      updatedAt: now,
    };
    this.db.prepare('UPDATE workflows SET reliability = ? WHERE id = ?').run(next.reliability, id);
    this.db
      .prepare(
        'INSERT OR REPLACE INTO workflow_versions (workflow_id, revision, ir, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, next.revision, J(next), now, 'learn:reliability');
    return next;
  }

  /** Selector weights learned from healing are written back onto the steps. */
  saveSteps(ir: WorkflowIR, now: number, changedBy = 'learn:binding'): WorkflowIR {
    const next = { ...ir, updatedAt: now };
    this.db.prepare('UPDATE workflows SET ir = ?, updated_at = ? WHERE id = ?').run(J(next), now, ir.id);
    this.db
      .prepare(
        'INSERT OR REPLACE INTO workflow_versions (workflow_id, revision, ir, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(ir.id, next.revision, J(next), now, changedBy);
    return next;
  }

  versions(id: string): { revision: number; changedAt: number; changedBy: string }[] {
    return this.db
      .prepare<any>('SELECT revision, changed_at, changed_by FROM workflow_versions WHERE workflow_id = ? ORDER BY revision')
      .all(id)
      .map((r) => ({ revision: r.revision, changedAt: r.changed_at, changedBy: r.changed_by }));
  }
}

/* --------------------------------------------------------------------- runs */

export class RunRepository {
  constructor(private readonly db: Db) {}

  insert(run: RunRecord): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO runs
          (id, workflow_id, workflow_rev, workflow_name, status, started_at, ended_at, error, abort_reason, partial_effects, log)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.workflowId,
        run.workflowRevision,
        run.workflowName,
        run.status,
        run.startedAt,
        run.endedAt ?? null,
        run.error ?? null,
        run.abortReason ?? null,
        J(run.partialEffects),
        J(run.log),
      );
    for (const s of run.steps) this.writeStep(run.id, s);
  }

  writeStep(runId: string, step: StepRun): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO step_runs
          (run_id, step_id, label, tier, status, attempts, started_at, ended_at, duration_ms,
           resolved_selector, healed_selector, error, outputs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        runId,
        step.stepId,
        step.label,
        step.tier,
        step.status,
        step.attempts,
        step.startedAt,
        step.endedAt ?? null,
        step.durationMs,
        step.resolvedSelector ? J(step.resolvedSelector) : null,
        step.healedSelector ? J(step.healedSelector) : null,
        step.error ?? null,
        J(step.outputs),
      );
  }

  update(run: RunRecord): void {
    this.insert(run);
  }

  get(id: string): RunRecord | null {
    const row = this.db.prepare<any>('SELECT * FROM runs WHERE id = ?').get(id);
    if (!row) return null;
    const steps = this.db
      .prepare<any>('SELECT * FROM step_runs WHERE run_id = ? ORDER BY started_at ASC')
      .all(id)
      .map(
        (s): StepRun => ({
          stepId: s.step_id,
          label: s.label ?? s.step_id,
          tier: s.tier,
          attempts: s.attempts,
          status: s.status,
          startedAt: s.started_at,
          endedAt: s.ended_at ?? undefined,
          durationMs: s.duration_ms,
          resolvedSelector: s.resolved_selector ? P(s.resolved_selector) : undefined,
          healedSelector: s.healed_selector ? P(s.healed_selector) : undefined,
          error: s.error ?? undefined,
          outputs: P<Record<string, string>>(s.outputs),
        }),
      );
    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowRevision: row.workflow_rev,
      workflowName: row.workflow_name,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      status: row.status,
      steps,
      error: row.error ?? undefined,
      abortReason: row.abort_reason ?? undefined,
      partialEffects: P<string[]>(row.partial_effects),
      log: P<RunRecord['log']>(row.log),
    };
  }

  list(limit = 100): RunRecord[] {
    return this.db
      .prepare<{ id: string }>('SELECT id FROM runs ORDER BY started_at DESC LIMIT ?')
      .all(limit)
      .map((r) => this.get(r.id))
      .filter((r): r is RunRecord => r !== null);
  }

  /** Per-step aggregate used by the learning loop. */
  stepStats(stepId: string): { attempts: number; successes: number; failures: number; tiers: Record<string, number> } {
    const rows = this.db
      .prepare<{ status: string; tier: string }>(
        'SELECT status, tier FROM step_runs WHERE step_id = ?',
      )
      .all(stepId);
    const stats = { attempts: rows.length, successes: 0, failures: 0, tiers: {} as Record<string, number> };
    for (const r of rows) {
      if (r.status === 'succeeded') stats.successes++;
      if (r.status === 'failed') stats.failures++;
      stats.tiers[r.tier] = (stats.tiers[r.tier] ?? 0) + 1;
    }
    return stats;
  }
}

/* ---------------------------------------------------------- review + feedback */

export class ReviewRepository {
  constructor(private readonly db: Db) {}

  insert(req: ReviewRequest): ReviewRequest {
    this.db
      .prepare(`
        INSERT INTO review_requests
          (id, kind, workflow_id, candidate_id, run_id, step_id, risk, status, message, payload, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        req.id,
        req.kind,
        req.workflowId ?? null,
        req.candidateId ?? null,
        req.runId ?? null,
        req.stepId ?? null,
        req.risk ?? null,
        req.resolvedAt ? 'resolved' : 'pending',
        req.message,
        J(req.payload),
        req.createdAt,
        req.resolvedAt ?? null,
      );
    return req;
  }

  resolve(id: string, resolution: NonNullable<ReviewRequest['resolution']>, now: number): ReviewRequest | null {
    const existing = this.get(id);
    if (!existing) return null;
    const next: ReviewRequest = { ...existing, resolution, resolvedAt: now };
    this.db
      .prepare("UPDATE review_requests SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?")
      .run(resolution ?? null, now, id);
    return next;
  }

  get(id: string): ReviewRequest | null {
    const row = this.db.prepare<any>('SELECT * FROM review_requests WHERE id = ?').get(id);
    return row ? mapReview(row) : null;
  }

  listPending(): ReviewRequest[] {
    return this.db
      .prepare<any>("SELECT * FROM review_requests WHERE status = 'pending' ORDER BY created_at ASC")
      .all()
      .map(mapReview);
  }

  list(limit = 100): ReviewRequest[] {
    return this.db
      .prepare<any>('SELECT * FROM review_requests ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map(mapReview);
  }
}

function mapReview(r: any): ReviewRequest {
  return {
    id: r.id,
    kind: r.kind,
    workflowId: r.workflow_id ?? undefined,
    candidateId: r.candidate_id ?? undefined,
    runId: r.run_id ?? undefined,
    stepId: r.step_id ?? undefined,
    risk: r.risk ?? undefined,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? undefined,
    resolution: r.resolution ?? undefined,
    message: r.message,
    payload: P<Record<string, unknown>>(r.payload),
  };
}

export class FeedbackRepository {
  constructor(private readonly db: Db) {}

  insert(feedback: Feedback): Feedback {
    this.db
      .prepare(`
        INSERT INTO feedback (id, kind, workflow_id, candidate_id, run_id, note, created_at, applied_effects)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        feedback.id,
        feedback.kind,
        feedback.workflowId ?? null,
        feedback.candidateId ?? null,
        feedback.runId ?? null,
        feedback.note ?? null,
        feedback.createdAt,
        J(feedback.appliedEffects),
      );
    return feedback;
  }

  /** Scorer feedback accumulates in `meta` so weights survive restarts. */
  addWeight(delta: number): number {
    const row = this.db
      .prepare<{ value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('scorer.negativeWeight');
    const next = Number(row?.value ?? '0') + delta;
    this.db
      .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run('scorer.negativeWeight', String(next));
    return next;
  }

  getWeight(): number {
    const row = this.db
      .prepare<{ value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('scorer.negativeWeight');
    return Number(row?.value ?? '0');
  }

  list(limit = 100): Feedback[] {
    return this.db
      .prepare<any>('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        workflowId: r.workflow_id ?? undefined,
        candidateId: r.candidate_id ?? undefined,
        runId: r.run_id ?? undefined,
        note: r.note ?? undefined,
        createdAt: r.created_at,
        appliedEffects: P<string[]>(r.applied_effects),
      }));
  }
}

export class Store {
  readonly db: Db;
  readonly events: EventRepository;
  readonly discovery: DiscoveryRepository;
  readonly workflows: WorkflowRepository;
  readonly runs: RunRepository;
  readonly reviews: ReviewRepository;
  readonly feedback: FeedbackRepository;

  constructor(db: Db) {
    this.db = db;
    this.events = new EventRepository(db);
    this.discovery = new DiscoveryRepository(db);
    this.workflows = new WorkflowRepository(db);
    this.runs = new RunRepository(db);
    this.reviews = new ReviewRepository(db);
    this.feedback = new FeedbackRepository(db);
  }

  close(): void {
    this.db.close();
  }
}
