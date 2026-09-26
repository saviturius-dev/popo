import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import type { Selector, Step } from '@workflowos/core';
import { healSelector } from '@workflowos/execution';

interface FakeControl {
  role: string;
  name: string;
}

function fakePage(controls: FakeControl[]): Page {
  const matcher = (role: string) => controls.filter((c) => c.role === role);
  return {
    getByRole: (role: string) => ({
      all: async () =>
        matcher(role).map((c) => ({
          getAttribute: async (attr: string) => (attr === 'aria-label' ? c.name : null),
          innerText: async () => c.name,
        })),
      count: async () => matcher(role).length,
    }),
    getByTestId: () => ({ count: async () => 0 }),
    getByText: () => ({ count: async () => 0 }),
    locator: () => ({ count: async () => 0 }),
  } as unknown as Page;
}

function stepWith(names: string[]): Step {
  const selectorCandidates: Selector[] = names.map((name) => ({
    strategy: 'role-name',
    role: 'button',
    name,
    weight: 0.9,
  }));
  return {
    id: 'step_1',
    action: 'click',
    label: 'Click something',
    target: { appId: 'crm', appKind: 'web', selectorCandidates },
    inputs: {},
    risk: 'read',
    resolveTier: ['web-semantic'],
    confidence: 0.9,
    evidence: [],
    timeoutMs: 5_000,
    retries: 0,
    sourceTokenIndex: 0,
  };
}

describe('healSelector', () => {
  it('re-derives a control whose label changed slightly', async () => {
    const page = fakePage([{ role: 'button', name: 'Update Customer Record' }]);
    const result = await healSelector(page, stepWith(['Update record']));

    expect(result.selector?.name).toBe('update customer record');
    expect(result.selector?.role).toBe('button');
  });

  it('refuses to choose when two controls match equally well', async () => {
    const page = fakePage([
      { role: 'button', name: 'Update record' },
      { role: 'link', name: 'Update record' },
    ]);
    const result = await healSelector(page, stepWith(['Update record']));

    expect(result.selector).toBeUndefined();
    expect(result.ambiguous.length).toBeGreaterThan(0);
  });

  it('returns nothing when the control is gone entirely', async () => {
    const page = fakePage([{ role: 'button', name: 'Cancel' }]);
    const result = await healSelector(page, stepWith(['Update record']));

    expect(result.selector).toBeUndefined();
    expect(result.ambiguous).toHaveLength(0);
  });

  it('gives up immediately when no candidate name was recorded', async () => {
    const page = fakePage([{ role: 'button', name: 'Anything' }]);
    const result = await healSelector(page, {
      ...stepWith([]),
      target: { appId: 'crm', appKind: 'web', selectorCandidates: [] },
    });

    expect(result.selector).toBeUndefined();
    expect(result.scanned).toBe(0);
  });
});
