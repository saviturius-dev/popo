import type { Tier } from '@workflowos/core';
import { BrowserPool } from './browserPool.js';
import { createTierRegistry, type TierRegistry } from './tierResolver.js';
import { SlackApiAdapter } from './adapters/slackApi.js';
import { MailAttachmentIntegration } from './adapters/mailIntegration.js';
import { PlaywrightSemanticAdapter } from './adapters/playwrightSemantic.js';
import { UiaSidecarAdapter } from './adapters/uiaSidecar.js';
import { CvFallbackAdapter } from './adapters/cvFallback.js';

export interface DefaultRegistryOptions {
  pool?: BrowserPool;
  downloadDir?: string;
  enableUia?: boolean;
  headless?: boolean;
}

export interface DefaultEngine {
  registry: TierRegistry;
  pool: BrowserPool;
  dispose(): Promise<void>;
}

/**
 * Wires the tier ladder exactly once, in the order the spec defines.
 *
 * The Playwright adapter is registered for both `web-semantic` and
 * `browser-automation` because for a web target those are the same mechanism;
 * the resolver will still report the preferred name.
 */
export function createDefaultRegistry(options: DefaultRegistryOptions = {}): DefaultEngine {
  const pool = options.pool ?? new BrowserPool({ headless: options.headless ?? true });
  const registry = createTierRegistry();

  registry.register(new SlackApiAdapter(), ['api']);
  registry.register(new MailAttachmentIntegration({ downloadDir: options.downloadDir }), [
    'app-integration',
  ]);
  registry.register(new PlaywrightSemanticAdapter({ pool }), [
    'web-semantic',
    'browser-automation',
  ]);
  registry.register(new UiaSidecarAdapter({ enabled: options.enableUia }), ['desktop-uia']);
  registry.register(new CvFallbackAdapter(), ['cv-fallback']);

  const disabled: Tier[] = [];
  if (!options.enableUia) disabled.push('desktop-uia');

  return {
    registry,
    pool,
    async dispose() {
      await pool.close();
    },
  };
}
