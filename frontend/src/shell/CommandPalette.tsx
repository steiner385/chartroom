// Command palette (roadmap WS5.3) — ⌘K / Ctrl-K jumps to any section or focuses any
// repo by keyboard. Single-operator tools live and die by keyboard speed; this is the
// global accelerator over the workspace. Combobox pattern: input owns focus + keys
// (↑↓ move the active command, Enter runs it, Escape closes). Extensible to PRs/checks.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SECTIONS, hashForSection, type SectionId } from './sections';

interface Command { id: string; label: string; hint: string; run: () => void }
export interface PalettePr { repo: string; number: number; title: string }

/** Controlled command palette — the shell owns `open` (and the ⌘K shortcut + the
 *  visible trigger), so the palette is both keyboard- and pointer-openable. */
export function CommandPalette({ open, onClose, repos, onFocusRepo, prs = [], go }: {
  open: boolean; onClose: () => void; repos: readonly string[]; onFocusRepo: (repo: string) => void;
  /** Open PRs from the live feed — searchable by #number or title (#190). */
  prs?: readonly PalettePr[];
  go?: (id: SectionId) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQuery(''); setActive(0); inputRef.current?.focus(); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);

  const commands = useMemo<Command[]>(() => [
    ...SECTIONS.map((s) => ({ id: `go:${s.id}`, label: `Go to ${s.label}`, hint: s.blurb, run: () => { location.hash = hashForSection(s.id); } })),
    ...repos.map((r) => ({ id: `focus:${r}`, label: `Focus ${r}`, hint: 'focus this repo across all sections', run: () => onFocusRepo(r) })),
    // PR search (#190): jump straight to a PR by #number or title (capped so an
    // empty query doesn't flood the list).
    ...prs.slice(0, 30).map((pr) => ({
      id: `pr:${pr.repo}#${pr.number}`,
      label: `PR #${pr.number} — ${pr.title}`,
      hint: pr.repo,
      run: () => { onFocusRepo(pr.repo); go?.('pipeline'); },
    })),
  ], [repos, onFocusRepo, prs, go]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  const runAt = (i: number) => { const c = matches[i]; if (c) { c.run(); onClose(); } };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(active); }
  };

  if (!open) return null;
  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk" role="dialog" aria-label="Command palette" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={matches[active] ? `cmdk-opt-${active}` : undefined}
          aria-label="Run a command — go to a section, focus a pipeline, or open a PR"
          placeholder="Go to a section, pipeline, or PR — e.g. #1234"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul id="cmdk-list" role="listbox" aria-label="Commands">
          {matches.map((c, i) => (
            <li key={c.id} id={`cmdk-opt-${i}`} role="option" aria-selected={i === active}
              className={`cmdk-opt${i === active ? ' active' : ''}`}
              onMouseDown={() => runAt(i)}>
              <span className="cmdk-label">{c.label}</span>
              <span className="cmdk-hint">{c.hint}</span>
            </li>
          ))}
          {matches.length === 0 && <li className="cmdk-opt empty">No matches — try a section, repo, or a PR number like #1234.</li>}
        </ul>
      </div>
    </div>
  );
}
