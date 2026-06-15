/**
 * Recommendations digest (tuning tool, step 2). The dashboard already computes
 * tuning advice across several panels (batch-size advisor, queue efficiency,
 * workflow lint); this collects them into one ranked "what to tune" list. Pure
 * derivation over already-computed payload sections — no new measurement.
 */

export type RecPriority = 'high' | 'medium' | 'low';

export interface Recommendation {
  repo: string;
  /** Stable id for the kind of recommendation (de-dup / linking). */
  kind: string;
  priority: RecPriority;
  /** Short imperative headline. */
  title: string;
  /** The why + the numbers. */
  detail: string;
}

export interface RecommendationInputs {
  batchAdvisor: { repo: string; currentBatch: number; recommendedBatch: number;
    ejectProbPerGroup: number; curve: { batch: number; throughputPerHour: number }[] }[];
  queueEfficiency: { repo: string;
    runConclusion: { total: number; runFailed: number; advisoryNoise: number; requiredConfigured: boolean };
    adminBypass: { rate: number | null; merges: number } }[];
  lint: { repo: string; findings: { rule: string; severity: 'warn' | 'info'; job: string; message: string }[] }[];
}

const PRIORITY_RANK: Record<RecPriority, number> = { high: 0, medium: 1, low: 2 };

export function deriveRecommendations(inp: RecommendationInputs): Recommendation[] {
  const recs: Recommendation[] = [];

  // Batch-size advisor recommends a different cap than the one in effect.
  for (const b of inp.batchAdvisor) {
    if (b.recommendedBatch === b.currentBatch) continue;
    const dir = b.recommendedBatch > b.currentBatch ? 'raise' : 'lower';
    const cur = b.curve.find((c) => c.batch === b.currentBatch)?.throughputPerHour;
    const rec = b.curve.find((c) => c.batch === b.recommendedBatch)?.throughputPerHour;
    const gainPct = cur != null && rec != null && cur > 0 ? Math.round((rec / cur - 1) * 100) : null;
    const ejectPct = Math.round(b.ejectProbPerGroup * 100);
    recs.push({ repo: b.repo, kind: 'batch-size', priority: 'medium',
      title: `${dir} merge-queue batch ${b.currentBatch} → ${b.recommendedBatch}`,
      detail: gainPct != null
        ? `modelled throughput headroom ${gainPct >= 0 ? '+' : ''}${gainPct}% at ${ejectPct}% group-eject rate`
        : `throughput sweet spot at ${ejectPct}% group-eject rate` });
  }

  for (const q of inp.queueEfficiency) {
    const rc = q.runConclusion;
    // Runs that read FAILED only because an advisory (non-required) job failed.
    if (rc.requiredConfigured && rc.advisoryNoise > 0 && rc.total > 0) {
      const pct = Math.round((rc.advisoryNoise / rc.total) * 100);
      recs.push({ repo: q.repo, kind: 'advisory-in-merge-group',
        priority: pct >= 40 ? 'high' : 'medium',
        title: 'remove advisory jobs from merge_group',
        detail: `${rc.advisoryNoise} of ${rc.total} runs (${pct}%) read FAILED but the required gate passed — only an advisory job failed` });
    }
    // Can't separate gate failures from advisory noise without prefixes.
    if (!rc.requiredConfigured && rc.runFailed > 0) {
      recs.push({ repo: q.repo, kind: 'set-required-prefixes', priority: 'low',
        title: 'set requiredCheckPrefixes',
        detail: 'no requiredCheckPrefixes configured — every failed merge_group run reads as advisory, so real gate failures can’t be separated' });
    }
    // People routing around the queue (≥10% sustained = alarm).
    if (q.adminBypass.rate != null && q.adminBypass.rate > 0.10 && q.adminBypass.merges >= 5) {
      const pct = Math.round(q.adminBypass.rate * 100);
      recs.push({ repo: q.repo, kind: 'admin-bypass', priority: 'high',
        title: `admin-bypass rate ${pct}% — investigate queue confidence`,
        detail: `${pct}% of merges (≥10% alarm) bypassed the queue — people are routing around it` });
    }
  }

  // Workflow-lint findings (their message IS the recommendation).
  for (const l of inp.lint) {
    for (const f of l.findings) {
      recs.push({ repo: l.repo, kind: `lint:${f.rule}`,
        priority: f.severity === 'warn' ? 'medium' : 'low',
        title: f.message, detail: `job: ${f.job}` });
    }
  }

  return recs.sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || a.repo.localeCompare(b.repo)
    || a.title.localeCompare(b.title));
}
