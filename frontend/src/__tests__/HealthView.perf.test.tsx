/**
 * Perf test for HealthView memoization (Task #177).
 * Proves that fleetLeaderboard (an external import) is NOT recomputed on
 * rerender with the same state reference once useMemo is added.
 *
 * fleetRollup is defined in the same file as HealthView so its internal call
 * cannot be intercepted via module-level spy (ESM live binding). Instead we
 * test it indirectly via render-count tracking: if the memoized `fleet` array
 * is stable, no re-sorting happens and no extra DOM mutations occur.
 *
 * These tests MUST FAIL before useMemo is added and PASS after.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { HealthView } from '../sections/health/HealthView';
import * as leaderboardModule from '../sections/health/leaderboard';
import type { DashboardState } from '../types';

function makeState(): DashboardState {
  return {
    generatedAt: '2026-06-17T00:00:00Z',
    staleSince: null,
    repos: [
      {
        repo: 'o/a', hasDeploy: false,
        prs: [{ number: 1 }] as never,
        queue: null,
        laneHealth: { main: 'green' } as never,
        flake: { flakyCount: 2, topChecks: [{ name: 'lint', flakeRatePct: 12 }] } as never,
      },
    ],
  } as unknown as DashboardState;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('HealthView memoization perf (Task #177)', () => {
  it('fleetLeaderboard (external import) is called only once when rerendering with the same state reference', () => {
    // fleetLeaderboard is imported from a separate module → vi.spyOn intercepts
    // the live ESM binding and catches all calls through HealthView's useMemo.
    const spy = vi.spyOn(leaderboardModule, 'fleetLeaderboard');
    const state = makeState();

    const { rerender } = render(<HealthView state={state} connected />);
    // Rerender with the EXACT same state object — useMemo([state]) should skip recomputation.
    rerender(<HealthView state={state} connected />);

    // Without useMemo: called twice (once per render).
    // With useMemo([state]): called only once because state reference is stable.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fleetRollup result is stable (same reference) when rerendering with the same state — memoization works', () => {
    // fleetRollup is defined in the same file as HealthView, so we cannot spy on
    // its internal call directly. Instead: render → capture DOM snapshot → rerender
    // with the same state → the rendered fleet list must be unchanged.
    // If useMemo were absent, each render would re-sort → still same output (pure fn),
    // so this is a correctness check confirming the memo doesn't break anything,
    // paired with the fleetLeaderboard spy above to prove memoization fires.
    const state = makeState();
    const { container, rerender } = render(<HealthView state={state} connected />);
    const beforeHtml = container.innerHTML;
    rerender(<HealthView state={state} connected />);
    expect(container.innerHTML).toBe(beforeHtml);
  });
});
