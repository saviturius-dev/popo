import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import type { LlmPort, LlmRequest, LlmResponse } from '@workflowos/core';
import { errors } from '@workflowos/core';

export type FixtureTable = Record<string, unknown>;

/**
 * Deterministic provider used by the golden test suites and by `pnpm replay`
 * without an API key. Responses are keyed by the caller-supplied `fixtureKey`,
 * which must be a stable function of the input (the compiler uses the
 * candidate id, so the same trace always compiles to the same workflow).
 */
export class FixtureProvider implements LlmPort {
  readonly name = 'fixture';
  private readonly table: FixtureTable;
  readonly calls: { key: string; promptLength: number }[] = [];

  constructor(table: FixtureTable = {}) {
    this.table = table;
  }

  static fromFile(path: string): FixtureProvider {
    const raw = readFileSync(path, 'utf8');
    return new FixtureProvider(JSON.parse(raw) as FixtureTable);
  }

  async complete<S extends z.ZodTypeAny, T = z.infer<S>>(
    request: LlmRequest<S>,
  ): Promise<LlmResponse<T>> {
    const key = request.fixtureKey;
    if (!key) {
      throw errors.llm('missing_fixture_key', 'FixtureProvider requires a fixtureKey');
    }
    this.calls.push({ key, promptLength: request.prompt.length });
    if (!(key in this.table)) {
      throw errors.llm('fixture_not_found', `No fixture registered for key "${key}"`, { key });
    }
    const parsed = request.schema.safeParse(this.table[key]);
    if (!parsed.success) {
      throw errors.llm('schema_violation', 'Fixture failed schema validation', {
        key,
        issues: parsed.error.issues,
      });
    }
    return {
      value: parsed.data as T,
      provider: this.name,
      model: 'fixture',
      degraded: false,
    };
  }
}
