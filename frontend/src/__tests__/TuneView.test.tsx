import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TuneView } from '../sections/tune/TuneView';
import type { WorkspaceApi } from '../shell/workspaceApi';

const api = (over: Partial<WorkspaceApi> = {}): WorkspaceApi => ({
  budgets: vi.fn(async () => ({ gauges: [{ kind: 'minutes', threshold: 50000, current: 60000, unit: 'min', fractionUsed: 1.2, state: 'breach' as const }], alerts: [] })),
  policy: vi.fn(async () => ({ rules: [{ id: 'r1', kind: 'required-gate-runs-on-pr' }], violations: [{ ruleId: 'r1', kind: 'required-gate-runs-on-pr', check: 'build', detail: 'caught late' }] })),
  outcomes: vi.fn(async () => ({ outcomes: [{ prNumber: 5, check: 'e2e', costAccuracy: 0.92, directionCorrect: true, confidence: 'high', caveat: 'confounded' }], accuracy: { count: 1, meanCostAccuracy: 0.92, directionHitRate: 1, recommenderUsable: false } })),
  changelog: vi.fn(async () => ({ changelog: [{ at: '2026-06-10T00:00:00Z', kind: 'config', summary: 'retention 7→30d', actor: 'tony' }], audit: [{ at: '2026-06-11T00:00:00Z', action: 'draft-pr', repo: 'o/r', target: 'e2e', result: 'opened #5', actor: 'workspace' }] })),
  ...over,
} as unknown as WorkspaceApi);

describe('TuneView (US5 — 5th section, aggregates J3/I2/H/L)', () => {
  it('renders budget gauges with breach state', async () => {
    render(<TuneView repo="o/r" api={api()} />);
    expect(await screen.findByLabelText('Budgets')).toHaveTextContent(/minutes.*120%/);
  });

  it('renders policy violations and outcomes accuracy', async () => {
    render(<TuneView repo="o/r" api={api()} />);
    expect(await screen.findByLabelText('Policy violations')).toHaveTextContent(/build.*caught late/);
    expect(await screen.findByLabelText('Outcomes')).toHaveTextContent(/92% mean accuracy \(advisory\)/);
  });

  it('renders the changelog + action audit', async () => {
    render(<TuneView repo="o/r" api={api()} />);
    const log = await screen.findByLabelText('Changelog and audit');
    expect(log).toHaveTextContent(/retention 7→30d/);
    expect(log).toHaveTextContent(/tool draft-pr/);
  });

  it('a failing panel does not block the others (advisory, FR-022)', async () => {
    render(<TuneView repo="o/r" api={api({ policy: vi.fn(async () => { throw new Error('boom'); }) })} />);
    expect(await screen.findByLabelText('Budgets')).toBeInTheDocument(); // budgets still render
    expect(screen.queryByLabelText('Policy violations')).not.toBeInTheDocument();
  });
});
