import { describe, expect, it } from 'vitest';
import type { CandidateWorkflow } from '@workflowos/core';
import { DEFAULT_WEIGHTS, rejectionWeightFor, scoreCandidates } from '@workflowos/discovery';

function candidate(id: string, apps: string[], similarity: number, occurrences: number): CandidateWorkflow {
  return {
    id,
    traceIds: ['t'],
    tokenSequence: apps.flatMap((app, i) => [`${app}:click:name=c${i}`]),
    occurrences: Array.from({ length: occurrences }, (_, i) => ({
      sessionId: `s${i}`,
      startIndex: 0,
      endIndex: 1,
      eventIds: [],
      startTs: i * 1000,
      endTs: i * 1000 + 30_000,
      placeholders: [],
      similarity,
    })),
    appChain: apps,
    score: { support: 0, duration: 0, crossAppTransitions: 0, consistency: 0, noisePenalty: 0, total: 0 },
  };
}

describe('scoreCandidates', () => {
  it('rewards a workflow that repeats, crosses applications, and is consistent', () => {
    const [good] = scoreCandidates([candidate('good', ['gmail', 'crm', 'slack'], 1, 5)]);
    expect(good.score.support).toBe(1);
    expect(good.score.consistency).toBe(1);
    expect(good.score.crossAppTransitions).toBe(1);
    expect(good.score.total).toBeGreaterThan(0.8);
  });

  it('penalises noisy occurrences', () => {
    const [noisy] = scoreCandidates([candidate('noisy', ['gmail', 'crm', 'slack'], 0.65, 5)]);
    expect(noisy.score.noisePenalty).toBeGreaterThan(0.2);
    expect(noisy.score.total).toBeLessThan(0.75);
  });

  it('penalises a pattern the user has rejected', () => {
    const base = candidate('x', ['gmail', 'crm'], 0.95, 5);
    const [before] = scoreCandidates([base]);
    const [after] = scoreCandidates([base], DEFAULT_WEIGHTS, rejectionWeightFor(2));
    expect(after.score.total).toBeLessThan(before.score.total);
  });

  it('prefers the shorter, more tedious version of the same work', () => {
    const quick = candidate('quick', ['gmail', 'crm'], 1, 5);
    quick.occurrences = quick.occurrences.map((o) => ({ ...o, endTs: o.startTs + 5_000 }));
    const [quickScore] = scoreCandidates([quick]);
    const [slowScore] = scoreCandidates([candidate('slow', ['gmail', 'crm'], 1, 5)]);
    expect(quickScore.score.duration).toBeGreaterThan(slowScore.score.duration);
  });
});
