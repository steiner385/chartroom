import { useMemo } from 'react';
import { useDashboard } from './useDashboard';
import { makeWorkspaceApi, type WorkspaceApi } from './shell/workspaceApi';
import { useApiBase } from './embed/ApiBaseContext';
import type { DashboardState } from './types';

export interface WorkspaceData {
  state: DashboardState | null;
  connected: boolean;
  stale: boolean;
  repos: string[];
  api: WorkspaceApi;
  notifySupported: boolean;
  notifyEnabled: boolean;
  toggleNotify: () => void;
}

/** The single data layer shared by the standalone shell and the embed component. */
export function useWorkspaceData(): WorkspaceData {
  const { state, connected, stale, notifySupported, notifyEnabled, toggleNotify } = useDashboard();
  const { apiUrl, fetch: boundFetch } = useApiBase();
  const repos = useMemo(() => (state ? state.repos.map((r) => r.repo) : []), [state]);
  const api = useMemo(() => makeWorkspaceApi(boundFetch, apiUrl('/workspace')), [boundFetch, apiUrl]);
  return { state, connected, stale, repos, api, notifySupported, notifyEnabled, toggleNotify };
}
