import { useState } from 'react';
import { api, type RunRecord, type Step, type WorkflowIR } from './api.js';

/**
 * The approval view.
 *
 * It shows exactly what the engine derived and nothing it inferred on the user's
 * behalf: the binding for every step, the confidence behind that binding, the
 * tier that will be tried first, and every guard. Approving is one click, but
 * nothing is hidden behind it.
 */
export function WorkflowView({
  workflow,
  runs,
  onChanged,
}: {
  workflow: WorkflowIR;
  runs: RunRecord[];
  onChanged(): void;
}) {
  const [disabled, setDisabled] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const required = workflow.variables.filter((v) => v.required);
  const missing = required.filter((v) => !values[v.name]?.trim());

  async function act(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      if (message) setError(message);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const run = async () => {
    const variables: Record<string, string> = {};
    for (const variable of workflow.variables) {
      const value = values[variable.name]?.trim();
      if (value) variables[variable.name] = value;
    }
    await act(() => api.run(workflow.id, variables));
  };

  const history = runs.filter((r) => r.workflowId === workflow.id);

  return (
    <article className="workflow">
      <header>
        <h2>{workflow.name}</h2>
        <div className="badges">
          <span className={`pill risk-${workflow.risk}`}>{workflow.risk}</span>
          <span className={`pill status-${workflow.status}`}>{workflow.status}</span>
          <span className="pill">rev {workflow.revision}</span>
          {workflow.degraded && <span className="pill warn">degraded (no model)</span>}
          {workflow.reliability > 0 && (
            <span className="pill">reliability {workflow.reliability.toFixed(2)}</span>
          )}
        </div>
      </header>

      <p className="intent">{workflow.intent}</p>
      <p className="muted">
        Trigger: {workflow.trigger.description} ({workflow.trigger.type}) · learned from{' '}
        {workflow.traceIds.join(', ')}
      </p>

      <h3>Steps</h3>
      <ol className="steps">
        {workflow.steps.map((step, index) => (
          <StepRow
            key={step.id}
            index={index + 1}
            step={step}
            guard={workflow.conditions.find((c) => c.stepId === step.id)}
            disabled={disabled.includes(step.id)}
            onToggle={() =>
              setDisabled((current) =>
                current.includes(step.id)
                  ? current.filter((id) => id !== step.id)
                  : [...current, step.id],
              )
            }
          />
        ))}
      </ol>

      {workflow.conditions.length > 0 && (
        <>
          <h3>Guards</h3>
          <ul className="guards">
            {workflow.conditions.map((condition) => (
              <li key={condition.id}>
                <code>
                  {condition.when.variable} {condition.operator}
                </code>{' '}
                before “{labelFor(workflow, condition.stepId)}” → {condition.onFail}
                <div className="muted">{condition.description}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {workflow.status === 'candidate' && (
        <>
          <h3>Variables</h3>
          {workflow.variables.map((variable) => (
            <label key={variable.name} className="field">
              <span>
                {variable.name} <em>{variable.type}</em>
                {variable.required ? '' : ' (optional)'}
              </span>
              <input
                value={values[variable.name] ?? ''}
                placeholder={variable.examples[0] || variable.description}
                onChange={(e) => setValues((v) => ({ ...v, [variable.name]: e.target.value }))}
              />
            </label>
          ))}
        </>
      )}

      <div className="actions">
        {workflow.status === 'candidate' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.approve(workflow.id))}
            >
              Approve
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => act(() => api.reject(workflow.id, 'not this one'))}
            >
              Reject
            </button>
            {disabled.length > 0 && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    api.patchWorkflow(workflow.id, {
                      steps: workflow.steps.map((s) => ({
                        id: s.id,
                        enabled: !disabled.includes(s.id),
                      })),
                    }),
                  )
                }
              >
                Save as new revision ({disabled.length} step(s) removed)
              </button>
            )}
          </>
        )}

        {workflow.status === 'approved' && (
          <button type="button" disabled={busy || missing.length > 0} onClick={run}>
            Run now
          </button>
        )}
        {workflow.status === 'approved' && missing.length > 0 && (
          <span className="muted">needs {missing.map((v) => v.name).join(', ')}</span>
        )}
      </div>

      {error && <p className="banner error">{error}</p>}

      {history.length > 0 && (
        <>
          <h3>Runs</h3>
          <ul className="runs">
            {history.slice(0, 5).map((r) => (
              <li key={r.id}>
                <span className={`pill status-${r.status}`}>{r.status}</span>
                <span className="muted">
                  {r.steps.filter((s) => s.status === 'succeeded').length}/{r.steps.length} steps ·{' '}
                  {r.partialEffects.length} effect(s)
                </span>
                {r.error ? <span className="muted error">{r.error}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

function StepRow({
  index,
  step,
  guard,
  disabled,
  onToggle,
}: {
  index: number;
  step: Step;
  guard?: WorkflowIR['conditions'][number];
  disabled: boolean;
  onToggle(): void;
}) {
  const selector = step.target.selectorCandidates[0];
  return (
    <li className={disabled ? 'step disabled' : 'step'}>
      <div className="step-head">
        <span className="index">{index}</span>
        <span className="label">{step.label}</span>
        <span className={`pill risk-${step.risk}`}>{step.risk}</span>
        <span className="pill">{step.action}</span>
        <span className="pill" title="tiers are tried in this order">
          {step.resolveTier.join(' → ')}
        </span>
        <span className="muted">conf {step.confidence.toFixed(2)}</span>
        <label className="toggle">
          <input type="checkbox" checked={!disabled} onChange={onToggle} />
          include
        </label>
      </div>
      <div className="muted binding">
        {step.target.appId}
        {selector
          ? ` · ${selector.strategy}${selector.role ? `:${selector.role}` : ''}${
              selector.name ? ` "${selector.name}"` : ''
            }`
          : step.target.urlPattern
            ? ` · ${step.target.urlPattern}`
            : ' · no selector'}
        {Object.keys(step.inputs).length > 0 && ` · in ${JSON.stringify(step.inputs)}`}
        {step.outputs && ` · out ${JSON.stringify(step.outputs)}`}
      </div>
      {guard && (
        <div className="muted guard">
          guard: {guard.when.variable} must not be empty, otherwise {guard.onFail}
        </div>
      )}
      {step.evidence.length > 0 && (
        <details>
          <summary>evidence</summary>
          <ul>
            {step.evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function labelFor(workflow: WorkflowIR, stepId: string): string {
  return workflow.steps.find((s) => s.id === stepId)?.label ?? stepId;
}
