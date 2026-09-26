import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FixtureProvider, ResilientLlm } from '@workflowos/llm';

const schema = z.object({ name: z.string(), count: z.number() });

const request = {
  system: 'system',
  prompt: 'prompt',
  schema,
  fixtureKey: 'demo',
};

describe('FixtureProvider', () => {
  it('returns the registered value after validating it', async () => {
    const provider = new FixtureProvider({ demo: { name: 'x', count: 2 } });
    const result = await provider.complete(request);
    expect(result.value).toEqual({ name: 'x', count: 2 });
    expect(result.degraded).toBe(false);
  });

  it('fails loudly when a fixture is missing rather than inventing one', async () => {
    const provider = new FixtureProvider();
    await expect(provider.complete(request)).rejects.toThrow(/fixture/i);
  });

  it('rejects a fixture that does not match the schema', async () => {
    const provider = new FixtureProvider({ demo: { name: 'x' } });
    await expect(provider.complete(request)).rejects.toThrow(/schema/i);
  });
});

describe('ResilientLlm', () => {
  it('uses the primary provider when it succeeds', async () => {
    const primary = new FixtureProvider({ demo: { name: 'live', count: 1 } });
    const llm = new ResilientLlm({ primary, fallback: () => ({ name: 'heuristic', count: 0 }) });
    const result = await llm.complete(request);
    expect(result.value.name).toBe('live');
    expect(result.degraded).toBe(false);
  });

  it('degrades to the heuristic instead of failing the pipeline', async () => {
    const primary = new FixtureProvider();
    const llm = new ResilientLlm({ primary, fallback: () => ({ name: 'heuristic', count: 0 }) });
    const result = await llm.complete(request);
    expect(result.value.name).toBe('heuristic');
    expect(result.degraded).toBe(true);
    expect(result.fallbackReason).toBeTruthy();
    expect(result.provider).toBe('heuristic');
  });

  it('degrades on a timeout rather than hanging the pipeline', async () => {
    const slow = {
      name: 'slow',
      complete: () => new Promise<never>(() => undefined),
    };
    const llm = new ResilientLlm({
      primary: slow,
      fallback: () => ({ name: 'heuristic', count: 0 }),
      timeoutMs: 20,
    });
    const result = await llm.complete(request);
    expect(result.degraded).toBe(true);
    expect(result.fallbackReason).toMatch(/timeout/i);
  });
});
