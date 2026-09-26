import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityEvent } from '@workflowos/core';
import { discover } from '@workflowos/discovery';
import { compileCandidate } from '@workflowos/compiler';
import { ReplaySource } from '@workflowos/ingest';
import { goldenLlm, manifestsDir, round, summariseWorkflow, traceFile } from '../tests/support/harness.js';

/**
 * Regenerates the golden manifests.
 *
 * Review the diff before committing: a manifest is a claim about what the
 * pipeline produces, and silently regenerating one would turn the test into a
 * tautology.
 */
const TRACES = [
  { name: 'a-customer-request-clean', traceId: 'a_customer_request' },
  { name: 'b-customer-request-noisy', traceId: 'b_customer_request' },
  { name: 'c-two-workflows', traceId: 'c_two_workflows' },
  { name: 'd-one-off-only', traceId: 'd_one_off' },
];

const llm = goldenLlm();
mkdirSync(manifestsDir, { recursive: true });

for (const { name, traceId } of TRACES) {
  const events: ActivityEvent[] = [];
  await loadAll(events, traceId, name);

  const result = discover(events, { traceId, minSupport: 3 });
  const now = 1_767_225_600_000;
  const workflows = [];
  for (const candidate of result.candidates) {
    workflows.push(
      summariseWorkflow(await compileCandidate({ candidate, streams: result.streams, llm, now })),
    );
  }

  const manifest = {
    trace: name,
    traceId,
    stats: result.stats,
    candidates: result.candidates.map((c) => ({
      id: c.id,
      appChain: c.appChain,
      tokenSequence: c.tokenSequence,
      occurrenceCount: c.occurrences.length,
      meanSimilarity: round(
        c.occurrences.reduce((a, o) => a + o.similarity, 0) / Math.max(1, c.occurrences.length),
      ),
      score: Object.fromEntries(
        Object.entries(c.score).map(([k, v]) => [k, round(v, 3)]),
      ),
    })),
    workflows,
  };

  writeFileSync(
    join(manifestsDir, `${name}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(
    `${name}: ${result.stats.candidates} candidate(s), ${workflows.length} workflow(s)\n`,
  );
}

async function loadAll(sink: ActivityEvent[], traceId: string, name: string): Promise<void> {
  await new ReplaySource({ traceId, path: traceFile(name) }).start((event) => {
    sink.push(event);
  });
}
