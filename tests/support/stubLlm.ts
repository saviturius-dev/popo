import type { LlmPort, LlmRequest, LlmResponse } from '@workflowos/core';
import type { z } from 'zod';

/**
 * A model that always returns the same thing.
 *
 * Golden tests use it so compilation is a pure function of the trace: the
 * mechanical parts of the compiler can be pinned exactly, and the LLM's effect
 * on the output is asserted separately rather than entangled with mining.
 */
export class StaticLlm implements LlmPort {
  readonly name: string;
  readonly calls: { fixtureKey?: string; prompt: string }[] = [];

  constructor(private readonly value: unknown, name = 'static') {
    this.name = name;
  }

  async complete<S extends z.ZodTypeAny, T = z.infer<S>>(
    request: LlmRequest<S>,
  ): Promise<LlmResponse<T>> {
    this.calls.push({ fixtureKey: request.fixtureKey, prompt: request.prompt });
    const parsed = request.schema.safeParse(this.value);
    if (!parsed.success) {
      throw new Error(`StaticLlm value failed schema validation: ${JSON.stringify(parsed.error.issues)}`);
    }
    return { value: parsed.data as T, provider: this.name, model: this.name, degraded: false };
  }
}

/** A model that is never available, to exercise the degraded path. */
export class UnavailableLlm implements LlmPort {
  readonly name = 'unavailable';

  async complete(): Promise<never> {
    throw new Error('model unavailable');
  }
}
