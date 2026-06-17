import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveStaticGraph } from '../derive-static';
import { gatingClosure } from '../gating';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

// Fixture's ci.yml: jobs static-checks, build (needs static-checks), queue-only.
// Add a rollup `ci` that needs [build] so the closure is {build, static-checks}.
const ROLLUP = `
on:
  pull_request:
  merge_group:
jobs:
  static-checks:
    uses: ./.github/workflows/_static.yml
  build:
    name: "build: production"
    needs: [static-checks]
    runs-on: ubuntu-latest
  ci:
    name: ci
    needs: [build]
    runs-on: ubuntu-latest
`;

describe('gatingClosure', () => {
  it('marks caller jobs in the ci needs-closure as gating', () => {
    const g = deriveStaticGraph({ 'ci.yml': ROLLUP, '_static.yml': fx('_static.yml') });
    const res = gatingClosure(g, 'ci');
    expect(res.gatingCallerJobs.sort()).toEqual(['build', 'static-checks']);
  });

  it('a CheckNode gates at an event only when its caller gates AND it runs at that event', () => {
    const g = deriveStaticGraph({ 'ci.yml': ROLLUP, '_static.yml': fx('_static.yml') });
    const res = gatingClosure(g, 'ci');
    const tsc = res.gates.find((x) => x.checkName === 'static-checks / types: tsc')!;
    expect(tsc.events.sort()).toEqual(['merge_group', 'pull_request']);
  });

  it('conditional caller jobs are reported separately (skipped == pass)', () => {
    const g = deriveStaticGraph({ 'ci.yml': ROLLUP, '_static.yml': fx('_static.yml') });
    const res = gatingClosure(g, 'ci', { conditionalCallerJobs: ['static-checks'] });
    expect(res.conditionalCallerJobs).toEqual(['static-checks']);
    expect(res.gatingCallerJobs).toEqual(['build']); // static-checks moved to conditional
  });

  it('missing rollup → empty result, no throw', () => {
    const g = deriveStaticGraph({ 'ci.yml': ROLLUP, '_static.yml': fx('_static.yml') });
    const res = gatingClosure(g, 'nonexistent');
    expect(res).toEqual({ gatingCallerJobs: [], conditionalCallerJobs: [], gates: [] });
  });
});
