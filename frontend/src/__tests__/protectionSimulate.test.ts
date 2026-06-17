import { describe, it, expect } from 'vitest';
import { simulateMove, perRunMinutes, tierRunScale, legalFromTiers, legalToTargets } from '../protectionSimulate';
import type { DerivedModel } from '../ProtectionMap';

const obs = (runs: number, minutes: number) => ({ ran: runs > 0, runs, realFailures: 0, failRatePct: 0, flakeRatePct: 0, minutes });

const MODEL: DerivedModel = {
  tiers: [
    { id: 'pr', label: 'PR', event: 'pull_request' },
    { id: 'queue', label: 'Queue', event: 'merge_group' },
    { id: 'main', label: 'Main', event: 'push' },
  ],
  checks: ['unit', 'e2e'],
  cells: [
    // unit: runs at PR (300 runs, 600 min) and Queue (100 runs, 200 min); gates at Queue
    { check: 'unit', tierId: 'pr', intent: { runs: true, gates: false, conditional: false }, observed: obs(300, 600), drift: false, state: 'advisory' },
    { check: 'unit', tierId: 'queue', intent: { runs: true, gates: true, conditional: false }, observed: obs(100, 200), drift: false, state: 'gate' },
    { check: 'unit', tierId: 'main', intent: { runs: false, gates: false, conditional: false }, observed: null, drift: false, state: 'absent' },
    // e2e: runs only at Queue
    { check: 'e2e', tierId: 'pr', intent: { runs: false, gates: false, conditional: false }, observed: null, drift: false, state: 'absent' },
    { check: 'e2e', tierId: 'queue', intent: { runs: true, gates: true, conditional: false }, observed: obs(100, 500), drift: false, state: 'gate' },
    { check: 'e2e', tierId: 'main', intent: { runs: false, gates: false, conditional: false }, observed: null, drift: false, state: 'absent' },
  ],
};

describe('perRunMinutes / tierRunScale', () => {
  it('pools per-run minutes across tiers', () => {
    // unit: (600+200) / (300+100) = 2 min/run
    expect(perRunMinutes(MODEL, 'unit')).toBe(2);
  });
  it('tier cadence = busiest observed run count at the tier', () => {
    expect(tierRunScale(MODEL, 'pr')).toBe(300);   // unit's 300 PR runs
    expect(tierRunScale(MODEL, 'queue')).toBe(100);
  });
});

describe('simulateMove', () => {
  it('removing a check from a tier saves its observed minutes and loses its gate', () => {
    const r = simulateMove(MODEL, { check: 'unit', fromTierId: 'queue', toTierId: null });
    expect(r.costDeltaMinutes).toBe(-200);
    expect(r.gatesLost).toEqual(['queue']);
    expect(r.estimated).toBe(false);
    expect(r.note).toMatch(/saves 200 min.*loses gate at queue/);
  });

  it('moving to a tier where it already runs uses the exact observed cost there', () => {
    // move unit PR(600) → Queue (already 200 observed) → delta = 200 - 600 = -400
    const r = simulateMove(MODEL, { check: 'unit', fromTierId: 'pr', toTierId: 'queue' });
    expect(r.costDeltaMinutes).toBe(-400);
    expect(r.estimated).toBe(false);
    expect(r.gatesGained).toEqual([]); // already gates at queue
  });

  it('moving to a tier with no history estimates the add-side cost and flags estimated', () => {
    // move e2e Queue(500, gates) → PR. e2e has no PR history, so the add-side is
    // estimated: perRunMinutes(e2e) = 500/100 = 5 × tierRunScale(pr) = 300 → +1500.
    // remove 500 at queue → delta = 1500 - 500 = +1000; loses the queue gate.
    const r = simulateMove(MODEL, { check: 'e2e', fromTierId: 'queue', toTierId: 'pr' });
    expect(r.estimated).toBe(true);
    expect(r.costDeltaMinutes).toBe(1000);
    expect(r.gatesLost).toEqual(['queue']);
    expect(r.gatesGained).toEqual(['pr']); // e2e doesn't gate at PR today → would add one
    expect(r.note).toMatch(/adds 1,?000 min \(est\.\)/);
  });
});

const T4 = [
  { id: 'pr', label: 'PR', event: 'pull_request' },
  { id: 'queue', label: 'Queue', event: 'merge_group' },
  { id: 'main', label: 'Main', event: 'push' },
  { id: 'nightly', label: 'Nightly', event: 'schedule' },
];
const cell = (check: string, tierId: string, runs: boolean, gates: boolean, o: ReturnType<typeof obs> | null, state: string) =>
  ({ check, tierId, intent: { runs, gates, conditional: false }, observed: o, drift: false, state }) as DerivedModel['cells'][number];
const META_MODEL: DerivedModel = {
  tiers: T4,
  checks: ['gate-check', 'pr-only'],
  cells: [
    cell('gate-check', 'pr', true, false, obs(100, 200), 'advisory'),
    cell('gate-check', 'queue', true, true, obs(50, 300), 'gate'),
    cell('gate-check', 'main', false, false, null, 'absent'),
    cell('gate-check', 'nightly', false, false, null, 'absent'),
    cell('pr-only', 'pr', true, false, obs(100, 100), 'advisory'),
    cell('pr-only', 'queue', false, false, null, 'absent'),
    cell('pr-only', 'main', false, false, null, 'absent'),
    cell('pr-only', 'nightly', false, false, null, 'absent'),
  ],
  checkMeta: [
    { check: 'gate-check', triggers: ['pull_request', 'merge_group'], provenance: [{ file: 'ci.yml', jobId: 'gate' }], confidence: 'high', isRequiredMergeGate: true },
    { check: 'pr-only', triggers: ['pull_request'], provenance: [{ file: 'fast.yml', jobId: 'pronly' }], confidence: 'high', isRequiredMergeGate: false },
  ],
};

describe('simulateMove legality (safety invariant + constrained moves)', () => {
  it('refuses to move a required merge gate OFF the queue', () => {
    const r = simulateMove(META_MODEL, { check: 'gate-check', fromTierId: 'queue', toTierId: 'main' });
    expect(r.legal).toBe(false);
    expect(r.reason).toMatch(/required merge-queue gate/);
    expect(r.note).toMatch(/not possible/);
  });
  it('refuses to REMOVE a required merge gate from the queue', () => {
    expect(simulateMove(META_MODEL, { check: 'gate-check', fromTierId: 'queue', toTierId: null }).legal).toBe(false);
  });
  it('refuses a move to a tier whose event the workflow does not declare', () => {
    const r = simulateMove(META_MODEL, { check: 'pr-only', fromTierId: 'pr', toTierId: 'main' });
    expect(r.legal).toBe(false);
    expect(r.reason).toMatch(/no push trigger/);
  });
  it('allows demoting between declared events and labels the direction', () => {
    const r = simulateMove(META_MODEL, { check: 'gate-check', fromTierId: 'pr', toTierId: 'queue' });
    expect(r.legal).toBe(true);
    expect(r.direction).toBe('demote');
  });
  it('legalFromTiers = only tiers where the check runs', () => {
    expect(legalFromTiers(META_MODEL, 'pr-only').map((t) => t.id)).toEqual(['pr']);
    expect(legalFromTiers(META_MODEL, 'gate-check').map((t) => t.id)).toEqual(['pr', 'queue']);
  });
  it('legalToTargets excludes undeclared events and blocks a required-gate queue', () => {
    // pr-only declares only pull_request → from PR, no tier target is legal, only remove
    expect(legalToTargets(META_MODEL, 'pr-only', 'pr').map((t) => t.label)).toEqual(['— remove —']);
    // gate-check sitting on the queue is a required gate → no legal targets at all
    expect(legalToTargets(META_MODEL, 'gate-check', 'queue')).toEqual([]);
  });
});
