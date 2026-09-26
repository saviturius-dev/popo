import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityEvent, ActivitySource, IngestWarning, LlmPort, LlmRequest } from '@workflowos/core';
import { CaptureSource, GeneratorSource, ReplaySource } from '@workflowos/ingest';
import { FixtureProvider, OllamaProvider } from '@workflowos/llm';
import { repoRoot } from '../support/harness.js';

const persona = JSON.parse(
  readFileSync(join(repoRoot, 'fixtures', 'personas', 'customer-request.json'), 'utf8'),
) as never;

async function collect(source: ActivitySource): Promise<{ events: ActivityEvent[]; warnings: IngestWarning[] }> {
  const events: ActivityEvent[] = [];
  const warnings: IngestWarning[] = [];
  await source.start((event) => {
    events.push(event);
  }, (w) => warnings.push(w));
  return { events, warnings };
}

describe('ActivitySource contract', () => {
  it('ReplaySource emits a valid, ordered, well-formed stream', async () => {
    const { events, warnings } = await collect(
      new ReplaySource({ traceId: 't', path: join(repoRoot, 'fixtures', 'traces', 'a-customer-request-clean.jsonl') }),
    );

    expect(events.length).toBe(65);
    expect(warnings).toEqual([]);
    expect(events.every((e) => e.source === 'replay')).toBe(true);
    expect(events.every((e) => e.id.length > 0)).toBe(true);
    expect([...events].sort((a, b) => a.seq - b.seq).map((e) => e.seq)).toEqual(
      events.map((e) => e.seq),
    );
    expect(events[0].ts).toBeLessThanOrEqual(events[events.length - 1].ts);
  });

  it('ReplaySource skips unparseable lines but refuses a badly corrupt trace', async () => {
    const line = (i: number) =>
      JSON.stringify({ seq: i, ts: i, app: { id: 'crm', name: 'CRM', kind: 'web' }, action: { type: 'click' } });

    // One bad line in ten stays inside the tolerance.
    const mostlyGood = new ReplaySource({
      traceId: 't',
      content: Array.from({ length: 10 }, (_, i) => (i === 3 ? 'nope' : line(i))).join('\n'),
    });
    const collected = await collect(mostlyGood);
    expect(collected.events).toHaveLength(9);

    const corrupt = new ReplaySource({
      traceId: 't',
      content: Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? line(i) : 'nope')).join('\n'),
    });
    await expect(collect(corrupt)).rejects.toThrow(/corrupt/i);
  });

  it('GeneratorSource is reproducible for a given seed', async () => {
    const first = await collect(new GeneratorSource({ persona, seed: 42, noisy: false, traceId: 'g1' }));
    const second = await collect(new GeneratorSource({ persona, seed: 42, noisy: false, traceId: 'g1' }));

    expect(first.events).toHaveLength(65);
    expect(first.events.map((e) => e.id + e.action.type + (e.value?.text ?? ''))).toEqual(
      second.events.map((e) => e.id + e.action.type + (e.value?.text ?? '')),
    );
  });

  it('GeneratorSource actually perturbs the stream when noise is enabled', async () => {
    const clean = await collect(new GeneratorSource({ persona, seed: 7, noisy: false, traceId: 'g' }));
    const noisy = await collect(new GeneratorSource({ persona, seed: 7, noisy: true, traceId: 'g' }));

    expect(noisy.events.length).not.toBe(clean.events.length);
  });

  it('CaptureSource refuses to pretend it can observe the desktop', async () => {
    await expect(collect(new CaptureSource('live'))).rejects.toThrow(/out of scope/i);
  });
});

describe('LlmPort contract', () => {
  const schema = { parse: (v: unknown) => v } as never;
  const request: LlmRequest<typeof schema> = {
    system: 's',
    prompt: 'p',
    schema,
    fixtureKey: 'k',
  };

  const providers: [string, () => LlmPort][] = [
    ['FixtureProvider', () => new FixtureProvider({ k: { a: 1 } })],
    ['OllamaProvider', () => new OllamaProvider()],
  ];

  it.each(providers)('%s exposes a name and a complete method', (name, make) => {
    const provider = make();
    expect(typeof provider.name).toBe('string');
    expect(typeof provider.complete).toBe('function');
    void name;
    void request;
  });

  it('OllamaProvider degrades to a clear error when no local model is running', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(provider.complete(request)).rejects.toBeTruthy();
  });
});
