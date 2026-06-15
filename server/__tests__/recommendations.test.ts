import { describe, it, expect } from 'vitest';
import { deriveRecommendations, type RecommendationInputs } from '../estimator/recommendations';

const empty: RecommendationInputs = { batchAdvisor: [], queueEfficiency: [], lint: [] };

describe('deriveRecommendations (tuning digest)', () => {
  it('emits nothing when every advisor is satisfied', () => {
    expect(deriveRecommendations({
      batchAdvisor: [{ repo: 'r', currentBatch: 6, recommendedBatch: 6, ejectProbPerGroup: 0.05,
        curve: [{ batch: 6, throughputPerHour: 10 }] }],
      queueEfficiency: [{ repo: 'r',
        runConclusion: { total: 5, runFailed: 0, advisoryNoise: 0, requiredConfigured: true },
        adminBypass: { rate: 0.02, merges: 50 } }],
      lint: [{ repo: 'r', findings: [] }],
    })).toEqual([]);
  });

  it('recommends a batch change with the modelled throughput gain', () => {
    const [r] = deriveRecommendations({ ...empty, batchAdvisor: [
      { repo: 'r', currentBatch: 6, recommendedBatch: 12, ejectProbPerGroup: 0.09,
        curve: [{ batch: 6, throughputPerHour: 16 }, { batch: 12, throughputPerHour: 24 }] }] });
    expect(r).toMatchObject({ kind: 'batch-size', priority: 'medium',
      title: 'raise merge-queue batch 6 → 12' });
    expect(r!.detail).toContain('+50%');   // 24/16 − 1
  });

  it('flags advisory-only failures (high when ≥40% of runs)', () => {
    const [r] = deriveRecommendations({ ...empty, queueEfficiency: [
      { repo: 'r', runConclusion: { total: 10, runFailed: 5, advisoryNoise: 5, requiredConfigured: true },
        adminBypass: { rate: null, merges: 0 } }] });
    expect(r).toMatchObject({ kind: 'advisory-in-merge-group', priority: 'high' });
    expect(r!.title).toBe('remove advisory jobs from merge_group');
  });

  it('flags admin-bypass over 10% as high priority', () => {
    const recs = deriveRecommendations({ ...empty, queueEfficiency: [
      { repo: 'r', runConclusion: { total: 0, runFailed: 0, advisoryNoise: 0, requiredConfigured: true },
        adminBypass: { rate: 0.22, merges: 40 } }] });
    expect(recs.find((x) => x.kind === 'admin-bypass')).toMatchObject({ priority: 'high' });
  });

  it('suggests requiredCheckPrefixes when the split is unknowable', () => {
    const recs = deriveRecommendations({ ...empty, queueEfficiency: [
      { repo: 'r', runConclusion: { total: 3, runFailed: 2, advisoryNoise: 2, requiredConfigured: false },
        adminBypass: { rate: null, merges: 0 } }] });
    expect(recs.map((x) => x.kind)).toContain('set-required-prefixes');
  });

  it('includes lint findings and ranks the whole list high → low', () => {
    const recs = deriveRecommendations({
      batchAdvisor: [{ repo: 'r', currentBatch: 4, recommendedBatch: 8, ejectProbPerGroup: 0.1,
        curve: [{ batch: 4, throughputPerHour: 8 }, { batch: 8, throughputPerHour: 12 }] }],
      queueEfficiency: [{ repo: 'r',
        runConclusion: { total: 0, runFailed: 0, advisoryNoise: 0, requiredConfigured: true },
        adminBypass: { rate: 0.3, merges: 20 } }],
      lint: [{ repo: 'r', findings: [
        { rule: 'timeout', severity: 'warn', job: 'integration', message: 'timeout 30m but p99 11m' }] }],
    });
    expect(recs.map((r) => r.priority)).toEqual(['high', 'medium', 'medium']);  // sorted
    expect(recs[0]!.kind).toBe('admin-bypass');
    expect(recs.some((r) => r.kind === 'lint:timeout')).toBe(true);
  });
});
