import { FLAKE_MIN_RUNS, type FlakeStat } from '../history';

/** Top-N flaky checks surfaced per repo on the Failures & flake lane (Spec 5). */
export const FLAKE_SUMMARY_TOP_N = 8;

/** One flaky check, projected down to the serializable facts the spine ships
 *  (spec §14 allowlist — never raw rows, errors, or tokens). */
export interface FlakeCheckSummary {
  name: string;
  event: string;
  flakeRatePct: number;
  flakeEvents: number;
}

/** Per-repo flake summary attached to DashboardState.repos[] (Failures & flake
 *  lane, Spec 5). Advisory only — the lane is gating:false and amber-at-most. */
export interface RepoFlakeSummary {
  topChecks: FlakeCheckSummary[];
  /** How many checks qualify as flaky (≥ FLAKE_MIN_RUNS runs AND ≥1 flake). */
  flakyCount: number;
}

/**
 * Pure projection from the flake engine's `flakeStats` output (history.ts) —
 * reuses its same-sha fail-then-pass resolution; we only filter, sort, and trim
 * here. A check qualifies when it has enough history to be meaningful
 * (totalRuns ≥ FLAKE_MIN_RUNS) AND has actually flaked (flakeEvents > 0).
 * Qualifiers are sorted by flakeRatePct desc; topChecks is capped at
 * FLAKE_SUMMARY_TOP_N while flakyCount counts ALL qualifiers.
 *
 * Called once per slow cycle and cached on the Poller (spec §15: never a
 * per-buildState SQLite read). CANCELLED is not a failing conclusion in the
 * engine, so spot-kills never inflate a flake rate — that property is
 * preserved here by construction (we never re-derive failures).
 */
export function computeRepoFlakeSummary(stats: FlakeStat[]): RepoFlakeSummary {
  const qualifying = stats
    .filter((s) => s.totalRuns >= FLAKE_MIN_RUNS && s.flakeEvents > 0)
    .sort((a, b) => b.flakeRatePct - a.flakeRatePct);
  const topChecks: FlakeCheckSummary[] = qualifying
    .slice(0, FLAKE_SUMMARY_TOP_N)
    .map((s) => ({ name: s.name, event: s.event, flakeRatePct: s.flakeRatePct, flakeEvents: s.flakeEvents }));
  return { topChecks, flakyCount: qualifying.length };
}
