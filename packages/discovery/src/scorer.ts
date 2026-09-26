import type { CandidateWorkflow, ScoreBreakdown } from '@workflowos/core';

export interface ScorerWeights {
  support: number;
  duration: number;
  crossAppTransitions: number;
  consistency: number;
  noise: number;
  /** Occurrence count at which support saturates. */
  supportTarget: number;
  /** Occurrences longer than this are treated as maximally tedious. */
  maxDurationMs: number;
}

export const DEFAULT_WEIGHTS: ScorerWeights = {
  support: 0.35,
  duration: 0.15,
  crossAppTransitions: 0.2,
  consistency: 0.3,
  noise: 0.25,
  supportTarget: 5,
  maxDurationMs: 10 * 60_000,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Ranks candidates on the four signals that make something worth automating:
 * it happens often, it is tedious rather than fast, it crosses applications,
 * and the occurrences look like each other.
 *
 * User rejection is folded in as an additional noise penalty so a pattern the
 * user has declined stops competing with the ones they accepted.
 */
export function scoreCandidates(
  candidates: readonly CandidateWorkflow[],
  weights: ScorerWeights = DEFAULT_WEIGHTS,
  rejectionWeight = 0,
): CandidateWorkflow[] {
  return candidates.map((candidate) => {
    const support = clamp01(candidate.occurrences.length / weights.supportTarget);

    const durations = candidate.occurrences.map((o) => Math.max(0, o.endTs - o.startTs)).sort((a, b) => a - b);
    const median = durations.length === 0 ? 0 : durations[Math.floor(durations.length / 2)];
    const duration = clamp01(1 - median / weights.maxDurationMs);

    // Read straight off the canonical sequence: switching application is a
    // property of the workflow, not of any single noisy occurrence.
    const apps = candidate.tokenSequence.map((token) => token.split(':')[0]);
    const switches = apps.filter((app, i) => i > 0 && app !== apps[i - 1]).length;
    const distinctApps = Math.max(1, new Set(apps).size);
    const crossAppTransitions = clamp01(switches / (distinctApps - 1 || 1));

    const consistency = clamp01(
      candidate.occurrences.reduce((acc, o) => acc + o.similarity, 0) /
        Math.max(1, candidate.occurrences.length),
    );

    const weakFraction =
      candidate.occurrences.filter((o) => o.similarity < 0.8).length /
      Math.max(1, candidate.occurrences.length);
    const noisePenalty = clamp01((1 - consistency) * 0.6 + weakFraction * 0.4 + rejectionWeight);

    const positive =
      weights.support * support +
      weights.duration * duration +
      weights.crossAppTransitions * crossAppTransitions +
      weights.consistency * consistency;
    // Expressed as a share of the available signal, so a clean high-support
    // pattern lands near (but not pinned at) 1 and a noisy one is visibly lower.
    const signal = weights.support + weights.duration + weights.crossAppTransitions + weights.consistency;
    const total = clamp01((positive - weights.noise * noisePenalty) / signal);

    const score: ScoreBreakdown = {
      support,
      duration,
      crossAppTransitions,
      consistency,
      noisePenalty,
      total,
    };

    return { ...candidate, score };
  });
}

export function rejectionWeightFor(rejections: number): number {
  return Math.min(0.6, rejections * 0.15);
}
