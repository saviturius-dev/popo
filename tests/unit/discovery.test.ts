import { describe, expect, it } from 'vitest';
import { discover, overlapRatio, similarityRatio } from '@workflowos/discovery';
import { loadTrace } from '../support/harness.js';

describe('similarityRatio', () => {
  it('is 1 for identical sequences and 0 for disjoint ones', () => {
    expect(similarityRatio(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(similarityRatio(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('tolerates an inserted step without collapsing', () => {
    const score = similarityRatio(['a', 'b', 'c', 'd'], ['a', 'x', 'b', 'c', 'd']);
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });
});

describe('overlapRatio', () => {
  it('is high for the same activity with a shifted boundary', () => {
    const shorter = ['a', 'b', 'c'];
    const longer = ['a', 'b', 'c', 'd', 'e'];
    expect(overlapRatio(shorter, longer)).toBe(1);
    expect(similarityRatio(shorter, longer)).toBeLessThan(0.8);
  });
});

describe('discover', () => {
  it('finds one workflow repeated five times in the clean trace', async () => {
    const events = await loadTrace('a_clean', 'a-customer-request-clean.jsonl');
    const result = discover(events, { traceId: 'a_clean', minSupport: 3 });

    expect(result.stats.sessions).toBe(5);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.tokenSequence).toHaveLength(13);
    expect(candidate.occurrences).toHaveLength(5);
    expect(candidate.occurrences.every((o) => o.similarity === 1)).toBe(true);
    expect(candidate.appChain).toEqual(['gmail', 'crm', 'slack']);
  });

  it('still finds it in the noisy trace, with lower per-occurrence similarity', async () => {
    const events = await loadTrace('b_noisy', 'b-customer-request-noisy.jsonl');
    const result = discover(events, { traceId: 'b_noisy', minSupport: 3 });

    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.occurrences.length).toBeGreaterThanOrEqual(7);
    const mean =
      candidate.occurrences.reduce((a, o) => a + o.similarity, 0) / candidate.occurrences.length;
    expect(mean).toBeGreaterThan(0.9);
  });

  it('separates two different workflows in the same day of work', async () => {
    const events = await loadTrace('c_two', 'c-two-workflows.jsonl');
    const result = discover(events, { traceId: 'c_two', minSupport: 3 });

    expect(result.candidates).toHaveLength(2);
    const chains = result.candidates.map((c) => c.appChain.join('>'));
    expect(chains).toContain('gmail>crm>slack');
    expect(chains).toContain('excel-desktop>outlook');
  });

  it('proposes nothing when nothing repeats', async () => {
    const events = await loadTrace('d_one_off', 'd-one-off-only.jsonl');
    const result = discover(events, { traceId: 'd_one_off', minSupport: 3 });

    expect(result.candidates).toHaveLength(0);
  });

  it('is deterministic: the same trace always yields the same ids and order', async () => {
    const events = await loadTrace('a_clean', 'a-customer-request-clean.jsonl');
    const first = discover(events, { traceId: 'a_clean', minSupport: 3 });
    const second = discover([...events].reverse(), { traceId: 'a_clean', minSupport: 3 });

    expect(second.candidates.map((c) => c.id)).toEqual(first.candidates.map((c) => c.id));
    expect(second.candidates[0].score).toEqual(first.candidates[0].score);
  });

  it('reports no candidates when there are fewer sessions than the support threshold', async () => {
    const events = await loadTrace('a_clean', 'a-customer-request-clean.jsonl');
    const result = discover(events, { traceId: 'a_clean', minSupport: 99 });
    expect(result.candidates).toHaveLength(0);
  });
});
