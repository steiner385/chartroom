import { describe, it, expect } from 'vitest';
import { computeRepoFlakeSummary, FLAKE_SUMMARY_TOP_N } from '../flake-summary';
import { FLAKE_MIN_RUNS, type FlakeStat } from '../../history';

/** Minimal FlakeStat builder — only the fields the projection reads matter. */
const stat = (over: Partial<FlakeStat>): FlakeStat => ({
  name: 'x', event: 'pull_request', flakeEvents: 0, totalRuns: FLAKE_MIN_RUNS,
  flakeRatePct: 0, flakeAts: [], runAts: [], ...over,
});

describe('computeRepoFlakeSummary', () => {
  it('is empty (flakyCount 0) when no stats qualify', () => {
    const out = computeRepoFlakeSummary([]);
    expect(out.flakyCount).toBe(0);
    expect(out.topChecks).toEqual([]);
  });

  it('keeps only checks with totalRuns ≥ FLAKE_MIN_RUNS AND flakeEvents > 0', () => {
    const out = computeRepoFlakeSummary([
      // thin history — below the run floor, excluded even with a flake
      stat({ name: 'thin', totalRuns: FLAKE_MIN_RUNS - 1, flakeEvents: 2, flakeRatePct: 80 }),
      // enough runs but zero flake events — excluded (a stable check)
      stat({ name: 'stable', totalRuns: 50, flakeEvents: 0, flakeRatePct: 0 }),
      // qualifies
      stat({ name: 'flaky', totalRuns: 20, flakeEvents: 5, flakeRatePct: 25 }),
    ]);
    expect(out.flakyCount).toBe(1);
    expect(out.topChecks.map((c) => c.name)).toEqual(['flaky']);
  });

  it('sorts qualifying checks by flakeRatePct descending', () => {
    const out = computeRepoFlakeSummary([
      stat({ name: 'low', totalRuns: 10, flakeEvents: 1, flakeRatePct: 10 }),
      stat({ name: 'high', totalRuns: 10, flakeEvents: 4, flakeRatePct: 40 }),
      stat({ name: 'mid', totalRuns: 10, flakeEvents: 2, flakeRatePct: 20 }),
    ]);
    expect(out.topChecks.map((c) => c.name)).toEqual(['high', 'mid', 'low']);
    expect(out.flakyCount).toBe(3);
  });

  it('caps topChecks at FLAKE_SUMMARY_TOP_N but counts ALL qualifiers in flakyCount', () => {
    const many: FlakeStat[] = Array.from({ length: FLAKE_SUMMARY_TOP_N + 4 }, (_, i) =>
      stat({ name: `c${i}`, totalRuns: 10, flakeEvents: 1, flakeRatePct: 100 - i }));
    const out = computeRepoFlakeSummary(many);
    expect(out.topChecks).toHaveLength(FLAKE_SUMMARY_TOP_N);
    expect(out.flakyCount).toBe(FLAKE_SUMMARY_TOP_N + 4);
    // highest rate first
    expect(out.topChecks[0]!.name).toBe('c0');
  });

  it('projects only the serializable fields (name, event, flakeRatePct, flakeEvents)', () => {
    const out = computeRepoFlakeSummary([
      stat({ name: 'HighFiveCue', event: 'push', totalRuns: 18, flakeEvents: 5, flakeRatePct: 27.7 }),
    ]);
    expect(out.topChecks[0]).toEqual({
      name: 'HighFiveCue', event: 'push', flakeRatePct: 27.7, flakeEvents: 5,
    });
  });
});
