import { describe, it, expect, vi } from 'vitest';
import { computeProtectionMap, reusableRefs } from '../protection-map';
import type { SuccessStat, FlakeStat } from '../history';

const CI = `
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
    needs: [build, static-checks]
    runs-on: ubuntu-latest
`;
const STATIC = `
on:
  workflow_call:
jobs:
  unit:
    name: "test: unit"
    runs-on: ubuntu-latest
`;

describe('reusableRefs', () => {
  it('extracts distinct _*.yml refs from a rollup workflow', () => {
    expect(reusableRefs(CI)).toEqual(['_static.yml']);
  });
});

describe('computeProtectionMap', () => {
  const fetchWorkflow = vi.fn(async (_repo: string, name: string) =>
    name === 'ci.yml' ? CI : name === '_static.yml' ? STATIC : null);

  it('fetches ci.yml + reusable workflows and builds the cell matrix', async () => {
    const model = await computeProtectionMap('o/r', '2026-01-01T00:00:00Z', {
      fetchWorkflow,
      successStatsByRepo: () => new Map<string, SuccessStat[]>(),
      flakeStatsByRepo: () => new Map<string, FlakeStat[]>(),
    });
    expect(model).not.toBeNull();
    expect(model!.checks).toContain('build: production');
    expect(model!.checks).toContain('static-checks / test: unit');
    // build: production gates at Queue
    const queue = model!.cells.find((c) => c.check === 'build: production' && c.tierId === 'queue')!;
    expect(queue.state).toBe('gate');
    expect(fetchWorkflow).toHaveBeenCalledWith('o/r', 'ci.yml');
    expect(fetchWorkflow).toHaveBeenCalledWith('o/r', '_static.yml');
  });

  it('attaches observed facts when history has them', async () => {
    const model = await computeProtectionMap('o/r', 's', {
      fetchWorkflow,
      successStatsByRepo: () => new Map([['o/r', [{ name: 'build: production', event: 'merge_group', totalRuns: 150, failingRuns: 0, sumDurationSecs: 60_000 }]]]),
      flakeStatsByRepo: () => new Map<string, FlakeStat[]>(),
    });
    const queue = model!.cells.find((c) => c.check === 'build: production' && c.tierId === 'queue')!;
    expect(queue.observed).toMatchObject({ runs: 150, minutes: 1000 });
  });

  it('returns null when ci.yml cannot be fetched', async () => {
    const model = await computeProtectionMap('o/r', 's', {
      fetchWorkflow: async () => null,
      successStatsByRepo: () => new Map(), flakeStatsByRepo: () => new Map(),
    });
    expect(model).toBeNull();
  });
});
