// Pipeline ordering (roadmap 1.3) — the PR pipeline must lead with what needs eyes,
// not bury 3 running/overdue PRs under 48 identical "awaiting prod" rows. Pure +
// testable. `attentionSort` ranks failed > running > queued > idle > deploy (with
// overdue bumping a PR up within its tier); `splitCohort` peels the non-overdue
// awaiting-prod herd into a collapsible cohort so the lead stays scannable.
import type { PrView } from '../../types';
import { bucketPr, type Bucket } from '../../StatusStrip';

const RANK: Record<Bucket, number> = { failed: 0, running: 1, queued: 2, idle: 3, deploy: 4 };

/** Lower = needs more attention. Overdue bumps up by half a tier. */
export function attentionRank(pr: PrView): number {
  const base = RANK[bucketPr(pr)];
  return pr.stage.overdue ? base - 0.5 : base;
}

export function attentionSort(prs: PrView[]): PrView[] {
  return [...prs].sort((a, b) => attentionRank(a) - attentionRank(b) || a.number - b.number);
}

/** The collapsible "awaiting prod" set: merged PRs awaiting the prod deploy that are
 *  NOT overdue (overdue ones stay in the lead — they need attention). */
function inCohort(pr: PrView): boolean {
  return bucketPr(pr) === 'deploy' && !pr.stage.overdue;
}

export function splitCohort(prs: PrView[]): { lead: PrView[]; cohort: PrView[] } {
  return {
    lead: attentionSort(prs.filter((p) => !inCohort(p))),
    cohort: prs.filter(inCohort),
  };
}
