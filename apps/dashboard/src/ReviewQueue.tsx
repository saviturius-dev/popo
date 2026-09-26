import { useState } from 'react';
import { api, type ReviewRequest, type Selector } from './api.js';

export function ReviewQueue({
  reviews,
  onAnswered,
}: {
  reviews: ReviewRequest[];
  onAnswered(): void;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  if (reviews.length === 0) {
    return (
      <div className="blueprint-card" style={{ padding: '20px 14px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-bitmap)', fontSize: '20px', color: 'var(--term-green)', marginBottom: '4px' }}>
          ✓ All Clear!
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          No actions currently require your review or approval.
        </div>
      </div>
    );
  }

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
    <div>
      {reviews.map((review) => {
        const payload = review.payload as {
          stepLabel?: string;
          tier?: string;
          detail?: string;
          mechanism?: string;
          candidates?: { role?: string; name?: string; strategy?: string }[];
        };
        const isImportant = review.risk === 'irreversible';

        return (
          <div
            key={review.id}
            className={`review-cad-box ${isImportant ? 'danger-zone' : ''}`}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span className={`cad-pill ${isImportant ? 'risk-irreversible' : 'risk-write'}`}>
                {isImportant ? '⚠️ Needs Your Permission' : 'ℹ️ Clarification Needed'}
              </span>
              <span className="spec-stamp">Decision Required</span>
            </div>

            <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#f7fee7', marginBottom: '8px', lineHeight: 1.4 }}>
              {getFriendlyMessage(review.message)}
            </div>

            {payload.detail && (
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', background: '#192014', padding: '8px 10px', border: '1px solid var(--border-raw)', marginBottom: '10px' }}>
                <strong>Details:</strong> {payload.detail}
              </div>
            )}

            {payload.candidates && payload.candidates.length > 0 && (
              <div style={{ margin: '10px 0' }}>
                <div style={{ fontSize: '11px', color: 'var(--term-amber)', marginBottom: '6px' }}>
                  Please pick which item on the screen you intended to click:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {payload.candidates.map((cand, i) => (
                    <button
                      key={i}
                      type="button"
                      className="btn-brutal secondary"
                      style={{ justifyContent: 'space-between', fontSize: '11px', padding: '6px 10px' }}
                      disabled={busy === review.id}
                      onClick={() =>
                        answer(review, 'confirmed', {
                          strategy: (cand.strategy ?? 'role-name') as Selector['strategy'],
                          role: cand.role,
                          name: cand.name,
                          weight: 1,
                        })
                      }
                    >
                      <span>Click “{cand.name || cand.role || 'this option'}”</span>
                      <span className="spec-stamp">Choose This</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
              <button
                type="button"
                className="btn-brutal"
                style={{ flex: 1 }}
                disabled={busy === review.id}
                onClick={() => answer(review, 'confirmed')}
              >
                {busy === review.id ? 'Confirming...' : '✓ Yes, Allow This Action'}
              </button>
              <button
                type="button"
                className="btn-brutal danger"
                disabled={busy === review.id}
                onClick={() => answer(review, 'cancelled')}
              >
                Cancel Action
              </button>
            </div>
          </div>
        );
      })}
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}

function getFriendlyMessage(msg: string): string {
  if (msg.includes('irreversible')) {
    return 'The AI is about to send a message or external update. Would you like to proceed?';
  }
  return msg;
}
