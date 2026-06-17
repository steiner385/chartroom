import { describe, it, expect } from 'vitest';
import { deriveDrift } from '../drift';
import type { CellIntent } from '../cell';
import type { ObservedCell } from '../observed';

const intent = (o: Partial<CellIntent>): CellIntent => ({ runs: true, gates: false, conditional: false, ...o });
const obs = (runs: number): ObservedCell => ({ ran: runs > 0, runs, realFailures: 0, failRatePct: 0, flakeRatePct: 0, minutes: 0 });

describe('deriveDrift', () => {
  it('configured-but-never-runs-here flags drift when the check is active elsewhere', () => {
    expect(deriveDrift(intent({ runs: true }), null, true)).toBe(true);
    expect(deriveDrift(intent({ runs: true }), obs(0), true)).toBe(true);
  });
  it('does NOT flag a configured-but-unobserved check that is inactive everywhere (likely brand-new)', () => {
    expect(deriveDrift(intent({ runs: true }), null, false)).toBe(false);
  });
  it('does NOT flag a conditional cell that legitimately did not run', () => {
    expect(deriveDrift(intent({ runs: true, conditional: true }), null, true)).toBe(false);
  });
  it('runs-here-but-not-configured flags drift when observed runs ≥ minRuns', () => {
    expect(deriveDrift(intent({ runs: false }), obs(50), false)).toBe(true);
    expect(deriveDrift(intent({ runs: false }), obs(3), false)).toBe(false); // below floor
  });
  it('no drift when intent and observed agree (runs + observed)', () => {
    expect(deriveDrift(intent({ runs: true }), obs(100), true)).toBe(false);
  });
});
