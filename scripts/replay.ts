import { join } from 'node:path';
import { ReplaySource } from '@workflowos/ingest';
import { discover } from '@workflowos/discovery';
import type { ActivityEvent } from '@workflowos/core';

const root = join(import.meta.dirname, '..');
const tracePath = process.argv[2] ?? join(root, 'fixtures', 'traces', 'a-customer-request-clean.jsonl');
const traceId = process.argv[3] ?? 'cli';

const events: ActivityEvent[] = [];
const source = new ReplaySource({ traceId, path: tracePath, speed: 0 });
await source.start((event) => {
  events.push(event);
});

const result = discover(events, { traceId, minSupport: 3 });

const lines: string[] = [];
lines.push(`trace      ${tracePath}`);
lines.push(`events     ${result.stats.events}`);
lines.push(`sessions   ${result.stats.sessions}`);
lines.push(`candidates ${result.stats.candidates} (from ${result.stats.rawCandidates} mined)`);
lines.push('');

for (const candidate of result.candidates) {
  lines.push(`candidate  ${candidate.id}`);
  lines.push(`  score      ${candidate.score.total.toFixed(3)}  support=${candidate.score.support.toFixed(2)} dur=${candidate.score.duration.toFixed(2)} apps=${candidate.score.crossAppTransitions.toFixed(2)} cons=${candidate.score.consistency.toFixed(2)} noise=${candidate.score.noisePenalty.toFixed(2)}`);
  lines.push(`  apps       ${candidate.appChain.join(' -> ')}`);
  lines.push(`  occurrences ${candidate.occurrences.length} (${candidate.occurrences.map((o) => o.similarity.toFixed(2)).join(', ')})`);
  for (const token of candidate.tokenSequence) lines.push(`    ${token}`);
  lines.push('');
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result.candidates, null, 2)}\n`);
} else {
  process.stdout.write(`${lines.join('\n')}\n`);
}
