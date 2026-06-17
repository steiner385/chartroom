import type { CellIntent } from './cell';
import type { ObservedCell } from './observed';

export interface DriftConfig {
  /** Min observed runs to trust a "runs-here-but-not-configured" signal. */
  minRuns: number;
}
export const DRIFT_DEFAULTS: DriftConfig = { minRuns: 30 };

/**
 * Confidence-gated drift (spec §5.5). Two directions:
 *  - configured to run here but never observed here — only when the check is
 *    active at some other tier (`checkRunsElsewhere`), so it's a real
 *    absent-in-practice signal rather than a brand-new job; and never for a
 *    conditional cell (which legitimately may not run in-window).
 *  - observed running here but not statically configured — only when observed
 *    runs clear `minRuns` (a stray one-off is not drift).
 */
export function deriveDrift(
  intent: CellIntent, observed: ObservedCell | null, checkRunsElsewhere: boolean,
  cfg: DriftConfig = DRIFT_DEFAULTS,
): boolean {
  const observedRuns = observed?.runs ?? 0;
  if (intent.runs && observedRuns === 0) {
    return checkRunsElsewhere && !intent.conditional;
  }
  if (!intent.runs && observedRuns >= cfg.minRuns) {
    return true;
  }
  return false;
}
