import { useState } from 'react';
import { api, type ReviewRequest, type Selector } from './api.js';

/**
 * The gate queue.
 *
 * Every entry here is a decision the engine refused to make on its own: a write
 * it is about to perform, a target it could not resolve unambiguously, a guard
 * that tripped. A binding escalation also offers the candidates it found, so
 * choosing is a click rather than a re-run.
 */
export function ReviewQueue({
  reviews,
  onAnswered,
}: {
  reviews: ReviewRequest[];
  onAnswered(): void;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  if (reviews.length === 0) return <p className="empty">Nothing waiting on you.</p>;

  const answer = async (review: ReviewRequest, resolution: string, selector?: Selector) => {
    setBusy(review.id);
    setError(undefined);
    try {
      await api.respond(review.id, resolution, selector);
      onAnswered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <ul className="reviews">
        {reviews.map((review) => {
          const payload = review.payload as {
            stepLabel?: string;
            tier?: string;
            detail?: string;
            mechanism?: string;
            candidates?: { role?: string; name?: string; strategy?: string }[];
          };
          return (
            <li key={review.id} className={`review risk-${review.risk ?? 'read'}`}>
              <div className="badges">
                <span className="pill">{review.kind}</span>
                {review.risk && <span className={`pill risk-${review.risk}`}>{review.risk}</span>}
                {payload.tier && <span className="pill">{payload.tier}</span>}
              </div>
              <p>{review.message}</p>
              {payload.detail && <div className="muted">{payload.detail}</div>}
              {payload.candidates && payload.candidates.length > 0 && (
                <ul className="candidates-list">
                  {payload.candidates.map((candidate, i) => (
                    <li key={`${candidate.strategy}-${candidate.role}-${candidate.name}-${i}`}>
                      <button
                        type="button"
                        disabled={busy === review.id}
                        onClick={() =>
                          answer(review, 'confirmed', {
                            strategy: (candidate.strategy ?? 'role-name') as Selector['strategy'],
                            role: candidate.role,
                            name: candidate.name,
                            weight: 1,
                          })
                        }
                      >
                        use {candidate.role ?? candidate.strategy}
                        {candidate.name ? ` “${candidate.name}”` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="actions">
                <button
                  type="button"
                  disabled={busy === review.id}
                  onClick={() => answer(review, 'confirmed')}
                >
                  Allow
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy === review.id}
                  onClick={() => answer(review, 'cancelled')}
                >
                  Stop
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="banner error">{error}</p>}
    </>
  );
}
