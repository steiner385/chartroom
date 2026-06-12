import type { ClientRouter } from './client-router';
import { HttpError } from './github';

/** Shared ancestry answer contract (same as DeployWatcher.isAncestor):
 *  'missing' = a sha is unknown to GitHub → caller shows "propagating". */
export type AncestryAnswer = 'yes' | 'no' | 'missing';

/**
 * Clone-free deploy ancestry via the GitHub compare API (issue #18):
 *
 *   GET /repos/{owner}/{repo}/compare/{sha}...{deployedSha}?per_page=1
 *
 * Only the `status` field is read — 'ahead'/'identical' mean the deployed sha
 * contains the merge commit ('yes'); 'behind'/'diverged' mean it does not
 * ('no'). HTTP 404 means GitHub doesn't know one of the shas yet ('missing',
 * e.g. a merge commit still propagating). Anything else throws — the caller's
 * existing failure handling (clone fallback / cycle containment) applies.
 *
 * Requests are routed per repo owner (`router.clientFor`), so each owner's
 * installation token authenticates its own repos — same routing as GraphQL.
 */
export class ApiAncestry {
  constructor(private router: ClientRouter) {}

  async isAncestor(repo: string, sha: string, deployedSha: string): Promise<AncestryAnswer> {
    const [owner, name] = repo.split('/');
    const client = this.router.clientFor(owner ?? '');
    if (!client) throw new Error(`compare-API ancestry: owner '${owner}' has no installation`);
    let body: { status?: unknown } | null;
    try {
      // per_page=1 keeps the payload minimal — only `status` is consumed
      body = await client.restGet(`/repos/${owner}/${name}/compare/${sha}...${deployedSha}?per_page=1`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return 'missing'; // unknown sha
      throw e;
    }
    const status = body?.status;
    if (status === 'ahead' || status === 'identical') return 'yes';
    if (status === 'behind' || status === 'diverged') return 'no';
    throw new Error(`compare-API ancestry: unexpected compare status ${JSON.stringify(status)} for ${repo}`);
  }
}
