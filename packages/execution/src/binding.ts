import type { Locator, Page } from 'playwright';
import type { Selector, Step } from '@workflowos/core';

const DEFAULT_ROLE_BY_NAME: [RegExp, string][] = [
  [/^(send|save|update|search|run search|download|submit|delete|confirm|open)\b/i, 'button'],
  [/^(open record|next request|view|open)\b/i, 'link'],
];

export type AnyLocator = Locator;

function roleFor(selector: Selector): string {
  if (selector.role) return selector.role;
  for (const [pattern, role] of DEFAULT_ROLE_BY_NAME) {
    if (pattern.test(selector.name ?? '')) return role;
  }
  return 'button';
}

/** Maps a semantic selector onto a Playwright locator. No CSS guessing. */
export function locatorFor(page: Page, selector: Selector): AnyLocator {
  const name = selector.name ?? selector.textPattern;
  switch (selector.strategy) {
    case 'role-name':
      return page.getByRole(roleFor(selector) as never, { name, exact: false });
    case 'text':
      return page.getByText(name ?? '', { exact: false });
    case 'testid':
      return selector.testId ? page.getByTestId(selector.testId) : page.locator('body');
    case 'css':
      return selector.value ? page.locator(selector.value) : page.locator('body');
    default:
      return name ? page.getByText(name, { exact: false }) : page.locator('body');
  }
}

export interface BindingAttempt {
  selector: Selector;
  matches: number;
  locator?: AnyLocator;
  error?: string;
}

/**
 * Tries the recorded candidates in weight order.
 *
 * A candidate only counts as resolved when it matches exactly one element.
 * "First match" is never used: silently clicking the wrong record is worse than
 * asking the user, and the healing pass exists precisely so that ambiguity
 * becomes a question rather than a guess.
 */
export async function resolveBinding(
  page: Page,
  step: Step,
  _timeoutMs = 2_000,
): Promise<{ resolved?: BindingAttempt; attempts: BindingAttempt[] }> {
  const attempts: BindingAttempt[] = [];
  const candidates = [...step.target.selectorCandidates].sort((a, b) => b.weight - a.weight);

  for (const selector of candidates) {
    const locator = locatorFor(page, selector);
    try {
      const matches = await locator.count();
      attempts.push({ selector, matches, locator });
      if (matches === 1) return { resolved: { selector, matches, locator }, attempts };
    } catch (cause) {
      attempts.push({
        selector,
        matches: 0,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return { attempts };
}

export interface HealResult {
  selector?: Selector;
  /** Candidates found but too close in score to choose between. */
  ambiguous: { name: string; role: string; score: number }[];
  scanned: number;
}

const ROLES = ['button', 'link', 'textbox', 'checkbox', 'tab', 'combobox'] as const;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return 0.85;
  if (a.includes(b) || b.includes(a)) return 0.7;
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * Single bounded attempt to re-derive a selector from the live page.
 *
 * It reads the accessibility tree the same way the user perceives the screen,
 * scores candidate controls against the recorded control names, and refuses to
 * answer when the top two are effectively tied. Returning `null` here is a
 * normal outcome that escalates to the user, not a failure.
 */
export async function healSelector(page: Page, step: Step): Promise<HealResult> {
  const wanted = step.target.selectorCandidates
    .map((s) => s.name ?? s.textPattern)
    .filter((n): n is string => Boolean(n))
    .map(normalize);
  if (wanted.length === 0) return { ambiguous: [], scanned: 0 };

  const scored: { name: string; role: string; score: number }[] = [];
  let scanned = 0;

  for (const role of ROLES) {
    const items = await page.getByRole(role as never).all();
    for (const item of items) {
      scanned++;
      const name = normalize((await item.getAttribute('aria-label')) ?? (await item.innerText().catch(() => '')) ?? '');
      if (!name) continue;
      const score = Math.max(...wanted.map((w) => similarity(w, name)));
      if (score >= 0.6) scored.push({ name, role, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const top = scored[0];
  const runnerUp = scored[1];
  if (!top) return { ambiguous: scored.slice(0, 3), scanned };
  // Two controls that match equally well are two *elements*, and clicking the
  // wrong one is the failure mode this whole pass exists to prevent.
  if (runnerUp && top.score - runnerUp.score < 0.05) {
    return { ambiguous: scored.slice(0, 3), scanned };
  }

  return {
    selector: { strategy: 'role-name', role: top.role, name: top.name, weight: 0.9, evidence: 'healed from live accessibility tree' },
    ambiguous: [],
    scanned,
  };
}

export function hasAmbiguity(result: HealResult): boolean {
  return !result.selector && result.ambiguous.length > 0;
}
