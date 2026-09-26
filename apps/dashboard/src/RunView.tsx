import { useState } from 'react';
import { api, type RunRecord } from './api.js';

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

  const succeededCount = run.steps.filter((s) => s.status === 'succeeded').length;

  return (
    <div className="blueprint-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--term-cyan)', fontWeight: 600 }}>
            CURRENT AUTOMATION RUN
          </div>
          <span className={`cad-pill status-${run.status}`}>
            {run.status === 'running' ? 'In Progress' : run.status === 'succeeded' ? 'Completed Successfully' : run.status}
          </span>
        </div>

        {busy_ && (
          <button type="button" className="btn-brutal danger" style={{ padding: '4px 10px', fontSize: '11px' }} disabled={busy} onClick={abort}>
            Stop Automation
          </button>
        )}
      </div>

      <div style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '6px 0' }}>
        Progress: <strong>{succeededCount} of {run.steps.length} steps</strong> completed
      </div>

      {run.error && <div className="banner error">{run.error}</div>}

      {/* Friendly Step Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', margin: '10px 0' }}>
        {run.steps.map((stepRun) => (
          <div
            key={stepRun.stepId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '7px 10px',
              background: '#192014',
              border: '1px solid var(--border-raw)',
              fontSize: '11.5px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: stepRun.status === 'succeeded' ? 'var(--term-green)' : stepRun.status === 'failed' ? 'var(--term-crimson)' : 'var(--term-cyan)' }}>
                {stepRun.status === 'succeeded' ? '✓' : stepRun.status === 'failed' ? '✗' : '•'}
              </span>
              <span style={{ color: '#fff' }}>{cleanStepName(stepRun.label)}</span>
            </div>

            <div style={{ display: 'flex', gap: '5px' }}>
              <span className="spec-stamp">
                {stepRun.status === 'succeeded' ? 'Done' : stepRun.status === 'running' ? 'Working...' : 'Pending'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn-brutal secondary"
        style={{ width: '100%', fontSize: '11px', padding: '6px' }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '▲ Hide Activity Details' : '▼ Show Activity Details'}
      </button>

      {expanded && (
        <ul className="terminal-log-view">
          {run.log.map((entry, i) => (
            <li key={i} className={entry.level} style={{ fontSize: '11px' }}>
              {entry.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function cleanStepName(label: string): string {
  return label
    .replace(/navigate to /i, 'Open ')
    .replace(/click /i, 'Click ')
    .replace(/type /i, 'Fill in ');
}
