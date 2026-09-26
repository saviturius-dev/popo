import { errors } from '@workflowos/core';
import { openDatabase, type Db } from './sqlite.js';

export type { Db };

const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id            TEXT PRIMARY KEY,
        trace_id      TEXT NOT NULL,
        seq           INTEGER NOT NULL,
        ts            INTEGER NOT NULL,
        app_id        TEXT NOT NULL,
        app_name      TEXT NOT NULL,
        app_kind      TEXT NOT NULL,
        action        TEXT NOT NULL,
        url           TEXT,
        window_title  TEXT,
        role          TEXT,
        name          TEXT,
        text          TEXT,
        value_text    TEXT,
        selectors     TEXT,
        sensitive     INTEGER NOT NULL DEFAULT 0,
        scenario      TEXT,
        source        TEXT NOT NULL,
        payload       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_trace_seq ON events(trace_id, seq);
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        trace_id   TEXT NOT NULL,
        start_ts   INTEGER NOT NULL,
        end_ts     INTEGER NOT NULL,
        event_ids  TEXT NOT NULL,
        app_chain  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_trace ON sessions(trace_id);

      CREATE TABLE IF NOT EXISTS candidates (
        id            TEXT PRIMARY KEY,
        trace_id      TEXT NOT NULL,
        token_seq     TEXT NOT NULL,
        occurrences   TEXT NOT NULL,
        app_chain     TEXT NOT NULL,
        score         TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id            TEXT PRIMARY KEY,
        candidate_id  TEXT NOT NULL,
        status        TEXT NOT NULL,
        revision      INTEGER NOT NULL,
        reliability   REAL NOT NULL DEFAULT 0,
        ir            TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

      CREATE TABLE IF NOT EXISTS workflow_versions (
        workflow_id  TEXT NOT NULL,
        revision     INTEGER NOT NULL,
        ir           TEXT NOT NULL,
        changed_at   INTEGER NOT NULL,
        changed_by   TEXT NOT NULL,
        PRIMARY KEY (workflow_id, revision)
      );

      CREATE TABLE IF NOT EXISTS runs (
        id               TEXT PRIMARY KEY,
        workflow_id      TEXT NOT NULL,
        workflow_rev     INTEGER NOT NULL,
        workflow_name    TEXT NOT NULL,
        status           TEXT NOT NULL,
        started_at       INTEGER NOT NULL,
        ended_at         INTEGER,
        error            TEXT,
        abort_reason     TEXT,
        partial_effects  TEXT NOT NULL DEFAULT '[]',
        log              TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS step_runs (
        run_id            TEXT NOT NULL,
        step_id           TEXT NOT NULL,
        tier              TEXT NOT NULL,
        status            TEXT NOT NULL,
        attempts          INTEGER NOT NULL,
        started_at        INTEGER NOT NULL,
        ended_at          INTEGER,
        duration_ms       INTEGER NOT NULL DEFAULT 0,
        resolved_selector TEXT,
        healed_selector   TEXT,
        error             TEXT,
        outputs           TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (run_id, step_id)
      );

      CREATE TABLE IF NOT EXISTS review_requests (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        workflow_id  TEXT,
        candidate_id TEXT,
        run_id       TEXT,
        step_id      TEXT,
        risk         TEXT,
        status       TEXT NOT NULL,
        message      TEXT NOT NULL,
        payload      TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        resolved_at  INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_status ON review_requests(status, created_at);

      CREATE TABLE IF NOT EXISTS feedback (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL,
        workflow_id    TEXT,
        candidate_id   TEXT,
        run_id         TEXT,
        note           TEXT,
        created_at     INTEGER NOT NULL,
        applied_effects TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS pipeline_progress (
        trace_id        TEXT PRIMARY KEY,
        stage           TEXT NOT NULL,
        events_ingested INTEGER NOT NULL,
        candidates      INTEGER NOT NULL,
        started_at      INTEGER NOT NULL,
        finished_at     INTEGER,
        error           TEXT
      );

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    // The run journal is read on its own, without loading the workflow it came
    // from, so each step records the label it was executing.
    id: '003_step_runs_label',
    sql: `ALTER TABLE step_runs ADD COLUMN label TEXT;`,
  },
  {
    // Databases created before the review outcome was recorded had nowhere to
    // put it, so approving a workflow failed with "no such column: resolution".
    id: '004_review_resolution',
    sql: `ALTER TABLE review_requests ADD COLUMN resolution TEXT;`,
  },
];

export interface OpenDbOptions {
  file?: string;
  readonly?: boolean;
  verbose?: boolean;
}

export function openDb(options: OpenDbOptions = {}): Db {
  const db = openDatabase(options.file ?? ':memory:');

  if (options.verbose) db.pragma('verbose = true');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    migrate(db);
  } catch (cause) {
    throw errors.store('migration_failed', 'Failed to apply database migrations', {
      cause: String(cause),
    });
  }

  return db;
}

export function migrate(db: Db): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
  const applied = new Set(
    db
      .prepare<{ id: string }>('SELECT id FROM schema_migrations')
      .all()
      .map((r) => r.id),
  );

  const run = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        Date.now(),
      );
    }
  });
  run();

  return MIGRATIONS.map((m) => m.id);
}
