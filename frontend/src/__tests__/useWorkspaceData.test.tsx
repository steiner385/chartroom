import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import type { DashboardState } from '../types';

const STATE: DashboardState = {
  generatedAt: '2026-06-18T00:00:00Z', staleSince: null,
  repos: [{ repo: 'o/a' } as any, { repo: 'o/b' } as any],
};

vi.mock('../useDashboard', () => ({
  useDashboard: () => ({
    state: STATE, connected: true, stale: false,
    notifySupported: false, notifyEnabled: false, toggleNotify: () => {},
  }),
}));

import { useWorkspaceData } from '../useWorkspaceData';

it('derives repos from state and exposes the workspace api', () => {
  const { result } = renderHook(() => useWorkspaceData());
  expect(result.current.repos).toEqual(['o/a', 'o/b']);
  expect(typeof result.current.api.getPipeline).toBe('function');
  expect(result.current.connected).toBe(true);
});
