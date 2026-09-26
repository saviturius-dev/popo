import type {
  ActivityEvent,
  NormalizedEvent,
  Placeholder,
  PlaceholderKind,
  Selector,
} from '@workflowos/core';
import { redactionKindFor } from '@workflowos/core';

interface Rule {
  kind: PlaceholderKind;
  re: RegExp;
  /** Rendered token, e.g. `<email>`. */
  token: string;
}

/**
 * Volatile-substitution rules, applied in order. Earlier rules win, so a value
 * that is an email inside a longer string becomes `<email>` rather than
 * `<text>`; the remaining free text then becomes `<text>`.
 */
const RULES: Rule[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, token: '<email>' },
  {
    kind: 'id',
    re: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
    token: '<id>',
  },
  { kind: 'date', re: /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?Z?)?/g, token: '<date>' },
  { kind: 'path', re: /[A-Za-z]:\\[^\s"']+|\\\\[^\s"']+/g, token: '<path>' },
  { kind: 'id', re: /\b[0-9a-fA-F]{16,}\b/g, token: '<id>' },
  { kind: 'num', re: /\b\d{4,}\b/g, token: '<num>' },
];

const SECRET_NAME = /(password|passcode|otp|2fa|cvv|card\s*number|api\s*key|secret)/i;
const GENERIC_NAMES = new Set(['search', 'query', 'filter', 'input', 'field', 'textbox']);

/**
 * Turns a raw event into a canonical token plus the variable slots observed in
 * it. Pure and deterministic: this is the function whose output the golden
 * manifests pin.
 *
 * The token grammar is `app:action[:role=<role>][:name=<name>][:url=<path>][:value=<value>]`.
 */
export function normalizeEvent(event: ActivityEvent): NormalizedEvent {
  const placeholders: Placeholder[] = [];
  const seenKinds = new Map<PlaceholderKind, number>();
  let replaced = 0;
  let total = 0;

  const addPlaceholder = (kind: PlaceholderKind, example: string, confidence: number) => {
    const index = (seenKinds.get(kind) ?? 0) + 1;
    seenKinds.set(kind, index);
    placeholders.push({ name: `${kind}_${index}`, kind, example, confidence });
  };

  /**
   * Replaces structured substrings only. Free text is handled by the caller
   * through `primary`, because "is this one variable or a literal label with a
   * number in it" is a decision about the whole value, not about each match.
   *
   * `trackVolatility` is false for control names: volatility describes how much
   * of the *user's* input changes between runs, and a field label does not.
   */
  const substitute = (input: string, confidence: number, trackVolatility = true): string => {
    if (trackVolatility) total += input.length;
    let out = input;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      out = out.replace(rule.re, (match) => {
        if (trackVolatility) replaced += match.length;
        addPlaceholder(rule.kind, match, confidence);
        return rule.token;
      });
    }
    return out.replace(/\s+/g, ' ').trim();
  };

  const parts: string[] = [event.app.id, event.action.type];
  let primary: Placeholder | undefined;

  const role = event.element?.role ? normalizeLabel(event.element.role) : undefined;
  if (role) parts.push(`role=${role}`);

  const rawName = event.element?.name;
  if (rawName) {
    const isSecret = SECRET_NAME.test(rawName);
    if (isSecret) {
      addPlaceholder('text', '[secret]', 0.9);
      parts.push('name=<secret>');
    } else {
      const name = normalizeLabel(rawName);
      if (GENERIC_NAMES.has(name) && event.value?.text) {
        parts.push(`name=${name}`);
      } else {
        // A control name comes from the application, not the user, so only
        // structured substrings (ids, emails) are masked. Collapsing it to
        // <text> would erase exactly the signal discovery depends on.
        parts.push(`name=${substitute(name, 0.75, false)}`);
      }
    }
  }

  if (
    event.target?.url &&
    (event.action.type === 'navigate' || event.action.type === 'submit' || event.action.type === 'focus')
  ) {
    parts.push(`url=${normalizeUrl(event.target.url)}`);
  }

  const valueText = event.value?.text;
  if (valueText && event.action.type !== 'idle') {
    if (event.value?.sensitive || SECRET_NAME.test(event.element?.name ?? '')) {
      // A redacted value keeps its category, not its content: a redacted email
      // address still compiles to an `email` variable.
      const kind = SECRET_NAME.test(event.element?.name ?? '')
        ? 'text'
        : (redactionKindFor(valueText) ?? 'text');
      const example = SECRET_NAME.test(event.element?.name ?? '') ? '[secret]' : valueText;
      addPlaceholder(kind, example, 0.95);
      parts.push(`value=<${kind}>`);
      primary = { name: `${kind}_1`, kind, example, confidence: 0.95 };
    } else {
      const trimmed = valueText.trim();
      const before = placeholders.length;
      const normalizedValue = substitute(trimmed, 0.8, false);
      const ruleMatched = placeholders.length > before;

      if (ruleMatched && /^<[a-z]+>$/.test(normalizedValue)) {
        // The whole value is a single structured value: an email, an id.
        const kind = normalizedValue.slice(1, -1) as PlaceholderKind;
        primary =
          placeholders.slice(before).find((p) => p.kind === kind) ??
          ({ name: `${kind}_1`, kind, example: trimmed, confidence: 0.85 } as Placeholder);
      } else if (ruleMatched) {
        // Structured fragments inside a longer value: the user typed one thing.
        primary = { name: 'text_1', kind: 'text', example: trimmed, confidence: 0.75 };
      } else if (trimmed.length >= 12) {
        primary = { name: 'text_1', kind: 'text', example: trimmed, confidence: 0.6 };
        addPlaceholder('text', trimmed, primary.confidence);
      }

      parts.push(`value=${primary ? placeholderFor(primary) : normalizedValue}`);
    }
  }

  const volatility = total === 0 ? 0 : Math.min(1, replaced / total);

  return { event, token: parts.join(':'), placeholders, primary, volatility };
}

function placeholderFor(placeholder: Placeholder): string {
  return `<${placeholder.kind}>`;
}

export function normalizeEvents(events: readonly ActivityEvent[]): NormalizedEvent[] {
  return events.map((e) => normalizeEvent(e));
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Keeps the path shape, drops the origin, and masks ids inside the path. */
export function normalizeUrl(url: string): string {
  let path = url;
  try {
    const parsed = new URL(url);
    path = parsed.pathname + (parsed.search ? parsed.search : '');
  } catch {
    path = url.split('?')[0];
  }
  let out = path.replace(/\/+$/, '') || '/';
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, rule.token);
  }
  return out;
}

export function selectorKey(selector: Selector): string {
  return [
    selector.strategy,
    selector.role ?? '',
    selector.name ?? '',
    selector.textPattern ?? '',
    selector.testId ?? '',
    selector.value ?? '',
  ].join('|');
}

export function mergePlaceholders(groups: readonly Placeholder[][]): Placeholder[] {
  const byKind = new Map<PlaceholderKind, { examples: string[]; confidence: number; count: number }>();
  for (const group of groups) {
    for (const p of group) {
      const entry = byKind.get(p.kind) ?? { examples: [], confidence: 0, count: 0 };
      if (!entry.examples.includes(p.example) && entry.examples.length < 5) entry.examples.push(p.example);
      entry.confidence += p.confidence;
      entry.count += 1;
      byKind.set(p.kind, entry);
    }
  }
  const out: Placeholder[] = [];
  for (const [kind, entry] of byKind) {
    out.push({
      name: kind,
      kind,
      example: entry.examples[0] ?? '',
      confidence: entry.count === 0 ? 0 : entry.confidence / entry.count,
    });
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind));
}
