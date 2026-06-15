import { describe, it, expect } from 'vitest';
import { projectInputs, p90, reclaimWindowMs } from '../routing-inputs';
import { RUNNER_JOB_KEYS } from '../runner-plan';

/** Resolve a pool from a fixed name→pool map (event ignored for these tests). */
const poolFrom = (m: Record<string, string>) =>
  (name: string): string | null => m[name] ?? null;

describe('projectInputs — spot reclaim fraction', () => {
  it('is reclaims ÷ spot job starts (spot pools only), as a FRACTION', () => {
    // 2 reclaim events on spot, 8 spot job starts → 0.25. The on-demand rows
    // must NOT count toward either numerator or denominator.
    const pool = poolFrom({
      'test: unit': 'kindash-arc-spot',
      'build: production': 'kindash-arc', // on-demand — excluded
    });
    const reclaimEvents = [
      { name: 'test: unit', event: 'pull_request' },
      { name: 'test: unit', event: 'pull_request' },
      { name: 'build: production', event: 'pull_request' }, // on-demand reclaim — excluded
    ];
    const intervals = [
      ...Array(8).fill(0).map(() => ({ name: 'test: unit', event: 'pull_request' })),
      ...Array(5).fill(0).map(() => ({ name: 'build: production', event: 'pull_request' })),
    ];
    const { reclaimRate } = projectInputs(reclaimEvents, intervals, new Map(), (n) => pool(n));
    expect(reclaimRate).toBe(0.25);
  });

  it('is null when no spot jobs ran in the window', () => {
    // Only on-demand intervals → denominator 0 → null (never a fabricated 0).
    const pool = poolFrom({ 'build: production': 'kindash-arc' });
    const intervals = [{ name: 'build: production', event: 'pull_request' }];
    const { reclaimRate } = projectInputs([], intervals, new Map(), (n) => pool(n));
    expect(reclaimRate).toBeNull();
  });

  it('treats an unknown pool as non-spot (excluded from the denominator)', () => {
    const { reclaimRate } = projectInputs(
      [], [{ name: 'mystery', event: 'pull_request' }], new Map(), () => null);
    expect(reclaimRate).toBeNull();
  });
});

describe('projectInputs — per-key p90', () => {
  it('computes p90 across all shards matching a key, one row per key', () => {
    // Two shard names both collapse onto the 'unit' key via its regex.
    const samplesByKey = new Map<string, number[]>([
      ['unit', [100, 200, 300, 400, 500]], // p90 (nearest-rank) = 500
    ]);
    const { jobs } = projectInputs([], [], samplesByKey, () => 'kindash-arc-spot');
    // every RUNNER_JOB_KEY appears exactly once
    expect(jobs.map((j) => j.key).sort()).toEqual(Object.keys(RUNNER_JOB_KEYS).sort());
    const unit = jobs.find((j) => j.key === 'unit')!;
    expect(unit.p90Secs).toBe(500);
  });

  it('p90Secs is null for a cold-start key with no samples', () => {
    const { jobs } = projectInputs([], [], new Map(), () => 'kindash-arc-spot');
    // no samples provided for any key → all null
    expect(jobs.every((j) => j.p90Secs === null)).toBe(true);
  });
});

describe('p90 helper', () => {
  it('returns null on empty', () => {
    expect(p90([])).toBeNull();
  });
  it('returns the lone sample', () => {
    expect(p90([42])).toBe(42);
  });
  it('matches the shared nearest-rank percentile', () => {
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
  });
});

describe('reclaimWindowMs', () => {
  it('parses h/m/s/d units', () => {
    expect(reclaimWindowMs('24h')).toBe(24 * 3600_000);
    expect(reclaimWindowMs('90m')).toBe(90 * 60_000);
    expect(reclaimWindowMs('3600s')).toBe(3600 * 1000);
    expect(reclaimWindowMs('7d')).toBe(7 * 86400_000);
  });
  it('reads a bare number as hours', () => {
    expect(reclaimWindowMs('12')).toBe(12 * 3600_000);
  });
  it('falls back to 24h on unparseable input (no throw)', () => {
    expect(reclaimWindowMs('garbage')).toBe(24 * 3600_000);
    expect(reclaimWindowMs('0h')).toBe(24 * 3600_000);
    expect(reclaimWindowMs('')).toBe(24 * 3600_000);
  });
});
