import type { ActivityEvent, ActivitySource, EventSink, IngestWarning } from '@workflowos/core';
import { errors } from '@workflowos/core';

/**
 * Placeholder for a live Windows observer (UIAutomation event subscribers,
 * Win32 foreground/clipboard hooks, filesystem watchers).
 *
 * It is intentionally unimplemented in v1: every downstream component depends
 * only on `ActivitySource`, so filling this in later requires no changes to
 * discovery, compilation, or execution.
 */
export class CaptureSource implements ActivitySource {
  readonly kind = 'capture' as const;
  private stopped = false;

  constructor(readonly traceId: string) {}

  async start(_sink: EventSink, _onWarning?: (w: IngestWarning) => void): Promise<{ emitted: number }> {
    throw errors.ingest(
      'capture_not_implemented',
      'Live Windows capture is out of scope for v1; use ReplaySource or GeneratorSource',
      { traceId: this.traceId },
    );
  }

  stop(): void {
    this.stopped = true;
  }

  get isStopped(): boolean {
    return this.stopped;
  }
}

export type { ActivityEvent };
