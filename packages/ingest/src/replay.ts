import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import type { ActivityEvent, ActivitySource, EventSink, IngestWarning } from '@workflowos/core';
import { errors } from '@workflowos/core';
import { parseTraceLine } from './schema.js';

export interface ReplaySourceOptions {
  traceId: string;
  path?: string;
  /** Raw JSONL content; takes precedence over `path` (used by tests). */
  content?: string;
  /**
   * Wall-clock pacing. `0` replays instantly (tests, CI); `1` honours the
   * recorded timestamps with a virtual clock.
   */
  speed?: number;
  maxBadLineRatio?: number;
}

export interface ReplayResult {
  emitted: number;
  badLines: number;
  durationMs: number;
}

/**
 * Replays a committed trace through the ingest port.
 *
 * Malformed lines are skipped with a warning rather than aborting the trace,
 * unless the damage exceeds `maxBadLineRatio`, at which point the trace is not
 * trustworthy and ingestion fails loudly.
 */
export class ReplaySource implements ActivitySource {
  readonly kind = 'replay' as const;
  readonly traceId: string;
  private stopped = false;

  constructor(private readonly options: ReplaySourceOptions) {
    if (!options.path && options.content === undefined) {
      throw errors.ingest('missing_trace', 'ReplaySource requires either path or content');
    }
    this.traceId = options.traceId;
  }

  async start(sink: EventSink, onWarning?: (w: IngestWarning) => void): Promise<ReplayResult> {
    const started = Date.now();
    const events = this.read();
    // A skipped line is a fact the operator should see, not a silent loss: the
    // trace is still usable, but the run is working from less than was recorded.
    for (const warning of this.warnings) onWarning?.(warning);
    const speed = this.options.speed ?? 0;
    const baseTs = events[0]?.ts ?? 0;
    const wallStart = Date.now();

    let emitted = 0;
    for (const event of events) {
      if (this.stopped) break;
      if (speed > 0) {
        const target = wallStart + (event.ts - baseTs) / speed;
        const wait = target - Date.now();
        if (wait > 0) await sleep(wait);
      }
      await sink(event);
      emitted++;
    }

    return { emitted, badLines: this.badLines, durationMs: Date.now() - started };
  }

  stop(): void {
    this.stopped = true;
  }

  private badLines = 0;
  private warnings: IngestWarning[] = [];

  private read(): ActivityEvent[] {
    const raw = this.options.content ?? readFileSync(this.options.path as string, 'utf8');
    const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const events: ActivityEvent[] = [];
    this.badLines = 0;
    this.warnings = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#') || line.startsWith('//')) continue;
      const parsed = parseTraceLine(line);
      if (!parsed) {
        this.badLines++;
        this.warnings.push({
          code: 'line_skipped',
          message: `skipped unparseable line ${i + 1} of ${lines.length}`,
          details: { traceId: this.traceId, line: i + 1, total: lines.length },
        });
        continue;
      }
      events.push({
        ...parsed,
        id: parsed.id ?? `${this.traceId}:${i}`,
        seq: parsed.seq ?? events.length,
        source: 'replay',
        scenario: parsed.scenario,
      });
    }

    const maxBad = this.options.maxBadLineRatio ?? 0.1;
    const ratio = lines.length === 0 ? 0 : this.badLines / lines.length;
    if (ratio > maxBad) {
      throw errors.ingest(
        'trace_corrupt',
        `Trace ${this.traceId} looks corrupt: ${this.badLines}/${lines.length} unparseable lines`,
        { traceId: this.traceId, badLines: this.badLines, total: lines.length, ratio },
      );
    }

    return events;
  }

  /** Streaming variant, used by the CLI so a large trace never fully buffers. */
  static async stream(
    path: string,
    onEvent: (line: string, index: number) => void,
  ): Promise<number> {
    const rl = createInterface({
      input: createReadStream(path, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    let i = 0;
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      onEvent(trimmed, i++);
    }
    return i;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
