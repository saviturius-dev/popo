import type { z } from 'zod';
import type { LlmPort, LlmRequest, LlmResponse } from '@workflowos/core';

export interface ResilientOptions<T> {
  primary: LlmPort;
  /** Produces the value to use when the primary provider fails. */
  fallback: (reason: string) => T;
  timeoutMs?: number;
  onDegraded?: (reason: string) => void;
}

/**
 * Wraps a provider so the pipeline never hard-fails on the LLM.
 *
 * Any error, timeout, or schema violation degrades to the deterministic
 * heuristic implementation, and the caller learns about it through
 * `degraded: true` so the dashboard can badge the result honestly.
 */
export class ResilientLlm<T> implements LlmPort {
  readonly name: string;
  private readonly opts: ResilientOptions<T>;
  /** Rolling record of the last degradation, useful in tests. */
  lastFallbackReason?: string;

  constructor(opts: ResilientOptions<T>) {
    this.opts = opts;
    this.name = `resilient(${opts.primary.name})`;
  }

  async complete<R extends z.ZodTypeAny, U = z.infer<R>>(
    request: LlmRequest<R>,
  ): Promise<LlmResponse<U>> {
    const timeoutMs = this.opts.timeoutMs ?? 30_000;
    try {
      const value = await withTimeout(this.opts.primary.complete<R, U>(request), timeoutMs);
      this.lastFallbackReason = undefined;
      return value;
    } catch (cause) {
      const reason = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      this.lastFallbackReason = reason;
      this.opts.onDegraded?.(reason);
      return {
        value: this.opts.fallback(reason) as unknown as U,
        provider: 'heuristic',
        model: 'heuristic',
        degraded: true,
        fallbackReason: reason,
      };
    }
  }
}

function withTimeout<P>(promise: Promise<P>, ms: number): Promise<P> {
  if (ms <= 0) return promise;
  return new Promise<P>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`llm timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
