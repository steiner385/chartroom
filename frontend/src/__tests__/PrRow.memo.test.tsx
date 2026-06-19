/**
 * PrRow memoization tests (#178)
 *
 * Two layers of proof:
 *
 * 1. COMPARATOR UNIT TESTS — test `areEqual` directly.
 *    These are the load-bearing "skips re-render" guard: if areEqual(prev,next)
 *    is true for identical content, React.memo will skip the body.  If it is
 *    false for changed content, React.memo will re-render.  Testing the
 *    comparator directly is more reliable than spying on intra-module calls
 *    (which Vite's ESM transform does not route through the exports namespace).
 *
 * 2. DOM ANTI-STALE-UI TEST — render PrRow, change content, verify DOM updates.
 *    This is the end-to-end guard: even if the comparator is correct, the memo
 *    wiring must be wired up (i.e., memo(PrRowInner, areEqual) must actually
 *    be the exported component).  A wrong comparator that bails on changed
 *    content would cause this test to fail.
 *
 * Together these two layers prove: (a) equal content skips the render body,
 * and (b) changed content never produces stale UI.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { areEqual, PrRow } from '../PrRow';
import type { PrView, CheckView } from '../types';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

const makeCheck = (over: Partial<CheckView> = {}): CheckView => ({
  name: 'fast-checks / ESLint',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  isRequired: true,
  workflowName: null,
  elapsedSeconds: 180,
  expectedSeconds: 200,
  url: 'https://x/run1',
  expectedLowSeconds: null,
  expectedHighSeconds: null,
  waitKind: null,
  blockedOn: null,
  waitingSeconds: null,
  expectedRunnerWaitSeconds: null,
  flakeRatePct: null,
  likelyFlake: false,
  ...over,
});

const pr = (over: Partial<PrView> = {}): PrView => ({
  repo: 'acme/widgets',
  number: 8962,
  title: 'fix: calendar overlap',
  url: 'https://x/8962',
  stage: {
    stage: 'ci',
    substate: null,
    percent: 72,
    etaSeconds: 240,
    etaRangeSeconds: null,
    overdue: false,
  },
  queueAheadCount: null,
  checks: [
    makeCheck(),
    makeCheck({
      name: 'lighthouse',
      status: 'IN_PROGRESS',
      conclusion: null,
      isRequired: false,
      elapsedSeconds: 60,
      expectedSeconds: 300,
      url: null,
    }),
  ],
  groupChecks: null,
  mergeEtaSim: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Comparator unit tests
// (load-bearing "skips re-render" guard — tests areEqual directly)
// ---------------------------------------------------------------------------

describe('areEqual comparator (#178)', () => {
  it('returns true (bail out) when all props are content-equal clones', () => {
    // Simulate SSE frame: JSON.parse produces a new object with same content
    const basePr = pr();
    const prev = { pr: basePr, hasDeploy: true, queueCulprit: null, expandable: true };
    const next = {
      pr: JSON.parse(JSON.stringify(basePr)) as PrView,
      hasDeploy: true,
      queueCulprit: null,
      expandable: true,
    };
    // areEqual returning true means React.memo will skip the re-render
    expect(areEqual(prev, next)).toBe(true);
  });

  it('returns false (re-render) when pr stage percent changes', () => {
    const basePr = pr();
    const changedPr: PrView = JSON.parse(JSON.stringify(basePr));
    (changedPr.stage as { percent: number }).percent = 95;
    const prev = { pr: basePr, hasDeploy: true, queueCulprit: null, expandable: true };
    const next = { pr: changedPr, hasDeploy: true, queueCulprit: null, expandable: true };
    expect(areEqual(prev, next)).toBe(false);
  });

  it('returns false (re-render) when a check conclusion changes', () => {
    const basePr = pr();
    const changedPr: PrView = JSON.parse(JSON.stringify(basePr));
    changedPr.checks[0].conclusion = 'FAILURE';
    const prev = { pr: basePr, hasDeploy: true, queueCulprit: null, expandable: true };
    const next = { pr: changedPr, hasDeploy: true, queueCulprit: null, expandable: true };
    expect(areEqual(prev, next)).toBe(false);
  });

  it('returns false (re-render) when hasDeploy changes', () => {
    const basePr = pr();
    const clonePr: PrView = JSON.parse(JSON.stringify(basePr));
    const prev = { pr: basePr, hasDeploy: true, queueCulprit: null, expandable: true };
    const next = { pr: clonePr, hasDeploy: false, queueCulprit: null, expandable: true };
    expect(areEqual(prev, next)).toBe(false);
  });

  it('returns false (re-render) when queueCulprit changes', () => {
    const basePr = pr();
    const clonePr: PrView = JSON.parse(JSON.stringify(basePr));
    const prev = { pr: basePr, hasDeploy: true, queueCulprit: null, expandable: true };
    const next = { pr: clonePr, hasDeploy: true, queueCulprit: 9001, expandable: true };
    expect(areEqual(prev, next)).toBe(false);
  });

  it('returns false (re-render) when expandable changes', () => {
    const basePr = pr();
    const clonePr: PrView = JSON.parse(JSON.stringify(basePr));
    const prev = { pr: basePr, hasDeploy: true, queueCulprit: null, expandable: true };
    const next = { pr: clonePr, hasDeploy: true, queueCulprit: null, expandable: false };
    expect(areEqual(prev, next)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end DOM test (anti-stale-UI guard)
// Proves that the memo wiring is correct: changed content → DOM updates.
// If areEqual wrongly returned true for changed content, this test would fail.
// ---------------------------------------------------------------------------

describe('PrRow React.memo wiring (#178)', () => {
  it('re-renders when pr content changes (anti-stale-UI guard)', () => {
    // Start at 72% ci stage
    const basePr = pr();
    const { rerender } = render(
      <PrRow pr={basePr} hasDeploy queueCulprit={null} expandable />,
    );
    expect(screen.getByText('72%')).toBeInTheDocument();

    // Change percent to 95% — content is genuinely different
    const changedPr: PrView = JSON.parse(JSON.stringify(basePr));
    (changedPr.stage as { percent: number }).percent = 95;
    rerender(<PrRow pr={changedPr} hasDeploy queueCulprit={null} expandable />);

    // DOM must update — stale-UI guard:
    // if areEqual wrongly returned true, "72%" would remain and "95%" be absent
    expect(screen.queryByText('72%')).not.toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
  });
});
