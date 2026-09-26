import type { ActionType, ActivityEvent, AppRef, Selector, SelectorStrategy } from '@workflowos/core';

export interface PersonaInstance {
  app: AppRef;
  action: { type: ActionType };
  target?: { url?: string; windowTitle?: string };
  element?: {
    role?: string;
    name?: string;
    text?: string;
    strategy?: SelectorStrategy;
    testId?: string;
  };
  /** Value template; `{{token}}` placeholders are filled from the data pool. */
  value?: { template?: string; sensitive?: boolean };
  /** Simulated think-time before this step, in milliseconds. */
  delayMs?: number;
  /** Optional steps may be reordered or dropped by the noise model. */
  optional?: boolean;
}

export interface NoiseModel {
  /** Probability of an extra, semantically irrelevant click next to a real one. */
  extraClickRate: number;
  /** Probability of a typo in a typed value. */
  typoRate: number;
  /** Probability of an idle gap between steps. */
  idleRate: number;
  /** Probability that an optional step is skipped or moved. */
  optionalJitterRate: number;
  /** Number of unrelated browsing events injected between occurrences. */
  interleaveBrowsing: number;
}

export interface Persona {
  id: string;
  label: string;
  repeat: number;
  startTs: number;
  /** Base spacing between occurrences, in milliseconds. */
  baseGapMs: number;
  noise: NoiseModel;
  /**
   * Fixed data pools, cycled per occurrence.
   *
   * Pinning the pool is what keeps a generated trace consistent with the mock
   * applications' seed data: a trace that invents an email address the CRM has
   * never heard of would exercise the "customer not found" path on every run.
   */
  pools?: DataPool[];
  instances: PersonaInstance[];
}

export const cleanNoise: NoiseModel = {
  extraClickRate: 0,
  typoRate: 0,
  idleRate: 0,
  optionalJitterRate: 0,
  interleaveBrowsing: 0,
};

export const noisyNoise: NoiseModel = {
  extraClickRate: 0.05,
  typoRate: 0.15,
  idleRate: 0,
  optionalJitterRate: 0.3,
  interleaveBrowsing: 2,
};

const FIRST_NAMES = ['Priya', 'Marcus', 'Elena', 'Tomas', 'Aisha', 'Jonas', 'Mei', 'Ravi'];
const LAST_NAMES = ['Nair', 'Delgado', 'Okafor', 'Lindqvist', 'Tanaka', 'Bauer', 'Haddad', 'Novak'];
const COMPANIES = ['Northwind', 'Contoso', 'Initech', 'Globex', 'Umbrella', 'Soylent'];
const SUBJECTS = [
  'Invoice dispute on order {{num}}',
  'Refund request {{num}}',
  'Shipping delay for order {{num}}',
  'Upgrade request from {{company}}',
  'Contract renewal — {{company}}',
];
const REQUEST_NOTES = [
  'Customer reports a billing error and requests a refund review.',
  'Customer escalated a shipping delay; needs a delivery date commitment.',
  'Customer asked to move to the enterprise plan starting next quarter.',
  'Customer disputes an invoice line item and attached supporting documents.',
];

/** Deterministic PRNG so a given seed always yields the same trace. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export interface DataPool {
  customer: string;
  email: string;
  company: string;
  num: string;
  subject: string;
  note: string;
  attachment: string;
}

export const DEFAULT_POOL: DataPool = {
  customer: 'Priya Nair',
  email: 'priya.nair@northwind.example',
  company: 'Northwind',
  num: '10001',
  subject: 'Invoice dispute on order 10001',
  note: 'Customer reported a billing error on the most recent invoice and asked for a refund review.',
  attachment: 'invoice-dispute-10001.pdf',
};

export function makeDataPool(rand: () => number, overrides?: Partial<DataPool>): DataPool {
  const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
  const company = COMPANIES[Math.floor(rand() * COMPANIES.length)];
  const num = String(10000 + Math.floor(rand() * 89999));
  return {
    customer: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase()}.example`,
    company,
    num,
    subject: SUBJECTS[Math.floor(rand() * SUBJECTS.length)].replace('{{num}}', num),
    note: REQUEST_NOTES[Math.floor(rand() * REQUEST_NOTES.length)],
    attachment: `request-${num}.pdf`,
    ...overrides,
  };
}

export function fillTemplate(template: string, pool: DataPool, rand: () => number): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = (pool as unknown as Record<string, string>)[key];
    return value ?? `{{${key}}}`;
  }).replace(/\{\{#\d+\}\}/g, () => String(Math.floor(rand() * 900) + 100));
}

export function applyTypo(text: string, rand: () => number): string {
  if (text.length < 4) return text;
  const i = 1 + Math.floor(rand() * (text.length - 2));
  const swapped = text[i] + text[i + 1] + text.slice(i + 2);
  return text.slice(0, i) + swapped.slice(1) + swapped[0];
}

export function selectorFor(instance: PersonaInstance): Selector | undefined {
  if (!instance.element) return undefined;
  const strategy = instance.element.strategy ?? 'role-name';
  return {
    strategy,
    role: instance.element.role,
    name: instance.element.name,
    testId: instance.element.testId,
    textPattern: instance.element.text ? escapeForText(instance.element.text) : undefined,
    weight: 0.8,
    evidence: 'observed',
  };
}

function escapeForText(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type { ActivityEvent };
