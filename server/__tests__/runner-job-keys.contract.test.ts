import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { RUNNER_JOB_KEYS } from '../estimator/runner-plan';

/** Fetch the live cairnea/KinDash ci.yml (the cross-repo contract). Returns null
 *  when gh is unreachable/unauthed so the test skips rather than fails in CI. */
function ciYml(): string | null {
  try {
    const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GH_TOKEN;
    const b64 = execFileSync('gh',
      ['api', 'repos/cairnea/KinDash/contents/.github/workflows/ci.yml', '--jq', '.content'],
      { env, encoding: 'utf8' });
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch { return null; }
}

describe('RUNNER_JOB_KEYS contract with ci.yml', () => {
  it('every key ci.yml references in fromJSON(vars.RUNNER_MAP) is in RUNNER_JOB_KEYS', () => {
    const yml = ciYml();
    if (yml == null) { console.warn('skipped — gh/ci.yml unreachable'); return; }
    const used = [...yml.matchAll(/fromJSON\(vars\.RUNNER_MAP[^)]*\)\['([^']+)'\]/g)].map((m) => m[1]!);
    const known = new Set(Object.keys(RUNNER_JOB_KEYS));
    const unknown = [...new Set(used)].filter((k) => !known.has(k));
    expect(unknown, `ci.yml uses keys not in RUNNER_JOB_KEYS: ${unknown.join(', ')}`).toEqual([]);
  });
});
