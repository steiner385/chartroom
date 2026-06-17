import { describe, it, expect } from 'vitest';
import { buildClaudePrompt } from '../protectionPrompt';
import type { DerivedModel } from '../ProtectionMap';

const obs = (runs: number, minutes: number) => ({ ran: true, runs, realFailures: 0, failRatePct: 0, flakeRatePct: 0, minutes });
const cell = (check: string, tierId: string, runs: boolean, gates: boolean, o: ReturnType<typeof obs> | null, state: string) =>
  ({ check, tierId, intent: { runs, gates, conditional: false }, observed: o, drift: false, state }) as DerivedModel['cells'][number];

const MODEL: DerivedModel = {
  tiers: [
    { id: 'pr', label: 'PR', event: 'pull_request' },
    { id: 'queue', label: 'Queue', event: 'merge_group' },
  ],
  checks: ['lint: eslint', 'build: prod'],
  cells: [
    cell('lint: eslint', 'pr', true, false, obs(400, 800), 'advisory'),
    cell('lint: eslint', 'queue', true, false, obs(80, 160), 'advisory'),
    cell('build: prod', 'pr', true, true, obs(400, 4000), 'gate'),
    cell('build: prod', 'queue', true, true, obs(80, 800), 'gate'),
  ],
  checkMeta: [
    { check: 'lint: eslint', triggers: ['pull_request', 'merge_group'], provenance: [{ file: 'fast-checks.yml', jobId: 'eslint' }], confidence: 'high', isRequiredMergeGate: false },
    { check: 'build: prod', triggers: ['pull_request', 'merge_group'], provenance: [{ file: 'ci.yml', jobId: 'build' }], confidence: 'high', isRequiredMergeGate: true },
  ],
};

describe('buildClaudePrompt', () => {
  it('cost/demote prompt names repo, the exact file+job, and the demote edit', () => {
    const p = buildClaudePrompt('cairnea/KinDash', MODEL, { goal: 'cost', check: 'lint: eslint', detail: 'runs on every PR · ~800 min/wk', suggestedTierId: 'queue' });
    expect(p).toMatch(/cairnea\/KinDash/);
    expect(p).toMatch(/demote the CI check "lint: eslint"/);
    expect(p).toMatch(/\.github\/workflows\/fast-checks\.yml \(job `eslint`\)/);
    expect(p).toMatch(/merge_group/);
    expect(p).toMatch(/Open a PR/);
  });

  it('quality/shift-left prompt warns about added PR cost', () => {
    const p = buildClaudePrompt('cairnea/KinDash', MODEL, { goal: 'quality', check: 'lint: eslint', detail: '6 real fails caught late', suggestedTierId: 'pr' });
    expect(p).toMatch(/shift the CI check "lint: eslint" left/);
    expect(p).toMatch(/ADDS PR-time cost/);
  });

  it('drift prompt is investigate-only and flags a required gate', () => {
    const p = buildClaudePrompt('cairnea/KinDash', MODEL, { goal: 'drift', check: 'build: prod', detail: 'queue: configured ≠ observed' });
    expect(p).toMatch(/investigate and reconcile/i);
    expect(p).toMatch(/Do not blindly delete/);
    expect(p).toMatch(/REQUIRED merge-queue gate/);
    expect(p).not.toMatch(/Open a PR titled/); // investigate-only, no canned PR
  });
});
