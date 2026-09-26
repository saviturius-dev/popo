import { useState } from 'react';
import { api } from './api.js';

const TRACES = [
  { traceId: 'a_customer_request', label: 'Process a customer request (clean)' },
  { traceId: 'b_customer_request', label: 'Process a customer request (noisy)' },
  { traceId: 'c_two_workflows', label: 'Two workflows in one trace' },
  { traceId: 'd_one_off', label: 'One-off activity (nothing to automate)' },
];

/**
 * Starting observation is a button, not a watcher.
 *
 * Ingesting a trace is cheap but compiling a workflow produces something the
 * user has to review, so the trigger is an explicit choice of which recorded
 * activity to learn from. Live capture is out of scope for v1 and is not offered
 * here rather than being offered and broken.
 */
export function DiscoverControl({ onDiscovered }: { onDiscovered(): void }) {
  const [selected, setSelected] = useState(TRACES[0].traceId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();

  const trace = TRACES.find((t) => t.traceId === selected)!;

  async function discover() {
    setBusy(true);
    setResult(undefined);
    try {
      const response = await api.ingest(selected, pathFor(trace));
      setResult(
        `${response.workflows.length} workflow(s) awaiting review${
          response.candidates.length > 0 ? `, ${response.candidates.length} candidate(s)` : ''
        }`,
      );
      onDiscovered();
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="discover">
      <label className="field">
        <span>trace to observe</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {TRACES.map((t) => (
            <option key={t.traceId} value={t.traceId}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={discover}>
        {busy ? 'Observing…' : 'Discover'}
      </button>
      {result && <div className="muted">{result}</div>}
    </div>
  );
}

/** Fixture paths are relative to the repository root, which is the API's cwd. */
function pathFor(trace: { traceId: string }): string {
  const file: Record<string, string> = {
    a_customer_request: 'a-customer-request-clean.jsonl',
    b_customer_request: 'b-customer-request-noisy.jsonl',
    c_two_workflows: 'c-two-workflows.jsonl',
    d_one_off: 'd-one-off-only.jsonl',
  };
  return `fixtures/traces/${file[trace.traceId] ?? 'a-customer-request-clean.jsonl'}`;
}
