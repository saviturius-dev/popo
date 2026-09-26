import { describe, expect, it } from 'vitest';
import { classifyRisk, isLookupStep, toStepAction } from '@workflowos/compiler';
import { preferredTiers, TIER_DESCRIPTIONS } from '@workflowos/compiler';

describe('classifyRisk', () => {
  it('treats navigation as read-only', () => {
    expect(classifyRisk('navigate', undefined, 'gmail')).toBe('read');
  });

  it('treats typing and downloading as writes', () => {
    expect(classifyRisk('type', 'Request notes', 'crm')).toBe('write');
    expect(classifyRisk('download', 'Download attachment', 'gmail')).toBe('write');
  });

  it('treats an explicit send control as irreversible', () => {
    expect(classifyRisk('send', 'Send', 'slack')).toBe('irreversible');
    expect(classifyRisk('submit', undefined, 'crm')).toBe('irreversible');
  });

  it('treats destructive control names as irreversible even on a click', () => {
    expect(classifyRisk('click', 'Delete record', 'crm')).toBe('irreversible');
    expect(classifyRisk('click', 'Update record', 'crm')).toBe('write');
    expect(classifyRisk('click', 'Open record', 'crm')).toBe('read');
  });
});

describe('toStepAction', () => {
  it('maps raw activity types onto executable step actions', () => {
    expect(toStepAction('navigate')).toBe('navigate');
    expect(toStepAction('focus')).toBe('navigate');
    expect(toStepAction('keypress')).toBe('navigate');
    expect(toStepAction('copy')).toBe('api-call');
  });
});

describe('isLookupStep', () => {
  it('recognises the record lookup that produces an id other steps depend on', () => {
    expect(isLookupStep('click', 'Search')).toBe(true);
    expect(isLookupStep('click', 'Open record')).toBe(true);
    expect(isLookupStep('click', 'Update record')).toBe(false);
  });
});

describe('preferredTiers', () => {
  it('collapses accessibility and browser automation for web targets', () => {
    const web = preferredTiers('web', false);
    expect(web[0]).toBe('web-semantic');
    expect(web).toContain('browser-automation');
    expect(web).not.toContain('desktop-uia');
  });

  it('uses the accessibility API for native desktop targets', () => {
    const desktop = preferredTiers('desktop', false);
    expect(desktop).toEqual(['desktop-uia', 'cv-fallback']);
  });

  it('promotes the API tiers only when a data-level target was actually observed', () => {
    expect(preferredTiers('web', true)[0]).toBe('api');
    expect(preferredTiers('web', false)).not.toContain('api');
  });

  it('describes every tier the resolver can report', () => {
    for (const tier of [
      'api',
      'app-integration',
      'web-semantic',
      'desktop-uia',
      'browser-automation',
      'cv-fallback',
    ] as const) {
      expect(TIER_DESCRIPTIONS[tier]).toBeTruthy();
    }
  });
});
