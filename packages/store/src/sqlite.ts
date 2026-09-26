import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType, StatementSync } from 'node:sqlite';

/**
 * `node:sqlite` is loaded through `createRequire` rather than a static import.
 *
 * Module bundlers resolve `node:` specifiers from their own builtin list, which
 * is not always in step with the Node version in use; going through `require`
 * keeps the driver's resolution entirely inside Node's own resolver.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType;
};

/**
 * A thin, better-sqlite3-shaped adapter over the SQLite build that ships inside
 * Node itself.
 *
 * The project deliberately avoids a native add-on: a desktop agent that will be
 * run on a user's machine should not need a C++ toolchain to install, and
 * `node:sqlite` is available wherever the agent runs. Only the handful of
 * methods the repositories use are exposed, which keeps the storage layer
 * swappable.
 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement<Row> {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}

export interface Db {
  prepare<Row = Record<string, unknown>>(sql: string): Statement<Row>;
  exec(sql: string): void;
  pragma(text: string): unknown;
  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result;
  close(): void;
  raw(): DatabaseSyncType;
}

class NodeStatement<Row> implements Statement<Row> {
  constructor(private readonly statement: StatementSync) {}

  run(...params: unknown[]): RunResult {
    const result = this.statement.run(...(params as never[]));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  get(...params: unknown[]): Row | undefined {
    return this.statement.get(...(params as never[])) as Row | undefined;
  }

  all(...params: unknown[]): Row[] {
    return this.statement.all(...(params as never[])) as Row[];
  }
}

class NodeDatabase implements Db {
  private readonly inner: DatabaseSyncType;
  private depth = 0;

  constructor(location: string) {
    this.inner = new DatabaseSync(location);
  }

  prepare<Row = Record<string, unknown>>(sql: string): Statement<Row> {
    return new NodeStatement<Row>(this.inner.prepare(sql));
  }

  exec(sql: string): void {
    this.inner.exec(sql);
  }

  pragma(text: string): unknown {
    const rows = this.inner.prepare(`PRAGMA ${text}`).all();
    return rows[0] ?? undefined;
  }

  /**
   * Depth-aware so a repository that calls another repository inside its
   * transaction still commits exactly once.
   */
  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
    return (...args: Args): Result => {
      const nested = this.depth > 0;
      const name = `sp_${this.depth}`;
      this.inner.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
      this.depth++;
      try {
        const result = fn(...args);
        this.depth--;
        this.inner.exec(nested ? `RELEASE ${name}` : 'COMMIT');
        return result;
      } catch (cause) {
        this.depth--;
        this.inner.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK');
        throw cause;
      }
    };
  }

  close(): void {
    this.inner.close();
  }

  raw(): DatabaseSyncType {
    return this.inner;
  }
}

export function openDatabase(file: string): Db {
  return new NodeDatabase(file);
}
