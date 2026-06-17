// server/pipeline-model/derived/assemble.ts
//
// Limits (v1): the matrix is driven by STATIC check names — an observed
// (name, event) that matches no CheckNode produces no cell, so a check that
// CI runs but the parser never modeled is invisible here (not flagged as
// drift). Reconciling observed-only checks into 'observed-only' cells is a
// follow-up.
import type { StaticGraph, GatingResult, CheckNode } from '../types';
import { KINDASH_TIERS, type TierDef } from './tiers';
import { observedKey, type ObservedCell } from './observed';
import { cellState, type Cell, type CellIntent } from './cell';
import { deriveDrift, type DriftConfig, DRIFT_DEFAULTS } from './drift';

export interface DerivedModel {
  tiers: TierDef[];
  checks: string[];
  cells: Cell[];
}

export function assembleDerivedModel(
  graph: StaticGraph, gating: GatingResult, observed: Map<string, ObservedCell>,
  tiers: TierDef[] = KINDASH_TIERS,
  cfg: DriftConfig = DRIFT_DEFAULTS,
): DerivedModel {
  // Index static checks by checkName (a name may have multiple CheckNodes only
  // via distinct provenance; they share triggers/confidence per our model).
  const byCheck = new Map<string, CheckNode[]>();
  for (const c of graph.checks) {
    const arr = byCheck.get(c.checkName) ?? [];
    arr.push(c);
    byCheck.set(c.checkName, arr);
  }
  // gating lookup: checkName → set of events it gates at (union across all
  // gating entries for the same checkName, so duplicate names don't drop
  // earlier events).
  const gatesAt = new Map<string, Set<string>>();
  for (const g of gating.gates) {
    const existing = gatesAt.get(g.checkName);
    if (existing) {
      for (const e of g.events) existing.add(e);
    } else {
      gatesAt.set(g.checkName, new Set(g.events));
    }
  }
  const conditionalCallers = new Set(gating.conditionalCallerJobs);

  const checks = [...byCheck.keys()].sort();

  // For checkRunsElsewhere: a check is "active" if it has an observed cell
  // with runs >= cfg.minRuns at ANY tier, so a single stray run does not
  // over-flag configured-but-unobserved drift (direction-1).
  const activeChecks = new Set<string>();
  for (const check of checks) {
    if (tiers.some((t) => (observed.get(observedKey(check, t.event))?.runs ?? 0) >= cfg.minRuns)) {
      activeChecks.add(check);
    }
  }

  const cells: Cell[] = [];
  for (const check of checks) {
    const nodes = byCheck.get(check)!;
    const runsElsewhere = activeChecks.has(check);
    for (const tier of tiers) {
      const node = nodes.find((n) => n.triggers.events.some((e) => e.kind === tier.event));
      const runs = node != null;
      const gates = (gatesAt.get(check)?.has(tier.event)) ?? false;
      const conditional = runs && (node!.confidence === 'low' || conditionalCallers.has(node!.callerJobId));
      const intent: CellIntent = { runs, gates: runs && gates, conditional };
      const obs = observed.get(observedKey(check, tier.event)) ?? null;
      cells.push({
        check, tierId: tier.id, intent, observed: obs,
        drift: deriveDrift(intent, obs, runsElsewhere, cfg),
        state: cellState(intent),
      });
    }
  }
  return { tiers, checks, cells };
}
