import { useState } from 'react';
import { api, type RunRecord, type Step, type WorkflowIR } from './api.js';

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
  const [success, setSuccess] = useState<string>();

  const required = workflow.variables.filter((v) => v.required);
  const missing = required.filter((v) => !values[v.name]?.trim());

  async function act(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      await action();
      if (message) setSuccess(message);
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
    await act(() => api.run(workflow.id, variables), 'Started! Workflow is now running in the background.');
  };

  const history = runs.filter((r) => r.workflowId === workflow.id);
  const friendlyRisk = getFriendlyRisk(workflow.risk);

  return (
    <div>
      {/* Friendly Overview Header */}
      <div className="cad-hero">
        <div className="cad-grid-pattern" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: '11px', color: 'var(--term-cyan)', marginBottom: '4px' }}>
              PROPOSED AUTOMATION
            </div>
            <h2>{workflow.name}</h2>
            <div style={{ fontSize: '13.5px', color: '#f7fee7', marginTop: '4px', lineHeight: 1.5 }}>
              <strong>What it does:</strong> {workflow.intent}
            </div>
          </div>
          <span className="fig-label">
            {workflow.status === 'approved' ? '✓ APPROVED FOR AUTOMATION' : 'AWAITING YOUR REVIEW'}
          </span>
        </div>

        <div className="cad-badge-group">
          <span className={`cad-pill risk-${workflow.risk}`}>{friendlyRisk.title}</span>
          <span className="cad-pill">
            Confidence: {workflow.reliability > 0 ? `${(workflow.reliability * 100).toFixed(0)}% Match` : 'High (Ready)'}
          </span>
          <span className="cad-pill">{workflow.steps.length} Steps in sequence</span>
        </div>

        <div style={{ marginTop: '14px', borderTop: '1px dashed var(--border-raw)', paddingTop: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <strong>When this runs:</strong> Whenever a {workflow.trigger.description.toLowerCase()} happens.
        </div>
      </div>

      {/* Human-Friendly Steps Breakdown */}
      <div style={{ marginBottom: '20px' }}>
        <div className="pane-header-terminal">
          <h2 style={{ fontSize: '17px' }}>Steps the AI will perform for you</h2>
          <span className="fig-label">Step by Step</span>
        </div>

        <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Review the actions below. You can uncheck any step if you prefer to do it manually.
        </p>

        <div className="cad-pipeline">
          {workflow.steps.map((step, index) => (
            <FriendlyStepRow
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
        </div>
      </div>

      {/* Safety Checks Callout */}
      {workflow.conditions.length > 0 && (
        <div className="blueprint-card" style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--term-amber)', fontWeight: 700, marginBottom: '6px' }}>
            🛡️ Built-in Safety Guard:
          </div>
          {workflow.conditions.map((condition) => (
            <div key={condition.id} className="cad-guard-box">
              <span>
                <strong>Safety Rule:</strong> If the <em>{cleanFieldName(condition.when.variable)}</em> cannot be found automatically, the automation will pause safely and ask you for help instead of guessing.
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Variables Input Section */}
      {workflow.status === 'candidate' && workflow.variables.length > 0 && (
        <div className="blueprint-card" style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--term-cyan)', fontWeight: 700, marginBottom: '6px' }}>
            Optional Test Values
          </div>
          <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
            You can type sample inputs below to test how the workflow handles them:
          </p>
          {workflow.variables.map((variable) => (
            <div key={variable.name} style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '3px' }}>
                <span style={{ color: '#fff' }}>{cleanFieldName(variable.name)} {variable.required ? '(Required)' : '(Optional)'}</span>
              </div>
              <input
                className="input-brutal"
                value={values[variable.name] ?? ''}
                placeholder={variable.examples[0] || variable.description || 'Enter sample value...'}
                onChange={(e) => setValues((v) => ({ ...v, [variable.name]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      {/* Main Action Bar */}
      <div className="blueprint-card" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {workflow.status === 'candidate' && (
          <>
            <button
              type="button"
              className="btn-brutal"
              disabled={busy}
              onClick={() => act(() => api.approve(workflow.id), 'Great! This workflow is now approved and ready to run.')}
            >
              ✓ Approve & Enable Automation
            </button>
            <button
              type="button"
              className="btn-brutal secondary"
              disabled={busy}
              onClick={() => act(() => api.reject(workflow.id, 'User declined'))}
            >
              Dismiss
            </button>
            {disabled.length > 0 && (
              <button
                type="button"
                className="btn-brutal secondary"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    api.patchWorkflow(workflow.id, {
                      steps: workflow.steps.map((s) => ({
                        id: s.id,
                        enabled: !disabled.includes(s.id),
                      })),
                    }),
                    'Saved! Updated workflow without the disabled steps.',
                  )
                }
              >
                Save Without Disabled Steps ({disabled.length})
              </button>
            )}
          </>
        )}

        {workflow.status === 'approved' && (
          <button
            type="button"
            className="btn-brutal"
            disabled={busy || missing.length > 0}
            onClick={run}
          >
            ▶ Run This Automation Now
          </button>
        )}
        {workflow.status === 'approved' && missing.length > 0 && (
          <span style={{ fontSize: '11.5px', color: 'var(--term-amber)' }}>
            ⚠️ Please fill in: {missing.map((v) => cleanFieldName(v.name)).join(', ')}
          </span>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}
      {success && <div className="banner success">{success}</div>}

      {/* Past Runs */}
      {history.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div className="pane-header-terminal">
            <h2 style={{ fontSize: '16px' }}>Past Automation History</h2>
            <span className="fig-label">{history.length} Run{history.length > 1 ? 's' : ''}</span>
          </div>
          {history.slice(0, 5).map((r) => (
            <div key={r.id} className="blueprint-card" style={{ padding: '8px 12px', marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px' }}>
                <span>Run #{r.id.slice(0, 6)}: <strong style={{ color: r.status === 'succeeded' ? 'var(--term-green)' : 'var(--term-amber)' }}>{r.status === 'succeeded' ? 'Completed Successfully' : r.status}</strong></span>
                <span style={{ color: 'var(--text-muted)' }}>
                  Finished {r.steps.filter((s) => s.status === 'succeeded').length} of {r.steps.length} steps
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FriendlyStepRow({
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
  const appName = getFriendlyAppName(step.target.appId);
  const readableDescription = getHumanAction(step);

  return (
    <div className={`cad-step-node ${disabled ? 'disabled' : ''}`}>
      <div className="cad-step-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="cad-node-id">Step {index}</span>
          <span className={`schematic-app-block ${getAppTag(step.target.appId)}`}>{appName}</span>
          <span className="cad-step-label">{readableDescription}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!disabled} onChange={onToggle} />
            Include in automation
          </label>
        </div>
      </div>

      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
        <strong>How it works:</strong> The agent opens <em>{appName}</em>, identifies the relevant button or field, and completes the action automatically.
      </div>

      {guard && (
        <div className="cad-guard-box" style={{ marginTop: '6px' }}>
          Safety check: Confirms <em>{cleanFieldName(guard.when.variable)}</em> is valid before proceeding.
        </div>
      )}
    </div>
  );
}

function getFriendlyRisk(risk: string) {
  switch (risk) {
    case 'read':
      return { title: 'Safe (Reads data only)' };
    case 'write':
      return { title: 'Standard (Updates records)' };
    case 'irreversible':
      return { title: 'Important (Sends messages/emails)' };
    default:
      return { title: 'Automated' };
  }
}

function getFriendlyAppName(appId?: string): string {
  if (!appId) return 'Web Browser';
  const l = appId.toLowerCase();
  if (l.includes('gmail') || l.includes('mail')) return 'Gmail';
  if (l.includes('crm') || l.includes('customer') || l.includes('salesforce')) return 'CRM & Customer Database';
  if (l.includes('slack') || l.includes('chat')) return 'Slack';
  if (l.includes('jira')) return 'Jira Tickets';
  if (l.includes('github')) return 'GitHub Alerts';
  if (l.includes('pagerduty')) return 'PagerDuty Ops';
  return appId;
}

function getHumanAction(step: Step): string {
  if (step.label) {
    // If the label is technical, clean it up
    return step.label
      .replace(/navigate to /i, 'Open ')
      .replace(/click /i, 'Click ')
      .replace(/type /i, 'Fill in ');
  }
  return `${step.action} in ${getFriendlyAppName(step.target.appId)}`;
}

function cleanFieldName(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function getAppTag(appId?: string): string {
  if (!appId) return 'generic';
  const l = appId.toLowerCase();
  if (l.includes('gmail') || l.includes('mail')) return 'gmail';
  if (l.includes('crm') || l.includes('customer') || l.includes('deal') || l.includes('salesforce')) return 'crm';
  if (l.includes('slack') || l.includes('chat')) return 'slack';
  return 'generic';
}
