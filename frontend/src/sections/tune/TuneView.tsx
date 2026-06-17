// Tune & Investigate section (spec 001, US5 — the 5th section). The configure +
// retrospect home: budgets/quota gauges (J3), policy violations (I2), closed-loop
// outcomes (H), and the changelog + action audit (L). Each panel loads independently
// and is advisory (a failed/empty panel never blocks the others — FR-022). Deep
// historical metrics stay behind an explicit affordance, not the default. API injected.
import { useEffect, useState } from 'react';
import type { WorkspaceApi, BudgetsDto, PolicyDto, OutcomesDto, ChangelogDto } from '../../shell/workspaceApi';

export function TuneView({ repo, api }: { repo: string | null; api: WorkspaceApi }) {
  const [budgets, setBudgets] = useState<BudgetsDto | null>(null);
  const [policy, setPolicy] = useState<PolicyDto | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomesDto | null>(null);
  const [log, setLog] = useState<ChangelogDto | null>(null);

  useEffect(() => {
    api.budgets().then(setBudgets).catch(() => setBudgets(null));
  }, [api]);
  useEffect(() => {
    if (!repo) { setPolicy(null); setOutcomes(null); setLog(null); return; }
    api.policy(repo).then(setPolicy).catch(() => setPolicy(null));
    api.outcomes(repo).then(setOutcomes).catch(() => setOutcomes(null));
    api.changelog(repo).then(setLog).catch(() => setLog(null));
  }, [repo, api]);

  return (
    <div className="tune-view">
      <h2>Tune &amp; Investigate{repo ? ` — ${repo}` : ''}</h2>

      {budgets && budgets.gauges.length > 0 && (
        <section className="tune-budgets" aria-label="Budgets">
          <h3>Budgets</h3>
          <ul role="list">
            {budgets.gauges.map((g) => (
              <li key={g.kind} className={`budget-gauge state-${g.state}`}>
                <span className="budget-kind">{g.kind}</span>
                <span className="budget-value">{g.current}{g.unit ? ` ${g.unit}` : ''} / {g.threshold} ({Math.round(g.fractionUsed * 100)}%)</span>
                <span className="budget-state">{g.state === 'breach' ? '⛔' : g.state === 'warn' ? '⚠' : '✓'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {policy && policy.violations.length > 0 && (
        <section className="tune-policy" aria-label="Policy violations">
          <h3>Policy violations ({policy.violations.length})</h3>
          <ul role="list">{policy.violations.map((v, i) => <li key={i}><strong>{v.check}</strong>: {v.detail}</li>)}</ul>
        </section>
      )}

      {outcomes && outcomes.outcomes.length > 0 && (
        <section className="tune-outcomes" aria-label="Outcomes">
          <h3>Applied-change outcomes — {Math.round(outcomes.accuracy.meanCostAccuracy * 100)}% mean accuracy{outcomes.accuracy.recommenderUsable ? '' : ' (advisory)'}</h3>
          <ul role="list">
            {outcomes.outcomes.map((o) => (
              <li key={o.prNumber} className={`outcome conf-${o.confidence}`}>
                #{o.prNumber} {o.check}: {Math.round(o.costAccuracy * 100)}% accurate {o.directionCorrect ? '✓' : '✗ wrong direction'} <em>[{o.confidence}]</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      {log && (log.changelog.length > 0 || log.audit.length > 0) && (
        <section className="tune-changelog" aria-label="Changelog and audit">
          <h3>Changelog &amp; audit</h3>
          <ul role="list">
            {log.changelog.map((c, i) => <li key={`c${i}`} className="changelog-entry">{c.at.slice(0, 10)} · {c.summary} <em>({c.actor})</em></li>)}
            {log.audit.map((a, i) => <li key={`a${i}`} className="audit-entry">{a.at.slice(0, 10)} · tool {a.action} {a.target ?? ''} {a.result ? `→ ${a.result}` : ''}</li>)}
          </ul>
        </section>
      )}

      {!repo && <p className="tune-hint">Select a pipeline to see its policy, outcomes, and changelog.</p>}
    </div>
  );
}
