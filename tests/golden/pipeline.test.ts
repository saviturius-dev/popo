import { describe, expect, it } from 'vitest';
import { compileCandidate } from '@workflowos/compiler';
import { discover } from '@workflowos/discovery';
import { goldenLlm, loadTrace, readManifest, round, summariseWorkflow } from '../support/harness.js';
import { UnavailableLlm } from '../support/stubLlm.js';

const NOW = 1_767_225_600_000;

const TRACES = [
  'a-customer-request-clean',
  'b-customer-request-noisy',
  'c-two-workflows',
  'd-one-off-only',
] as const;

describe('golden pipeline', () => {
  it.each(TRACES)('matches the committed manifest for %s', async (name) => {
    const manifest = readManifest(name) as { traceId: string };
    const events = await loadTrace(manifest.traceId, `${name}.jsonl`);
    const result = discover(events, { traceId: manifest.traceId, minSupport: 3 });
    const llm = goldenLlm();

    const workflows = [];
    for (const candidate of result.candidates) {
      workflows.push(
        summariseWorkflow(await compileCandidate({ candidate, streams: result.streams, llm, now: NOW })),
      );
    }

    const actual = {
      trace: name,
      traceId: manifest.traceId,
      stats: result.stats,
      candidates: result.candidates.map((c) => ({
        id: c.id,
        appChain: c.appChain,
        tokenSequence: c.tokenSequence,
        occurrenceCount: c.occurrences.length,
        meanSimilarity: round(
          c.occurrences.reduce((a, o) => a + o.similarity, 0) / Math.max(1, c.occurrences.length),
        ),
        score: Object.fromEntries(Object.entries(c.score).map(([k, v]) => [k, round(v, 3)])),
      })),
      workflows,
    };

    expect(actual).toEqual(readManifest(name));
  });

  it('falls back to heuristics and marks the workflow degraded when the model is unavailable', async () => {
    const events = await loadTrace('a-customer-request-clean', 'a-customer-request-clean.jsonl');
    const result = discover(events, { traceId: 'degraded', minSupport: 3 });
    const candidate = result.candidates[0];

    const workflow = await compileCandidate({
      candidate,
      streams: result.streams,
      llm: new UnavailableLlm(),
      now: NOW,
    });

    expect(workflow.degraded).toBe(true);
    expect(workflow.name).toBeTruthy();
    expect(workflow.intent).toMatch(/Compiled from observed activity/);
    expect(workflow.steps).toHaveLength(13);
    // The mechanical half of compilation is unaffected by the model.
    expect(workflow.steps.map((s) => s.action)).toEqual(
      expect.arrayContaining(['navigate', 'click', 'type', 'send']),
    );
    expect(workflow.variables.map((v) => v.name)).toEqual([
      'v_email_1',
      'v_text_1',
      'v_text_2',
      'v_text_3',
      'attachmentPath',
      'v_record_id',
    ]);
  });

  it('refuses to invent a selector: every click step binds to an observed control', async () => {
    const events = await loadTrace('a-customer-request-clean', 'a-customer-request-clean.jsonl');
    const result = discover(events, { traceId: 'bindings', minSupport: 3 });
    const workflow = await compileCandidate({
      candidate: result.candidates[0],
      streams: result.streams,
      llm: goldenLlm(),
      now: NOW,
    });

    for (const step of workflow.steps) {
      if (step.action === 'navigate') {
        expect(step.target.urlPattern).toBeTruthy();
        continue;
      }
      expect(step.target.selectorCandidates.length).toBeGreaterThan(0);
      for (const selector of step.target.selectorCandidates) {
        expect(selector.name ?? selector.testId ?? selector.value).toBeTruthy();
      }
    }
  });
});
