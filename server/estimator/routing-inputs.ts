/**
 * Pure input projection for the runner-routing controller. Turns raw history
 * rows (spot reclaim events, job-start intervals, per-key duration samples) into
 * the two values `computeRunnerPlan` consumes: a per-job-key p90 list and the
 * spot reclaim FRACTION. No I/O — the poller gathers the rows (throttled) and
 * hands them here, which keeps this unit-testable and the SQLite reads cached.
 *
 * Reclaim rate matches the PR #122 / metrics definition EXACTLY: spot pools
 * only (a job is spot when its resolved pool key matches /spot/i), reclaim
 * events ÷ spot job starts in the window, null when no spot jobs ran.
 */

import { percentile } from '../math';
import { RUNNER_JOB_KEYS, type RunnerJobInput } from './runner-plan';

/** A pool is "spot" when its resolved key carries the spot marker (e.g.
 *  `kindash-arc-spot`, `ci-fast-spot`) — only spot pools can be reclaimed.
 *  Mirrors metrics.ts `isSpotPool`. */
const isSpotPool = (pool: string): boolean => /spot/i.test(pool);

export interface ReclaimEvent { name: string; event: string }
export interface JobInterval { name: string; event: string }

/** Default reclaim window in ms when the configured string is unparseable. */
const DEFAULT_WINDOW_MS = 24 * 3600_000;

/**
 * Parse a rolling-window string (`'24h'`, `'7d'`, `'90m'`, `'3600s'`) to ms.
 * Unrecognised input falls back to 24h rather than throwing — a bad config knob
 * must not crash the poll loop. Bare numbers are read as hours for friendliness.
 */
export function reclaimWindowMs(window: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*$/i.exec(window);
  if (!m) return DEFAULT_WINDOW_MS;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_MS;
  const unit = (m[2] || 'h').toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'd' ? 86400_000 : 3600_000;
  return n * mult;
}

/**
 * Compute the p90 over a number[] (seconds). Returns null on an empty input —
 * a cold-start key with no samples. Uses the SAME shared `percentile` helper
 * (nearest-rank) the metrics slowest-jobs section uses, so a routing p90 and a
 * metrics p90 over the same samples agree.
 */
export function p90(values: number[]): number | null {
  if (values.length === 0) return null;
  return percentile([...values].sort((a, b) => a - b), 0.9);
}

/**
 * Project the controller inputs from already-gathered history rows.
 *
 * @param reclaimEvents  spot/infra-kill events for the target repo (CANCELLED
 *   re-run-and-passed); each carries the job's check name + trigger event.
 * @param intervals      every job-start interval for the repo in-window — the
 *   reclaim-rate denominator (only spot ones are counted).
 * @param durationSamplesByKey  RUNNER_JOB_KEY → the pull_request duration
 *   samples (seconds) for every check name matching that key (shards collapse).
 * @param resolvePool    (name, event) → resolved pool key, or null when unknown.
 *
 * Returns one `RunnerJobInput` per key (p90Secs null = no samples yet) plus the
 * spot reclaim fraction (null when no spot jobs ran in the window).
 */
export function projectInputs(
  reclaimEvents: ReclaimEvent[],
  intervals: JobInterval[],
  durationSamplesByKey: Map<string, number[]>,
  resolvePool: (name: string, event: string) => string | null,
): { jobs: RunnerJobInput[]; reclaimRate: number | null } {
  const poolOf = (name: string, event: string): string => resolvePool(name, event) ?? 'unknown';
  const spotReclaims = reclaimEvents.filter((e) => isSpotPool(poolOf(e.name, e.event)));
  const spotJobs = intervals.filter((r) => isSpotPool(poolOf(r.name, r.event))).length;
  // FRACTION (0..1), null when no spot jobs ran — never a fabricated 0.
  const reclaimRate = spotJobs > 0 ? spotReclaims.length / spotJobs : null;

  const jobs: RunnerJobInput[] = Object.keys(RUNNER_JOB_KEYS).map((key) => ({
    key,
    p90Secs: p90(durationSamplesByKey.get(key) ?? []),
  }));

  return { jobs, reclaimRate };
}
