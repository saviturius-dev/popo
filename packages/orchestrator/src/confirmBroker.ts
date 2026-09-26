import type {
  EventPublisher,
  ReviewRequest,
  Selector,
} from '@workflowos/core';
import type { ConfirmationBroker, ConfirmationRequest } from '@workflowos/execution';
import type { Store } from '@workflowos/store';

interface Pending {
  resolve(value: boolean | Selector | null): void;
  timer: NodeJS.Timeout;
}

export interface ReviewAnswer {
  resolution: 'approved' | 'rejected' | 'confirmed' | 'cancelled';
  selector?: Selector;
}

/** How long a gate waits before it gives up and declines. */
const DEFAULT_GATE_TIMEOUT_MS = 10 * 60_000;

/**
 * Turns the runner's human-in-the-loop gates into review requests.
 *
 * Nothing in the pipeline is allowed to answer its own gate: the runner blocks
 * here until the user acts in the dashboard, the run is aborted, or the request
 * times out. A timeout declines, because "nobody answered" must never be
 * interpreted as "yes, go ahead and send that message".
 */
export class ReviewBroker implements ConfirmationBroker {
  private readonly pending = new Map<string, Pending>();
  private counter = 0;
  private readonly timeoutMs: number;

  constructor(
    private readonly store: Store,
    private readonly bus: EventPublisher,
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
  }

  async confirmStep(request: ConfirmationRequest): Promise<boolean> {
    const review = this.store.reviews.insert(this.toReview(request));
    // The waiter is registered before publishing so a dashboard that answers
    // the instant it sees the event cannot beat the promise into existence.
    const answer = this.wait(review.id);
    this.publishCreated(review);
    return (await answer) === true;
  }

  async confirmBinding(request: ConfirmationRequest & { candidates: unknown[] }): Promise<Selector | null> {
    const review = this.store.reviews.insert(this.toReview(request));
    const answer = this.wait(review.id);
    this.publishCreated(review);
    const resolved = await answer;
    return typeof resolved === 'object' && resolved !== null ? resolved : null;
  }

  private publishCreated(review: ReviewRequest): void {
    this.bus.publish({
      type: 'review.created',
      requestId: review.id,
      kind: review.kind,
      workflowId: review.workflowId,
    });
  }

  respond(reviewId: string, answer: ReviewAnswer): boolean {
    const pending = this.pending.get(reviewId);
    this.store.reviews.resolve(reviewId, answer.resolution, Date.now());
    this.bus.publish({ type: 'review.resolved', requestId: reviewId, resolution: answer.resolution });
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(reviewId);
    pending.resolve(
      answer.resolution === 'approved' || answer.resolution === 'confirmed'
        ? answer.selector ?? true
        : null,
    );
    return true;
  }

  /** Called when a run is aborted so no gate is left hanging. */
  cancelForRun(runId: string, _reason = 'run aborted'): void {
    for (const review of this.store.reviews.listPending()) {
      if (review.runId === runId) {
        this.store.reviews.resolve(review.id, 'cancelled', Date.now());
        this.bus.publish({ type: 'review.resolved', requestId: review.id, resolution: 'cancelled' });
        const pending = this.pending.get(review.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(review.id);
          pending.resolve(false);
        }
      }
    }
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private wait(reviewId: string): Promise<boolean | Selector | null> {
    return new Promise<boolean | Selector | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(reviewId);
        this.store.reviews.resolve(reviewId, 'cancelled', Date.now());
        resolve(false);
      }, this.timeoutMs);
      this.pending.set(reviewId, { resolve, timer });
    });
  }

  private toReview(request: ConfirmationRequest): ReviewRequest {
    this.counter++;
    return {
      id: `rev_${Date.now().toString(36)}_${this.counter}`,
      kind: request.kind === 'binding' ? 'binding-confirmation' : 'step-confirmation',
      workflowId: request.workflowId || undefined,
      runId: request.runId,
      stepId: request.step?.id ?? request.stepId,
      risk: request.risk ?? request.step?.risk,
      createdAt: Date.now(),
      message: request.message,
      payload: {
        stepLabel: request.step?.label,
        action: request.step?.action,
        tier: request.tier,
        detail: request.detail,
        candidates: request.candidates ?? [],
        mechanism: request.kind,
      },
    };
  }
}
