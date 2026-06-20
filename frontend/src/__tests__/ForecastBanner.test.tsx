import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ForecastBanner } from '../shell/ForecastBanner';
import { RouterProvider } from '../embed/RouterContext';
import type { WorkspaceApi, ForecastDto } from '../shell/workspaceApi';

const api = (f: ForecastDto): WorkspaceApi => ({ forecast: vi.fn(async () => f) } as unknown as WorkspaceApi);
// ForecastBanner now uses useSectionRoute for its "View cost trend" CTA (#190).
const wrap = (ui: React.ReactNode) => <RouterProvider mode="hash">{ui}</RouterProvider>;

describe('ForecastBanner (Group J1/J2)', () => {
  it('warns when the budget breach is near, with high-confidence wording', async () => {
    render(wrap(<ForecastBanner api={api({ available: true, daysToThreshold: 9, confidence: 'high', unit: 'minutes' })} repo="o/r" />));
    const b = await screen.findByRole('status');
    expect(b).toHaveTextContent(/minutes budget runs out in ~9 days/);
    expect(b).not.toHaveTextContent(/estimate|low confidence/);
    // and a CTA to the cost analytics
    expect(screen.getByRole('button', { name: /view cost trend/i })).toBeInTheDocument();
  });

  it('hedges the wording on a low-confidence forecast', async () => {
    render(wrap(<ForecastBanner api={api({ available: true, daysToThreshold: 5, confidence: 'low', unit: 'minutes' })} repo="o/r" />));
    expect(await screen.findByRole('status')).toHaveTextContent(/low confidence/);
  });

  it('renders nothing when the breach is far off', async () => {
    const { container } = render(wrap(<ForecastBanner api={api({ available: true, daysToThreshold: 90, confidence: 'high' })} repo="o/r" warnWithinDays={14} />));
    await waitFor(() => expect(container.querySelector('.forecast-banner')).toBeNull());
  });

  it('renders nothing when there is no series (available:false) or no rising trend', async () => {
    const { container, rerender } = render(wrap(<ForecastBanner api={api({ available: false })} repo="o/r" />));
    await waitFor(() => expect(container.querySelector('.forecast-banner')).toBeNull());
    rerender(wrap(<ForecastBanner api={api({ available: true, daysToThreshold: null, confidence: 'high' })} repo="o/r" />));
    await waitFor(() => expect(container.querySelector('.forecast-banner')).toBeNull());
  });
});
