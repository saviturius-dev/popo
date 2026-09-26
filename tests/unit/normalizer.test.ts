import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '@workflowos/core';
import { normalizeEvent, normalizeUrl } from '@workflowos/discovery';

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'e1',
    seq: 0,
    ts: 1_767_225_600_000,
    app: { id: 'chrome', name: 'Chrome', kind: 'web' },
    action: { type: 'click' },
    source: 'replay',
    ...overrides,
  };
}

describe('normalizeEvent', () => {
  it('masks an email typed into a field and exposes it as the primary variable', () => {
    const result = normalizeEvent(
      event({
        action: { type: 'type' },
        element: { role: 'textbox', name: 'Search customers' },
        value: { text: 'priya.nair@northwind.example' },
      }),
    );

    expect(result.token).toBe('chrome:type:role=textbox:name=search customers:value=<email>');
    expect(result.primary?.kind).toBe('email');
    expect(result.primary?.example).toBe('priya.nair@northwind.example');
  });

  it('keeps a control name intact, because the app owns it and the user does not', () => {
    const result = normalizeEvent(
      event({ element: { role: 'button', name: 'Request notes for Priya' } }),
    );

    expect(result.token).toContain('name=request notes for priya');
    expect(result.primary).toBeUndefined();
  });

  it('treats a long free-text value as one variable rather than a literal label', () => {
    const result = normalizeEvent(
      event({
        action: { type: 'type' },
        element: { role: 'textbox', name: 'Request notes' },
        value: { text: 'Customer reported a billing error and asked for a refund review.' },
      }),
    );

    expect(result.token).toBe('chrome:type:role=textbox:name=request notes:value=<text>');
    expect(result.primary?.kind).toBe('text');
  });

  it('collapses a value that mixes structure and prose into a single text variable', () => {
    const result = normalizeEvent(
      event({
        action: { type: 'type' },
        element: { role: 'textbox', name: 'Attachment' },
        value: { text: 'invoice-dispute-10001.pdf' },
      }),
    );

    expect(result.token).toContain('value=<text>');
    expect(result.primary?.kind).toBe('text');
  });

  it('never emits the contents of a secret field', () => {
    const result = normalizeEvent(
      event({
        action: { type: 'type' },
        element: { role: 'textbox', name: 'Password' },
        value: { text: 'hunter2-correct-horse' },
      }),
    );

    // The control name is masked because it addresses a secret field, and the
    // value is masked because it is a secret. The placeholder kind stays valid
    // so the compiler can still declare a variable for it.
    expect(result.token).toBe('chrome:type:role=textbox:name=<secret>:value=<text>');
    expect(result.token).not.toContain('hunter2');
    expect(result.primary?.kind).toBe('text');
  });

  it('strips the origin and masks identifiers in urls', () => {
    expect(normalizeUrl('https://crm.mock/customers/cus-1001?tab=notes')).toBe(
      '/customers/cus-<num>?tab=notes',
    );
    expect(normalizeUrl('https://crm.mock/customers/12345/')).toBe('/customers/<num>');
  });
});
