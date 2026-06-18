import { useRef, useState } from 'react';
import { PipelineSwitcher } from '../shell/PipelineSwitcher';
import { SelfHealthDot } from '../shell/SelfHealthDot';
import { LegendPanel } from '../LegendPanel';
import type { WorkspaceApi } from '../shell/workspaceApi';

export interface StatusStripProps {
  repos: readonly string[];
  focused: string | null;
  onFocus: (repo: string) => void;
  connected: boolean;
  stale: boolean;
  api: WorkspaceApi;
}

/** Content-chrome for the embed: pipeline switcher + liveness + self-health + Legend.
 *  Re-homes the signals the dropped spine header carried (no host header to rely on). */
export function StatusStrip({ repos, focused, onFocus, connected, stale, api }: StatusStripProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const legendRef = useRef<HTMLButtonElement>(null);
  const liveness = !connected
    ? { cls: 'down', label: '○ reconnecting', title: 'reconnecting' }
    : stale
      ? { cls: 'stale', label: '◐ stale', title: 'connected, but no fresh data in 90s — feed may be stalled' }
      : { cls: 'live', label: '● live', title: 'live' };
  return (
    <div className="prdash-status-strip">
      <span className="pipeline-strip-label" id="prdash-pipeline-label">Pipeline:</span>
      <PipelineSwitcher repos={repos} focused={focused} onFocus={onFocus} />
      <span className={`liveness ${liveness.cls}`} title={liveness.title}>{liveness.label}</span>
      <SelfHealthDot api={api} />
      <button type="button" ref={legendRef} className="legend-btn" aria-label="Legend"
        aria-haspopup="dialog" aria-expanded={legendOpen} onClick={() => setLegendOpen(true)}>
        <span aria-hidden="true">?</span>
      </button>
      <LegendPanel open={legendOpen} onClose={() => setLegendOpen(false)} returnFocusRef={legendRef} />
    </div>
  );
}
