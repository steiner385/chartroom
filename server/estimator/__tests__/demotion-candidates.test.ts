import { describe, it, expect } from 'vitest';
import {
  computeDemotionCandidates, DEMOTION_DEFAULTS, DEMOTION_MIN_RUNS,
  type SuccessStat,
} from '../demotion-candidates';

const stat = (over: Partial<SuccessStat>): SuccessStat => ({
  name: 'check', event: 'pull_request', totalRuns: 100, failingRuns: 0, sumDurationSecs: 60_000, ...over,
});

describe('computeDemotionCandidates', () => {
  it('ranks qualifying checks by cost (runner-minutes) descending', () => {
    const cands = computeDemotionCandidates([
      stat({ name: 'cheap', sumDurationSecs: 6_000 }),   // 100 min
      stat({ name: 'pricey', sumDurationSecs: 60_000 }), // 1000 min
      stat({ name: 'mid', sumDurationSecs: 30_000 }),    // 500 min
    ]);
    expect(cands.map((c) => c.name)).toEqual(['pricey', 'mid', 'cheap']);
    expect(cands[0]!.minutesInWindow).toBe(1000);
  });

  it('excludes checks below the minimum run count (insufficient history)', () => {
    const cands = computeDemotionCandidates([stat({ totalRuns: DEMOTION_MIN_RUNS - 1, failingRuns: 0 })]);
    expect(cands).toEqual([]);
  });

  it('excludes checks below the success threshold (flaky / failing)', () => {
    // 95/100 = 95% < 99% default
    const cands = computeDemotionCandidates([stat({ totalRuns: 100, failingRuns: 5 })]);
    expect(cands).toEqual([]);
  });

  it('admits a check at exactly the ≥99% bar', () => {
    const cands = computeDemotionCandidates([stat({ totalRuns: 100, failingRuns: 1 })]);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.successRatePct).toBe(99);
  });

  it('excludes events with no lower tier in the ladder (e.g. schedule)', () => {
    const cands = computeDemotionCandidates([stat({ event: 'schedule' })]);
    expect(cands).toEqual([]);
  });

  it('maps current/suggested tier from the trigger event', () => {
    const [pr] = computeDemotionCandidates([stat({ event: 'pull_request' })]);
    expect(pr).toMatchObject({ currentTier: 'every PR push', suggestedTier: 'merge queue only' });
    const [mg] = computeDemotionCandidates([stat({ event: 'merge_group' })]);
    expect(mg).toMatchObject({ currentTier: 'every merge-queue build', suggestedTier: 'nightly' });
  });

  it('caps the list at topN', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      stat({ name: `c${i}`, sumDurationSecs: (i + 1) * 6_000 }));
    expect(computeDemotionCandidates(many, { ...DEMOTION_DEFAULTS, topN: 5 })).toHaveLength(5);
  });

  it('builds a human reason with the green ratio and cost', () => {
    const [c] = computeDemotionCandidates([stat({ totalRuns: 120, failingRuns: 0, sumDurationSecs: 72_000 })]);
    expect(c!.reason).toBe('120/120 green · ~1200 runner-min in window');
  });
});
