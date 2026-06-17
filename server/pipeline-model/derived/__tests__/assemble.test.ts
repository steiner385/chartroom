// server/pipeline-model/derived/__tests__/assemble.test.ts
import { describe, it, expect } from 'vitest';
import { assembleDerivedModel } from '../assemble';
import { KINDASH_TIERS } from '../tiers';
import { observedKey, type ObservedCell } from '../observed';
import { DRIFT_DEFAULTS } from '../drift';
import type { StaticGraph, GatingResult } from '../../types';

const ev = (...kinds: string[]) => ({ events: kinds.map((kind) => ({ kind })) }) as never;

const graph: StaticGraph = {
  rollupFile: 'ci.yml',
  callerNeeds: { 'static-checks': [], build: ['static-checks'], ci: ['build'] },
  checks: [
    // build: production runs on PR + Queue, gates both
    { checkName: 'build: production', callerJobId: 'build', triggers: ev('pull_request', 'merge_group'), provenance: [{ file: 'build.yml', jobId: 'build' }], confidence: 'high' },
    // a queue-only gate
    { checkName: 'static-checks / test: unit', callerJobId: 'static-checks', triggers: ev('merge_group'), provenance: [], confidence: 'high' },
    // an advisory PR-only check (low confidence → conditional)
    { checkName: 'a11y: axe', callerJobId: 'a11y', triggers: ev('pull_request'), provenance: [], confidence: 'low' },
  ],
};
const gating: GatingResult = {
  gatingCallerJobs: ['build', 'static-checks'],
  conditionalCallerJobs: [],
  gates: [
    { checkName: 'build: production', events: ['merge_group', 'pull_request'] },
    { checkName: 'static-checks / test: unit', events: ['merge_group'] },
  ],
};

describe('assembleDerivedModel', () => {
  const observed = new Map<string, ObservedCell>([
    [observedKey('build: production', 'merge_group'), { ran: true, runs: 200, realFailures: 0, failRatePct: 0, flakeRatePct: 0, minutes: 1000 }],
  ]);
  const model = assembleDerivedModel(graph, gating, observed, KINDASH_TIERS);
  const cell = (check: string, tierId: string) => model.cells.find((c) => c.check === check && c.tierId === tierId)!;

  it('exposes per-check meta: triggers, provenance, confidence, merge-gate safety', () => {
    const meta = (c: string) => model.checkMeta.find((m) => m.check === c)!;
    expect(meta('build: production').triggers.sort()).toEqual(['merge_group', 'pull_request']);
    expect(meta('build: production').provenance).toEqual([{ file: 'build.yml', jobId: 'build' }]);
    expect(meta('build: production').isRequiredMergeGate).toBe(true); // gates merge_group, unconditional caller
    expect(meta('a11y: axe').confidence).toBe('low');
    expect(meta('a11y: axe').isRequiredMergeGate).toBe(false); // PR-only, never gates the queue
  });

  it('has one cell per (check, tier)', () => {
    expect(model.checks.length).toBe(3);
    expect(model.cells.length).toBe(3 * KINDASH_TIERS.length);
  });
  it('build: production is a gate at PR and Queue, absent at Main/Nightly', () => {
    expect(cell('build: production', 'pr').state).toBe('gate');
    expect(cell('build: production', 'queue').state).toBe('gate');
    expect(cell('build: production', 'main').state).toBe('absent');
  });
  it('a low-confidence check renders conditional where it runs', () => {
    expect(cell('a11y: axe', 'pr').state).toBe('conditional');
    expect(cell('a11y: axe', 'queue').state).toBe('absent');
  });
  it('attaches observed facts where present and null elsewhere', () => {
    expect(cell('build: production', 'queue').observed).toMatchObject({ runs: 200 });
    expect(cell('build: production', 'pr').observed).toBeNull();
  });
  it('flags drift: build gates at PR (configured) but has no PR history while active at Queue', () => {
    expect(cell('build: production', 'pr').drift).toBe(true);
    expect(cell('build: production', 'queue').drift).toBe(false);
  });
});

describe('assembleDerivedModel — drift min-runs floor', () => {
  // A check observed ONLY at a single tier with runs below the floor should
  // NOT trigger configured-but-unobserved drift at any other tier, because
  // activeChecks requires >= cfg.minRuns to count.
  const graphWithExtra: StaticGraph = {
    rollupFile: 'ci.yml',
    callerNeeds: { 'static-checks': [], build: ['static-checks'], ci: ['build'] },
    checks: [
      // Runs at PR and Queue, gates both.
      { checkName: 'build: production', callerJobId: 'build', triggers: ev('pull_request', 'merge_group'), provenance: [], confidence: 'high' },
      // A check that only has 5 runs at queue (below the 30-run floor).
      { checkName: 'flaky-newjob', callerJobId: 'build', triggers: ev('pull_request', 'merge_group'), provenance: [], confidence: 'high' },
    ],
  };
  const gatingNoGates: GatingResult = {
    gatingCallerJobs: ['build'],
    conditionalCallerJobs: [],
    gates: [
      { checkName: 'build: production', events: ['merge_group', 'pull_request'] },
      { checkName: 'flaky-newjob', events: ['merge_group', 'pull_request'] },
    ],
  };

  // flaky-newjob has 5 runs at queue (below DRIFT_DEFAULTS.minRuns=30).
  // build: production has 200 runs at queue (above floor).
  const observedFloor = new Map<string, ObservedCell>([
    [observedKey('build: production', 'merge_group'), { ran: true, runs: 200, realFailures: 0, failRatePct: 0, flakeRatePct: 0, minutes: 1000 }],
    [observedKey('flaky-newjob', 'merge_group'), { ran: true, runs: 5, realFailures: 0, failRatePct: 0, flakeRatePct: 0, minutes: 10 }],
  ]);
  const modelFloor = assembleDerivedModel(graphWithExtra, gatingNoGates, observedFloor, KINDASH_TIERS, DRIFT_DEFAULTS);
  const cell = (check: string, tierId: string) => modelFloor.cells.find((c) => c.check === check && c.tierId === tierId)!;

  it('does NOT flag direction-1 drift when the only observed run-count elsewhere is below the floor', () => {
    // flaky-newjob: configured at PR, observed 5 runs at queue (below floor=30).
    // runsElsewhere should be false → no drift at PR tier.
    expect(cell('flaky-newjob', 'pr').drift).toBe(false);
  });

  it('still flags direction-1 drift when the observed run-count elsewhere meets the floor', () => {
    // build: production: configured at PR, observed 200 runs at queue (>= floor=30).
    // runsElsewhere should be true → drift at PR (configured, no PR history).
    expect(cell('build: production', 'pr').drift).toBe(true);
  });
});
