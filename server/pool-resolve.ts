/**
 * Ground-truth pool resolution from a GitHub Actions job's runner labels
 * (jobs-API feature). The static ci.yml parser (required-checks.ts) only sees a
 * job's `runs-on` when it's spelled inline — most KinDash jobs are
 * reusable-workflow `uses:` calls whose `runs-on` lives in the inner workflow,
 * so the parser leaves them pool='unknown'. The Jobs REST API
 * (`/runs/{runId}/jobs`) reports every job's resolved `labels[]` and
 * `runner_group_name` regardless of how the job was invoked — this helper turns
 * that into a stable pool key + a github-hosted flag.
 */

/** Generic labels that carry no pool identity — every self-hosted runner has
 *  some subset of these, so they're dropped when deriving the pool key.
 *  Compared case-insensitively. */
const GENERIC_LABELS = new Set([
  'self-hosted', 'linux', 'x64', 'arm64', 'windows', 'macos',
]);

/** A label is a GitHub-hosted runner image when it starts with one of these
 *  OS-image prefixes (ubuntu-latest, windows-2022, macos-14, …). */
const HOSTED_LABEL_RE = /^(ubuntu|windows|macos)-/i;

/** The runner_group_name GitHub reports for hosted runners. */
const HOSTED_GROUP_NAME = 'GitHub Actions';

export interface JobPoolInput {
  /** The job's resolved runner labels from the Jobs API (`labels[]`). */
  labels: string[];
  /** The job's `runner_group_name` from the Jobs API; null when absent. */
  runnerGroupName: string | null;
}

export interface JobPool {
  /** Stable pool key: meaningful labels joined with '|', or the group name
   *  fallback, or 'unknown'. Matrix-collapsed/canonical naming is applied to the
   *  CHECK name elsewhere — this is the pool dimension. */
  pool: string;
  /** True when the runner is billed by GitHub (hosted), not on the EC2 fleet
   *  bill — used to exclude these minutes from the fleet-actuals coverage join. */
  githubHosted: boolean;
}

/**
 * Resolve a job's pool key + github-hosted flag from its labels/group name.
 *
 * - githubHosted = true when any label matches the OS-image prefix
 *   (ubuntu-/windows-/macos-) OR runnerGroupName === 'GitHub Actions'.
 * - pool: drop the generic labels (self-hosted/linux/x64/arm64/windows/macos);
 *   the meaningful remainder joined with '|' is the pool key. If only generics
 *   remain, fall back to runnerGroupName. If nothing usable, 'unknown'.
 */
export function resolveJobPool({ labels, runnerGroupName }: JobPoolInput): JobPool {
  const clean = labels.map((l) => l.trim()).filter((l) => l.length > 0);
  const githubHosted = runnerGroupName === HOSTED_GROUP_NAME
    || clean.some((l) => HOSTED_LABEL_RE.test(l));

  const meaningful = clean.filter((l) => !GENERIC_LABELS.has(l.toLowerCase()));
  if (meaningful.length) return { pool: meaningful.join('|'), githubHosted };

  const group = runnerGroupName?.trim();
  if (group) return { pool: group, githubHosted };

  return { pool: 'unknown', githubHosted };
}
