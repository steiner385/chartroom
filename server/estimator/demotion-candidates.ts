/**
 * Pure detector for "almost always green" CI checks that are candidates for
 * demotion to a lower-frequency tier. No I/O — the metrics builder feeds it
 * per-(check, event) success aggregates and it returns a ranked candidate list.
 *
 * Intelligence: among checks that clear the greenness bar, rank by COST (runner-
 * minutes spent in the window) descending — an expensive always-green check is a
 * far better demotion target than a cheap one, because demoting it saves real
 * minutes for little lost signal. This is the "cost × greenness" ranking.
 *
 * The success rate is computed over distinct (sha, attempt) runs with CANCELLED
 * excluded (see SuccessStat), so a FLAKY check — which has a failed attempt in
 * the window — drops below the threshold and never qualifies. That keeps this
 * lane cleanly distinct from the flake lane: flaky ≠ demotable.
 */

/** Minimum distinct runs in the window for a check to be eligible — a long green
 *  streak on 3 runs is not evidence. */
export const DEMOTION_MIN_RUNS = 50;
/** Success-rate bar (percent). ≥99% tolerates a single rare real failure. */
export const DEMOTION_MIN_SUCCESS_PCT = 99;
/** Cap on rows surfaced (advisory panel). */
export const DEMOTION_TOP_N = 12;

/**
 * Per-(check, event) success aggregate over the metrics window. `totalRuns` and
 * `failingRuns` count distinct (sha, attempt) samples with CANCELLED excluded
 * (a spot-kill is not a failure); `sumDurationSecs` is the total runner-seconds
 * the check spent in the window — the cost basis for ranking.
 */
export interface SuccessStat {
  name: string;
  event: string;
  totalRuns: number;
  failingRuns: number;
  sumDurationSecs: number;
}

/** The lower-frequency tier suggested for a given trigger event. Events absent
 *  from the ladder have no cheaper tier the dashboard understands, so a check on
 *  such an event never becomes a candidate (e.g. an already-nightly `schedule`
 *  job — we can't tell nightly from weekly by event alone). */
interface Ladder { currentTier: string; suggestedTier: string; }
export const DEMOTION_LADDER: Record<string, Ladder> = {
  pull_request: { currentTier: 'every PR push',          suggestedTier: 'merge queue only' },
  push:         { currentTier: 'every push to main',     suggestedTier: 'nightly' },
  merge_group:  { currentTier: 'every merge-queue build', suggestedTier: 'nightly' },
};

/** One demotion candidate, projected to the serializable facts the UI ships. */
export interface DemotionCandidate {
  name: string;
  event: string;
  currentTier: string;
  suggestedTier: string;
  /** Success rate over the window, 1-decimal percent. */
  successRatePct: number;
  runsInWindow: number;
  /** Runner-minutes spent in the window — the cost basis and the rank key. */
  minutesInWindow: number;
  reason: string;
}

export interface DemotionConfig { minRuns: number; minSuccessPct: number; topN: number; }
export const DEMOTION_DEFAULTS: DemotionConfig = {
  minRuns: DEMOTION_MIN_RUNS, minSuccessPct: DEMOTION_MIN_SUCCESS_PCT, topN: DEMOTION_TOP_N,
};

export function computeDemotionCandidates(
  stats: SuccessStat[], cfg: DemotionConfig = DEMOTION_DEFAULTS,
): DemotionCandidate[] {
  const out: DemotionCandidate[] = [];
  for (const s of stats) {
    const ladder = DEMOTION_LADDER[s.event];
    if (!ladder) continue;                       // no cheaper tier we understand
    if (s.totalRuns < cfg.minRuns) continue;     // not enough history to trust
    const greenRuns = s.totalRuns - s.failingRuns;
    const successPct = s.totalRuns ? (greenRuns / s.totalRuns) * 100 : 0;
    if (successPct < cfg.minSuccessPct) continue; // not green enough
    const minutes = Math.round(s.sumDurationSecs / 60);
    out.push({
      name: s.name,
      event: s.event,
      currentTier: ladder.currentTier,
      suggestedTier: ladder.suggestedTier,
      successRatePct: Math.round(successPct * 10) / 10,
      runsInWindow: s.totalRuns,
      minutesInWindow: minutes,
      reason: `${greenRuns}/${s.totalRuns} green · ~${minutes} runner-min in window`,
    });
  }
  // All survivors clear the greenness bar, so rank purely by cost (minutes
  // spent) desc — most expensive always-green checks first. Tiebreak by name
  // for a stable order.
  out.sort((a, b) => b.minutesInWindow - a.minutesInWindow || a.name.localeCompare(b.name));
  return out.slice(0, cfg.topN);
}
