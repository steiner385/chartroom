import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FailuresPanel } from '../FailuresPanel';
import type { DashboardState } from '../../../types';

const check = (name: string, rate: number, over: object = {}) =>
  ({ name, event: 'push', flakeRatePct: rate, flakeEvents: 3, ...over });
const repo = (over: object) => ({ repo: 'acme/widgets', hasDeploy: false, prs: [], queue: null, ...over });
const flaky = (over: object) => repo({ flake: { topChecks: [], flakyCount: 0, ...over } });

describe('FailuresPanel', () => {
  it('shows an empty note when no repo has flaky checks', () => {
    render(<FailuresPanel repos={[repo({})] as unknown as DashboardState['repos']} />);
    expect(screen.getByText(/no active flake/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('spine-flake-row')).toHaveLength(0);
  });

  it('renders a row per flaky check with name, event, rate% and flakeEvents', () => {
    render(<FailuresPanel repos={[flaky({
      topChecks: [check('HighFiveCue', 27.7, { flakeEvents: 5, event: 'pull_request' })], flakyCount: 1,
    })] as unknown as DashboardState['repos']} />);
    const row = screen.getByTestId('spine-flake-row');
    expect(row).toHaveTextContent('HighFiveCue');
    expect(row).toHaveTextContent('pull_request');
    expect(row).toHaveTextContent('28%');   // 27.7 rounded
    expect(row).toHaveTextContent('5');     // flakeEvents
  });

  it('sorts rows by flake rate descending, across repos', () => {
    const repos = [
      flaky({ topChecks: [check('mid', 20)], flakyCount: 1 }),
      { ...flaky({ topChecks: [check('worst', 44)], flakyCount: 1 }), repo: 'b/b' },
      { ...flaky({ topChecks: [check('low', 8)], flakyCount: 1 }), repo: 'c/c' },
    ];
    render(<FailuresPanel repos={repos as unknown as DashboardState['repos']} />);
    const rows = screen.getAllByTestId('spine-flake-row');
    expect(rows.map((r) => within(r).getByTestId('spine-flake-name').textContent))
      .toEqual(['worst', 'mid', 'low']);
  });

  it('shows the coming-soon note for failure-reporter clusters + Sentry', () => {
    render(<FailuresPanel repos={[flaky({ topChecks: [check('x', 30)], flakyCount: 1 })] as unknown as DashboardState['repos']} />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
