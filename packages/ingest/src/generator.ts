import type { ActivityEvent, ActivitySource, EventSink, IngestWarning } from '@workflowos/core';
import {
  applyTypo,
  fillTemplate,
  makeDataPool,
  mulberry32,
  selectorFor,
  type NoiseModel,
  type Persona,
  type PersonaInstance,
} from './persona.js';

export interface GeneratorOptions {
  persona: Persona;
  seed?: number;
  /** When true the noise model from the persona is applied. */
  noisy?: boolean;
  traceId?: string;
  /** Overrides the persona's noise model entirely. */
  noise?: NoiseModel;
}

const DISTRACTION_SITES = [
  { url: 'https://news.example.com/tech', title: 'Daily Briefing — Technology' },
  { url: 'https://wiki.example.com/benefits', title: 'Benefits FAQ — Internal Wiki' },
  { url: 'https://status.example.com', title: 'Status — Example Cloud' },
  { url: 'https://calendar.example.com/week', title: 'Week view — Calendar' },
];

const NOISE_CLICKS = [
  { role: 'button', name: 'Close' },
  { role: 'button', name: 'More options' },
  { role: 'link', name: 'Keyboard shortcuts' },
  { role: 'tab', name: 'Details' },
];

/**
 * Seeded synthetic trace generator.
 *
 * It produces the same trace for the same (persona, seed) pair, which is what
 * makes the golden manifests meaningful. The noise model is what exercises the
 * miner's similarity scoring and the compiler's slot extraction.
 */
export function generateTrace(options: GeneratorOptions): ActivityEvent[] {
  const { persona } = options;
  const rand = mulberry32(options.seed ?? 0x5eed);
  const noise = options.noise ?? (options.noisy ? persona.noise : zeroNoise(persona.noise));
  const traceId = options.traceId ?? `gen_${persona.id}`;
  const events: ActivityEvent[] = [];

  let ts = persona.startTs;
  let seq = 0;
  const push = (event: Omit<ActivityEvent, 'id' | 'seq' | 'ts' | 'source' | 'scenario'> & { ts?: number }) => {
    const full: ActivityEvent = {
      ...event,
      id: `${traceId}:${seq}`,
      seq: seq++,
      ts: event.ts ?? ts,
      source: 'generator',
      scenario: persona.label,
    };
    events.push(full);
    ts = Math.max(ts, full.ts) + 1;
    return full;
  };

  for (let occurrence = 0; occurrence < persona.repeat; occurrence++) {
    if (occurrence > 0) {
      // The gap between repetitions is where the distractions happen, in the
      // middle of it rather than glued to the next occurrence: real browsing
      // between two workflow runs is its own activity, not part of either.
      ts += persona.baseGapMs * 0.5;
      for (let d = 0; d < noise.interleaveBrowsing; d++) {
        const site = DISTRACTION_SITES[Math.floor(rand() * DISTRACTION_SITES.length)];
        push({
          app: { id: 'chrome', name: 'Google Chrome', kind: 'web' },
          action: { type: 'navigate' },
          target: { url: site.url, windowTitle: site.title },
        });
        if (rand() < 0.5) {
          push({
            app: { id: 'chrome', name: 'Google Chrome', kind: 'web' },
            action: { type: 'click' },
            element: { role: 'link', name: 'Read more' },
          });
        }
      }
      ts += persona.baseGapMs * 0.4;
    }

    const pools = persona.pools;
    const pool =
      pools && pools.length > 0
        ? makeDataPool(rand, pools[occurrence % pools.length])
        : makeDataPool(rand);
    const instances = orderInstances(persona.instances.map((i) => i), rand, noise);
    const alreadyLaunched = new Set<string>();

    for (const instance of instances) {
      const delay = instance.delayMs ?? 1200;
      ts += Math.round(delay * (0.7 + rand() * 0.6));

      if (instance.action.type === 'launch' && alreadyLaunched.has(instance.app.id)) continue;
      if (instance.action.type === 'launch') alreadyLaunched.add(instance.app.id);

      if (rand() < noise.idleRate) {
        push({
          app: instance.app,
          action: { type: 'idle' },
          value: { text: 'idle' },
        });
        ts += 30_000;
      }

      const selector = selectorFor(instance);
      const rawValue = instance.value?.template
        ? fillTemplate(instance.value.template, pool, rand)
        : undefined;
      const typed =
        instance.action.type === 'type' && rawValue && rand() < noise.typoRate
          ? applyTypo(rawValue, rand)
          : rawValue;

      push({
        app: instance.app,
        action: instance.action,
        target: instance.target
          ? {
              url: instance.target.url ? fillTemplate(instance.target.url, pool, rand) : undefined,
              windowTitle: instance.target.windowTitle
                ? fillTemplate(instance.target.windowTitle, pool, rand)
                : undefined,
            }
          : undefined,
        element: instance.element
          ? {
              role: instance.element.role,
              name: instance.element.name ? fillTemplate(instance.element.name, pool, rand) : undefined,
              text: instance.element.text ? fillTemplate(instance.element.text, pool, rand) : undefined,
              selectorCandidates: selector ? [selector] : undefined,
            }
          : undefined,
        value: typed ? { text: typed, sensitive: instance.value?.sensitive } : undefined,
      });

      if (instance.action.type === 'click' && rand() < noise.extraClickRate) {
        const noiseClick = NOISE_CLICKS[Math.floor(rand() * NOISE_CLICKS.length)];
        push({
          app: instance.app,
          action: { type: 'click' },
          element: { role: noiseClick.role, name: noiseClick.name },
        });
      }
    }
  }

  return events;
}

/**
 * Optional steps are shuffled and sometimes dropped, but their original
 * positions relative to the required steps are preserved. That is what a real
 * user's "I clicked the expand arrow this time" looks like, and it forces the
 * miner to score on similarity rather than exact equality.
 */
function orderInstances(
  instances: PersonaInstance[],
  rand: () => number,
  noise: NoiseModel,
): PersonaInstance[] {
  const optionals = instances.filter((i) => i.optional);
  for (let i = optionals.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [optionals[i], optionals[j]] = [optionals[j], optionals[i]];
  }
  const kept = optionals.filter(() => rand() >= noise.optionalJitterRate);

  let cursor = 0;
  return instances.flatMap((instance) => {
    if (!instance.optional) return instance;
    const replacement = kept[cursor++];
    return replacement ? [replacement] : [];
  });
}

function zeroNoise(_noise: NoiseModel): NoiseModel {
  return {
    extraClickRate: 0,
    typoRate: 0,
    idleRate: 0,
    optionalJitterRate: 0,
    interleaveBrowsing: 0,
  };
}

export class GeneratorSource implements ActivitySource {
  readonly kind = 'generator' as const;
  readonly traceId: string;
  private stopped = false;

  constructor(private readonly options: GeneratorOptions) {
    this.traceId = options.traceId ?? `gen_${options.persona.id}`;
  }

  async start(sink: EventSink, onWarning?: (w: IngestWarning) => void): Promise<{ emitted: number }> {
    const events = generateTrace(this.options);
    let emitted = 0;
    for (const event of events) {
      if (this.stopped) break;
      await sink(event);
      emitted++;
    }
    onWarning?.({ code: 'generated', message: `Generated ${emitted} events for ${this.traceId}` });
    return { emitted };
  }

  stop(): void {
    this.stopped = true;
  }
}
