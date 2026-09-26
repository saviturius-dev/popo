import { WorkflowOsError } from './errors.js';

export type Result<T, E = WorkflowOsError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export async function mapResult<T, U, E>(
  r: Result<T, E>,
  f: (v: T) => U | Promise<U>,
): Promise<Result<U, E>> {
  return r.ok ? ok(await f(r.value)) : r;
}
