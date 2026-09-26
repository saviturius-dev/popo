import { readFileSync } from 'node:fs';
import { ReplaySource } from '@workflowos/ingest';
import { sessionize, tokenizeSessions } from '@workflowos/discovery';
import type { ActivityEvent } from '@workflowos/core';

const events: ActivityEvent[] = [];
await new ReplaySource({ traceId: 'dbg', path: 'fixtures/traces/a-customer-request-clean.jsonl' }).start(
  (e) => {
    events.push(e);
  },
);
const sessions = sessionize(events, { traceId: 'dbg' });
const byId = new Map(events.map((e) => [e.id, e]));
const streams = tokenizeSessions(sessions, byId);
for (const t of streams[0].tokens) process.stdout.write(`${JSON.stringify(t)}\n`);
process.stdout.write(`--- session1 ---\n`);
for (const t of streams[1].tokens) process.stdout.write(`${JSON.stringify(t)}\n`);
process.stdout.write(`counts: ${streams.map((s) => s.tokens.length).join(',')}\n`);
process.stdout.write(
  `identical: ${JSON.stringify(streams[0].tokens) === JSON.stringify(streams[4].tokens)}\n`,
);
void readFileSync;
