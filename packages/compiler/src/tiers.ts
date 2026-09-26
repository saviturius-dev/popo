import type { AppKind, Tier } from '@workflowos/core';
import { TIER_ORDER } from '@workflowos/core';

/**
 * The spec's priority is API → app integration → accessibility → browser
 * automation → CV fallback.
 *
 * For web targets "accessibility" and "browser automation" are the same
 * mechanism (Playwright's `getByRole` is an accessibility query), so they are
 * collapsed into a single `web-semantic` tier. Keeping them apart would make
 * the resolver claim a distinction the mechanism does not make.
 */
export function preferredTiers(appKind: AppKind, hasApiCandidate: boolean): Tier[] {
  const base: Tier[] = hasApiCandidate
    ? ['api', 'app-integration', ...restFor(appKind)]
    : [...restFor(appKind)];
  return base;
}

function restFor(appKind: AppKind): Tier[] {
  switch (appKind) {
    case 'web':
      return ['web-semantic', 'browser-automation', 'cv-fallback'];
    case 'desktop':
      return ['desktop-uia', 'cv-fallback'];
    case 'system':
    default:
      return TIER_ORDER.filter((t) => t === 'api' || t === 'app-integration');
  }
}

export const TIER_DESCRIPTIONS: Record<Tier, string> = {
  api: 'Direct API call against the application integration',
  'app-integration': 'Application-specific integration (OAuth, plugin, extension)',
  'web-semantic': 'Playwright accessibility/DOM queries (getByRole, getByLabel)',
  'desktop-uia': 'Windows UI Automation via the accessibility API',
  'browser-automation': 'Playwright browser automation',
  'cv-fallback': 'Computer-vision / coordinate fallback',
  unsupported: 'No mechanism available for this step',
};
