import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityEvent } from '@workflowos/core';
import { generateTrace, type DataPool, type NoiseModel, type Persona } from '@workflowos/ingest';

const root = join(import.meta.dirname, '..');
const personasDir = join(root, 'fixtures', 'personas');
const tracesDir = join(root, 'fixtures', 'traces');

const person = (id: string): Persona =>
  JSON.parse(readFileSync(join(personasDir, `${id}.json`), 'utf8')) as Persona;

function writeTrace(name: string, events: ActivityEvent[]): void {
  mkdirSync(tracesDir, { recursive: true });
  const lines = events
    .slice()
    .sort((a, b) => a.ts - b.ts || a.seq - b.seq)
    .map((event) => JSON.stringify({ ...event, source: 'replay', scenario: event.scenario }));
  writeFileSync(join(tracesDir, `${name}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`${name}.jsonl: ${lines.length} events\n`);
}

function shift(events: ActivityEvent[], byMs: number, idSuffix: string): ActivityEvent[] {
  return events.map((event, index) => ({
    ...event,
    id: `${idSuffix}-${index}`,
    ts: event.ts + byMs,
  }));
}

const customerRequest = person('customer-request');
const weeklyReport = person('weekly-report');
const oneOff = person('one-off-activity');

// (a) The canonical scenario, five clean occurrences.
writeTrace(
  'a-customer-request-clean',
  generateTrace({
    persona: customerRequest,
    seed: 1001,
    noisy: false,
    traceId: 'a_customer_request',
  }),
);

// (b) The same workflow with the noise model applied: extra clicks, typos in
// typed values, a skipped optional step, and unrelated browsing in between.
writeTrace(
  'b-customer-request-noisy',
  generateTrace({
    persona: { ...customerRequest, repeat: 8, noise: customerRequest.noise },
    seed: 2002,
    noisy: true,
    noise: {
      extraClickRate: 0.05,
      typoRate: 0.15,
      idleRate: 0,
      optionalJitterRate: 0.3,
      interleaveBrowsing: 2,
    } satisfies NoiseModel,
    traceId: 'b_customer_request',
  }),
);

// (c) Two different workflows in one day of work. The miner has to separate them
// rather than report the busiest one.
const morning = generateTrace({
  persona: customerRequest,
  seed: 3003,
  noisy: false,
  traceId: 'c_customer_request',
});
const afternoon = generateTrace({
  persona: weeklyReport,
  seed: 4004,
  noisy: false,
  traceId: 'c_weekly_report',
});
writeTrace('c-two-workflows', [...morning, ...shift(afternoon, 4 * 60 * 60_000, 'c_wr')]);

// (d) A day of genuinely one-off activity. Nothing repeats, so nothing should be
// proposed: the negative case that keeps the miner honest.
writeTrace(
  'd-one-off-only',
  generateTrace({ persona: oneOff, seed: 5005, noisy: false, traceId: 'd_one_off' }),
);

// A small helper for tests and the CLI: the pools the traces were built from.
const pools: Record<string, DataPool> = {
  'priya.nair@northwind.example': (customerRequest.pools ?? [])[0],
  'marcus.delgado@contoso.example': (customerRequest.pools ?? [])[1],
};
writeFileSync(
  join(root, 'fixtures', 'pools.json'),
  `${JSON.stringify(pools, null, 2)}\n`,
  'utf8',
);
process.stdout.write('pools.json written\n');
