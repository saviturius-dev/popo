import type { CandidateWorkflow, Occurrence } from '@workflowos/core';
import { overlapRatio } from './miner.js';

export interface DedupeOptions {
  /** Fraction of a candidate's occurrences that must be covered to suppress it. */
  coverageThreshold?: number;
  /** Overlap above which one sequence is considered the same activity. */
  variantThreshold?: number;
}

/**
 * Collapses redundant candidates.
 *
 * Maximality in the miner removes truncated views of the same sequence, but a
 * noisy session can still yield two maximal candidates for one workflow: one
 * that starts a step earlier, one that ends a step earlier. Both cover the same
 * stretches of activity and overlap almost completely, so the
 * higher-scoring one wins and the other is dropped.
 */
export function dedupeCandidates(
  candidates: readonly CandidateWorkflow[],
  options: DedupeOptions = {},
): CandidateWorkflow[] {
  const coverageThreshold = options.coverageThreshold ?? 0.7;
  const variantThreshold = options.variantThreshold ?? 0.7;

  const ranked = [...candidates].sort(
    (a, b) => b.score.total - a.score.total || b.occurrences.length - a.occurrences.length || a.id.localeCompare(b.id),
  );

  const kept: CandidateWorkflow[] = [];
  for (const candidate of ranked) {
    const duplicate = kept.find(
      (k) =>
        overlapRatio(k.tokenSequence, candidate.tokenSequence) >= variantThreshold &&
        coverage(k.occurrences, candidate.occurrences) >= coverageThreshold,
    );
    if (!duplicate) kept.push(candidate);
  }

  return kept.sort((a, b) => b.score.total - a.score.total || a.id.localeCompare(b.id));
}

function coverage(a: readonly Occurrence[], b: readonly Occurrence[]): number {
  if (a.length === 0) return 0;
  let covered = 0;
  for (const occurrence of a) {
    const sameSession = b.filter((o) => o.sessionId === occurrence.sessionId);
    const overlaps = sameSession.some(
      (o) => occurrence.startIndex < o.endIndex && o.startIndex < occurrence.endIndex,
    );
    if (overlaps) covered++;
  }
  return covered / a.length;
}
