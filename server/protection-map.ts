/**
 * Protection-map provider: derive the CI/CD Designer's DerivedModel for a repo.
 *
 * Fetches the repo's `ci.yml` + its reusable `_*.yml` workflows (via the injected
 * `fetchWorkflow`), runs the keystone parser + gating closure, and reconciles
 * with observed history into the check × tier matrix. `fetchWorkflow` is the only
 * I/O — injected so this stays unit-testable; index.ts wires it to the per-owner
 * GithubClient.
 */
import { deriveStaticGraph, gatingClosure } from './pipeline-model';
import { derivedModelForRepo, type DerivedModel } from './pipeline-model/derived';
import type { SuccessStat, FlakeStat } from './history';

export interface ProtectionMapDeps {
  /** Returns the raw YAML of `.github/workflows/<name>` for `repo`, or null. */
  fetchWorkflow: (repo: string, name: string) => Promise<string | null>;
  successStatsByRepo: (since: string) => Map<string, SuccessStat[]>;
  flakeStatsByRepo: (since: string) => Map<string, FlakeStat[]>;
  /** Caller jobs that gate conditionally (skipped == pass) — KinDash:
   *  pr-affected-tests, integration-tests. */
  conditionalCallerJobs?: string[];
}

/** The reusable `_*.yml` workflow basenames a rollup `ci.yml` calls via `uses:`. */
export function reusableRefs(ci: string): string[] {
  return [...new Set(
    [...ci.matchAll(/uses:\s*\.\/\.github\/workflows\/(_[a-z0-9-]+\.yml)/gi)].map((m) => m[1]!),
  )];
}

/** Build the DerivedModel for `repo`, or null when `ci.yml` can't be fetched. */
export async function computeProtectionMap(
  repo: string, since: string, deps: ProtectionMapDeps,
): Promise<DerivedModel | null> {
  const ci = await deps.fetchWorkflow(repo, 'ci.yml');
  if (ci == null) return null;
  const files: Record<string, string> = { 'ci.yml': ci };
  for (const ref of reusableRefs(ci)) {
    const text = await deps.fetchWorkflow(repo, ref);
    if (text) files[ref] = text;
  }
  const graph = deriveStaticGraph(files);
  const gating = gatingClosure(graph, 'ci', { conditionalCallerJobs: deps.conditionalCallerJobs ?? [] });
  return derivedModelForRepo({
    repo, since, graph, gating,
    successStatsByRepo: deps.successStatsByRepo,
    flakeStatsByRepo: deps.flakeStatsByRepo,
  });
}
