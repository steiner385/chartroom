import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryStore } from '../history';
import { computeCostSummary } from '../metrics';

const REPO = 'acme/widgets';
const REPO2 = 'acme/gadgets';
const NOW = new Date('2026-06-11T12:00:00Z');

let h: HistoryStore;
beforeEach(() => {
  h = new HistoryStore(':memory:');
});

/** unit-tests/build → spot; e2e → composite ternary; mystery → unmappable. */
const poolsFor = (_repo: string, name: string, _event: string) =>
  name.startsWith('e2e') ? { pool: 'spot|ondemand', githubHosted: false }
    : name === 'mystery' ? null
      : { pool: 'spot', githubHosted: false };

/** One job row: started at `startISO`, ran `secs`, on a given event. */
const job = (name: string, startISO: string, secs: number, event = 'pull_request',
  attempt: number | null = 1, repo = REPO): void => {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + secs * 1000);
  h.recordCheckDuration(repo, name, event, start.toISOString(), end.toISOString(),
    'SUCCESS', 'sha-cost', attempt);
};

const summary = (cpm: Record<string, number> | null = null, opts: {
  exclude?: string[]; foreignNames?: Map<string, Set<string>>;
  poolMeta?: Parameters<typeof computeCostSummary>[5];
} = {}) =>
  computeCostSummary(h, NOW, opts.exclude ?? [], poolsFor,
    opts.foreignNames ?? new Map(), opts.poolMeta ?? null, cpm);

describe('computeCostSummary', () => {
  it('reports a 7-day window and the four stages, minutes-only when no rates', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request');   // 10m → pr
    job('unit-tests', '2026-06-10T10:00:00Z', 300, 'merge_group');    // 5m → queue
    job('build', '2026-06-09T10:00:00Z', 120, 'push');               // 2m → main
    job('unit-tests', '2026-06-08T10:00:00Z', 60, 'schedule');       // 1m → scheduled
    const c = summary(null);
    expect(c.days).toBe(7);
    expect(c.totalDollars).toBeNull();
    expect(c.retryWastePct).toBeNull();
    const byStage = new Map(c.byStage.map((s) => [s.stage, s]));
    expect(byStage.get('pr')!.minutes).toBeCloseTo(10);
    expect(byStage.get('queue')!.minutes).toBeCloseTo(5);
    expect(byStage.get('main')!.minutes).toBeCloseTo(2);
    expect(byStage.get('scheduled')!.minutes).toBeCloseTo(1);
    expect(c.byStage.every((s) => s.dollars === null)).toBe(true);
  });

  it('always lists all four stages in pipeline order even when empty', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request');
    const c = summary(null);
    expect(c.byStage.map((s) => s.stage)).toEqual(['pr', 'queue', 'main', 'scheduled']);
    expect(c.byStage.find((s) => s.stage === 'queue')!.minutes).toBe(0);
  });

  it('drops rows outside the 7-day window (started_at must be in-window)', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request');   // in window
    job('unit-tests', '2026-06-03T10:00:00Z', 600, 'pull_request');   // >7d old
    expect(summary(null).byStage.find((s) => s.stage === 'pr')!.minutes).toBeCloseTo(10);
  });

  it('prices priced pools; totalDollars sums priced minutes; unpriced pool stays null', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request');   // spot 10m
    job('mystery', '2026-06-11T10:10:00Z', 300, 'merge_group');       // unknown, unpriced
    const c = summary({ spot: 0.01 });
    expect(c.byStage.find((s) => s.stage === 'pr')!.dollars).toBeCloseTo(0.1);
    expect(c.byStage.find((s) => s.stage === 'queue')!.dollars).toBeCloseTo(0); // priced subset only
    expect(c.totalDollars).toBeCloseTo(0.1); // documented undercount — mystery excluded
  });

  it('poolMeta rates alone flip dollars on (no costPerMinute needed)', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request');
    const c = summary(null, { poolMeta: { default: { dollarsPerMinute: 0.02 } } });
    expect(c.totalDollars).toBeCloseTo(0.2);
    expect(c.byStage.find((s) => s.stage === 'pr')!.dollars).toBeCloseTo(0.2);
  });

  it('aggregates across repos (global, not per-repo)', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request', 1, REPO);   // 10m
    job('unit-tests', '2026-06-11T10:30:00Z', 600, 'pull_request', 1, REPO2);  // 10m
    expect(summary(null).byStage.find((s) => s.stage === 'pr')!.minutes).toBeCloseTo(20);
  });

  it('retryWastePct = priced retry minutes / priced total minutes (×100)', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request', 1);   // 10m, attempt 1
    job('unit-tests', '2026-06-11T10:20:00Z', 600, 'pull_request', 2);   // 10m, retry
    const c = summary({ spot: 0.01 });
    expect(c.retryWastePct).toBeCloseTo(50);
  });

  it('retryWastePct is null in minutes-only mode', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request', 2);
    expect(summary(null).retryWastePct).toBeNull();
  });

  it('respects exclude and foreign names (CI-lifecycle spans, not runner time)', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 300, 'pull_request');
    job('ci-gate', '2026-06-11T10:00:00Z', 9000, 'pull_request'); // foreign rollup mirror
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'pull_request', 1, REPO2);
    const c = summary(null, {
      exclude: [REPO2],
      foreignNames: new Map([[REPO, new Set(['ci-gate'])]]),
    });
    expect(c.byStage.find((s) => s.stage === 'pr')!.minutes).toBeCloseTo(5); // only unit-tests on REPO
  });

  it('empty history → zeroed stages, null dollars', () => {
    const c = summary(null);
    expect(c.totalDollars).toBeNull();
    expect(c.byStage.every((s) => s.minutes === 0)).toBe(true);
    expect(c.retryWastePct).toBeNull();
  });

  it('unknown events do not map to a stage and are ignored', () => {
    job('unit-tests', '2026-06-11T10:00:00Z', 600, 'workflow_dispatch');
    const c = summary(null);
    expect(c.byStage.every((s) => s.minutes === 0)).toBe(true);
  });
});
