import type { AutomationAdapter, ExecutionEnvironment, Step, Tier } from '@workflowos/core';
import { TIER_ORDER } from '@workflowos/core';
import { errors } from '@workflowos/core';

export interface TierResolution {
  tier: Tier;
  adapter?: AutomationAdapter;
  /** One entry per tier in the step's preference order. */
  considered: { tier: Tier; available: boolean; reason?: string }[];
}

export interface TierRegistry {
  register(adapter: AutomationAdapter, tiers?: Tier[]): void;
  get(tier: Tier): AutomationAdapter | undefined;
  enabled(tier: Tier): boolean;
  setEnabled(tier: Tier, enabled: boolean): void;
  tiers(): Tier[];
  /**
   * App ids for which a real integration is registered.
   *
   * The compiler cannot know this at discovery time, so the runner consults the
   * registry and promotes `api` / `app-integration` to the front of the order
   * for exactly those apps. That is the runtime half of "prefer APIs where
   * available".
   */
  appsWithIntegration(): string[];
}

export function createTierRegistry(): TierRegistry {
  const adapters = new Map<Tier, AutomationAdapter>();
  const disabled = new Set<Tier>();
  return {
    register(adapter, tiers) {
      for (const tier of tiers ?? [adapter.tier]) adapters.set(tier, adapter);
    },
    get: (tier) => adapters.get(tier),
    enabled: (tier) => adapters.has(tier) && !disabled.has(tier),
    setEnabled(tier, value) {
      if (value) disabled.delete(tier);
      else disabled.add(tier);
    },
    tiers: () => [...adapters.keys()].sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)),
    appsWithIntegration() {
      const apps = new Set<string>();
      for (const adapter of new Set(adapters.values())) {
        for (const [tier, candidate] of adapters) {
          if (candidate !== adapter) continue;
          if (tier !== 'api' && tier !== 'app-integration') continue;
          if (!adapter.handlesApp) continue;
          for (const id of KNOWN_APP_IDS) if (adapter.handlesApp(id)) apps.add(id);
        }
      }
      return [...apps].sort();
    },
  };
}

/**
 * App ids the runtime will ask adapters about.
 *
 * The list is derived from the workflows that exist, which the registry does
 * not know, so it is passed in by the orchestrator at construction time.
 */
let KNOWN_APP_IDS: string[] = [];

export function setKnownAppIds(appIds: readonly string[]): void {
  KNOWN_APP_IDS = [...appIds];
}

/**
 * Where the integration tiers come from.
 *
 * The compiler only emits `api` when the observation itself proved a data-level
 * target existed. At run time the registry knows which integrations are actually
 * wired up, so it gets to promote them for the apps it serves.
 */
export function effectiveOrder(step: Step, registry: TierRegistry): Tier[] {
  const base = step.resolveTier.length > 0 ? step.resolveTier : [...TIER_ORDER];
  if (!registry.appsWithIntegration().includes(step.target.appId)) return base;
  const promoted: Tier[] = ['api', 'app-integration'];
  for (const tier of base) {
    if (tier !== 'api' && tier !== 'app-integration') promoted.push(tier);
  }
  return promoted;
}

/**
 * Picks the most reliable mechanism available for a step.
 *
 * It walks the step's own preference order (which the compiler derived from the
 * target application) and returns the first registered and enabled adapter,
 * recording why every earlier tier was skipped. The dashboard shows that trace
 * verbatim, so a run never claims a mechanism it did not use.
 */
export async function resolveTier(
  step: Step,
  registry: TierRegistry,
  env: ExecutionEnvironment,
): Promise<TierResolution> {
  const considered: TierResolution['considered'] = [];
  const order = effectiveOrder(step, registry);

  for (const tier of order) {
    const adapter = registry.get(tier);
    if (!adapter) {
      considered.push({ tier, available: false, reason: 'no adapter registered' });
      continue;
    }
    if (!registry.enabled(tier)) {
      considered.push({ tier, available: false, reason: 'adapter disabled' });
      continue;
    }
    const availability = await adapter.isAvailable(step, env);
    considered.push({ tier, available: availability.available, reason: availability.reason });
    if (availability.available) return { tier, adapter, considered };
  }

  throw errors.tier(
    'no_mechanism',
    `No automation mechanism available for step "${step.label}"`,
    { stepId: step.id, considered },
  );
}
