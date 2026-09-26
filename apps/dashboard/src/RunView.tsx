import { useState } from 'react';
import { api, type RunRecord } from './api.js';

/**
 * The run journal.
 *
 * The tier a step actually used is shown next to the tier the compiler
 * preferred, because that difference is the most useful thing the operator can
 * learn: it is how a flaky mechanism gets demoted on the next run.
 */
export function RunView({ run, onChanged }: { run: RunRecord; onChanged(): void }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const busy_ = run.status === 'running' || run.status === 'awaiting-confirmation';

  async function abort() {
    setBusy(true);
    try {
      await api.abort(run.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="run">
      <header>
        <h3>Run {run.id}</h3>
        <span className={`pill status-${run.status}`}>{run.status}</span>
        {busy_ && (
          <button type="button" className="secondary" disabled={busy} onClick={abort}>
            Abort
          </button>
        )}
      </header>
      <div className="muted">
        {run.steps.filter((s) => s.status === 'succeeded').length}/{run.steps.length} steps ·{' '}
        {run.partialEffects.length} effect(s)
        {run.abortReason ? ` · ${run.abortReason}` : ''}
      </div>
      {run.error && <p className="banner error">{run.error}</p>}

      <ol className="runsteps">
        {run.steps.map((stepRun) => (
          <li key={stepRun.stepId} className={`runstep ${stepRun.status}`}>
            <span className={`pill status-${stepRun.status}`}>{stepRun.status}</span>
            <span className="label">{stepRun.label}</span>
            <span className="pill">{stepRun.tier}</span>
            {stepRun.attempts > 1 && <span className="pill warn">{stepRun.attempts} tries</span>}
            {stepRun.healedSelector && <span className="pill warn">healed</span>}
            {stepRun.error && <span className="muted error">{stepRun.error}</span>}
          </li>
        ))}
      </ol>

      <button type="button" className="secondary" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Hide log' : 'Show log'}
      </button>
      {expanded && (
        <ul className="log">
          {run.log.map((entry, i) => (
            <li key={i} className={entry.level}>
              {entry.message}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
