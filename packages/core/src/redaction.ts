import type { ActivityEvent, PlaceholderKind } from './activity.js';

export const REDACTED = '[REDACTED]';

interface ValueRule {
  kind: PlaceholderKind;
  token: string;
  re: RegExp;
}

/**
 * Redaction removes the secret but keeps its category.
 *
 * Discovery needs to know that a value was an email address, not the address
 * itself, otherwise every redacted run degrades to "some text" and the compiled
 * workflow loses the variable typing that makes it reviewable. The token is
 * therefore shape-preserving and the normaliser maps it back to a placeholder
 * kind; the original never reaches the store.
 */
const VALUE_RULES: ValueRule[] = [
  { kind: 'email', token: '[REDACTED_EMAIL]', re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g },
  { kind: 'num', token: '[REDACTED_CARD]', re: /\b(?:\d[ -]*?){13,19}\b/g },
  { kind: 'num', token: '[REDACTED_SSN]', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'num', token: '[REDACTED_PHONE]', re: /\b(?:\+?\d[\d ()-]{8,}\d)\b/g },
];

/** A value whose entire content was one sensitive value still knows its kind. */
export function redactionKindFor(text: string | undefined): PlaceholderKind | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  const match = VALUE_RULES.find((rule) => rule.token === trimmed);
  return match?.kind;
}

const SENSITIVE_NAME_PATTERN =
  /(password|passcode|otp|2fa|ssn|social security|credit card|card number|cvv|api key|secret|token)/i;

export interface RedactionPolicy {
  /** Apps whose entire event stream is treated as sensitive. */
  sensitiveAppIds: string[];
  /** Redact anything that looks like a secret regardless of app. */
  redactValuePatterns: boolean;
}

export const defaultRedactionPolicy: RedactionPolicy = {
  sensitiveAppIds: ['banking', 'password-manager', '1password', 'lastpass'],
  redactValuePatterns: true,
};

function matchesValuePattern(text: string): boolean {
  return VALUE_RULES.some((rule) => {
    rule.re.lastIndex = 0;
    return rule.re.test(text);
  });
}

function redactText(text: string): string {
  let out = text;
  for (const rule of VALUE_RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, rule.token);
  }
  return out;
}

export function isSensitiveEvent(
  event: ActivityEvent,
  policy: RedactionPolicy = defaultRedactionPolicy,
): boolean {
  if (event.sensitive) return true;
  if (policy.sensitiveAppIds.includes(event.app.id.toLowerCase())) return true;
  if (SENSITIVE_NAME_PATTERN.test(event.element?.name ?? '')) return true;
  if (policy.redactValuePatterns && event.value?.text) {
    return matchesValuePattern(event.value.text);
  }
  return false;
}

/**
 * True when the control itself is secret, e.g. a password field.
 *
 * This is the only case where the element name and its selectors are destroyed:
 * the name of a password field is not a secret, but nothing about it may be
 * used to address the field, and the value certainly may not be.
 */
function isControlSensitive(
  event: ActivityEvent,
  policy: RedactionPolicy = defaultRedactionPolicy,
): boolean {
  if (event.sensitive) return true;
  if (policy.sensitiveAppIds.includes(event.app.id.toLowerCase())) return true;
  return SENSITIVE_NAME_PATTERN.test(event.element?.name ?? '');
}

/**
 * Redacts an event without mutating the input, because the replayer may still
 * need the original for its own bookkeeping.
 *
 * The important distinction is between the *value* the user typed, which is
 * frequently a secret and is always replaced, and the *name of the control*,
 * which the application owns and discovery depends on. Typing an email address
 * into a field called "Search customers" must not blind the engine to a control
 * it can see perfectly well.
 */
export function redactEvent(
  event: ActivityEvent,
  policy: RedactionPolicy = defaultRedactionPolicy,
): { event: ActivityEvent; redacted: boolean } {
  if (!isSensitiveEvent(event, policy)) return { event, redacted: false };

  const controlSensitive = isControlSensitive(event, policy);
  const value = event.value?.text
    ? policy.redactValuePatterns || controlSensitive
      ? { ...event.value, text: redactText(event.value.text), sensitive: true }
      : event.value
    : event.value;

  const element = !event.element
    ? event.element
    : controlSensitive
      ? {
          ...event.element,
          name: event.element.name ? REDACTED : event.element.name,
          text: event.element.text ? REDACTED : event.element.text,
          selectorCandidates: event.element.selectorCandidates?.map((c) => ({
            ...c,
            name: c.name ? REDACTED : c.name,
            value: c.value ? REDACTED : c.value,
          })),
        }
      : event.element;

  return {
    redacted: true,
    event: { ...event, sensitive: true, value, element },
  };
}

export function redactEvents(
  events: readonly ActivityEvent[],
  policy: RedactionPolicy = defaultRedactionPolicy,
): { events: ActivityEvent[]; redactedCount: number } {
  let redactedCount = 0;
  const out = events.map((e) => {
    const r = redactEvent(e, policy);
    if (r.redacted) redactedCount++;
    return r.event;
  });
  return { events: out, redactedCount };
}
