/**
 * Deterministic ids.
 *
 * Candidate and variable identities must be stable across runs so that golden
 * manifests and healed-selector weights line up between replays of the same
 * trace. Ids are therefore content-derived, with a counter only for entities
 * that have no natural key (workflows, runs).
 */

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function hashId(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}_${fnv1a(parts.map((p) => String(p)).join('\u0001'))}`;
}

export function createIdFactory(prefix: string, start = 1): () => string {
  let n = start;
  return () => `${prefix}_${n++}`;
}

/** Stable key for a normalized token, used to compare occurrences. */
export function tokenKey(token: string): string {
  return token;
}

export function shortHash(value: string, length = 10): string {
  return fnv1a(value).slice(0, length);
}
