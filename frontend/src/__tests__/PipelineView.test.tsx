import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PipelineView } from '../sections/pipeline/PipelineView';
import type { DashboardState, PrView } from '../types';

const pr = (repo: string, number: number, title: string, stage = 'ci'): PrView => ({
  repo, number, title, url: `https://x/${number}`,
  stage: { stage, substate: null, percent: 50, etaSeconds: 100, etaRangeSeconds: null, overdue: false },
  queueAheadCount: null, checks: [],
} as unknown as PrView);

const state = (over: Partial<DashboardState> = {}): DashboardState => ({
  generatedAt: '', staleSince: null,
  repos: [
    { repo: 'acme/alpha', hasDeploy: false, prs: [pr('acme/alpha', 1, 'alpha fix')], queue: null },
    { repo: 'acme/beta', hasDeploy: false, prs: [pr('acme/beta', 2, 'beta feature')], queue: null },
  ],
  ...over,
}) as unknown as DashboardState;

describe('PipelineView (the PR pipeline view, ported into the workspace)', () => {
  it('renders a section per repo with the PrRow rows', () => {
    render(<PipelineView state={state()} focusedRepo={null} />);
    expect(screen.getByText('acme/alpha')).toBeInTheDocument();
    expect(screen.getByText('alpha fix')).toBeInTheDocument();
    expect(screen.getByText('beta feature')).toBeInTheDocument();
  });

  it('orders the focused repo first', () => {
    render(<PipelineView state={state()} focusedRepo="acme/beta" />);
    const headers = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headers[0]).toContain('acme/beta');
  });

  it('collapsing a repo hides its PRs and shows a summary', () => {
    render(<PipelineView state={state()} focusedRepo={null} />);
    const alphaHeader = screen.getByText('acme/alpha').closest('button')!;
    expect(within(alphaHeader).queryByText(/PRs/)).not.toBeInTheDocument();
    fireEvent.click(alphaHeader);
    expect(screen.queryByText('alpha fix')).not.toBeInTheDocument();
    expect(alphaHeader).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a loading state when state is null', () => {
    render(<PipelineView state={null} focusedRepo={null} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('collapses the awaiting-prod herd into one expandable row, keeping running PRs visible', () => {
    const st = state({ repos: [{ repo: 'acme/alpha', hasDeploy: true, queue: null, prs: [
      pr('acme/alpha', 1, 'running pr', 'ci'),
      pr('acme/alpha', 2, 'merged a', 'qa-deploy'),
      pr('acme/alpha', 3, 'merged b', 'qa-deploy'),
    ] }] } as never);
    render(<PipelineView state={st} focusedRepo={null} />);
    // the running PR stays visible; the 2 awaiting-prod collapse behind a toggle
    expect(screen.getByText('running pr')).toBeInTheDocument();
    expect(screen.queryByText('merged a')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /2 merged · awaiting prod/i });
    fireEvent.click(toggle);
    expect(screen.getByText('merged a')).toBeInTheDocument();
  });
});
