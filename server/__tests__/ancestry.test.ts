import { describe, it, expect, vi } from 'vitest';
import { ApiAncestry } from '../ancestry';
import { GithubClient, RateLimitError } from '../github';
import { ClientRouter } from '../client-router';
import { AppJwtSigner, InstallationRegistry } from '../auth';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function writePem(pem: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'prdash-ancestry-'));
  const p = join(dir, 'key.pem');
  writeFileSync(p, pem);
  return p;
}

const tokens = { get: vi.fn(async () => 'tok'), refresh: vi.fn(async () => 'tok') };
const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** Real GithubClient over a mocked fetch, wrapped in a single-client router. */
function harness(fetchFn: ReturnType<typeof vi.fn>) {
  const client = new GithubClient(tokens, fetchFn as unknown as typeof fetch);
  return new ApiAncestry(ClientRouter.forSingle(client));
}

describe('ApiAncestry', () => {
  it.each([
    ['ahead', 'yes'],
    ['identical', 'yes'],
    ['behind', 'no'],
    ['diverged', 'no'],
  ] as const)("compare status '%s' maps to '%s'", async (status, expected) => {
    const fetchFn = vi.fn(async () => jsonRes({ status }));
    expect(await harness(fetchFn).isAncestor('acme/widgets', 'sha1', 'sha2')).toBe(expected);
  });

  it("HTTP 404 (unknown sha) maps to 'missing'", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ message: 'Not Found' }, 404));
    expect(await harness(fetchFn).isAncestor('acme/widgets', 'sha1', 'sha2')).toBe('missing');
  });

  it('other HTTP errors throw (caller handles failure)', async () => {
    const fetchFn = vi.fn(async () => jsonRes({}, 500));
    await expect(harness(fetchFn).isAncestor('acme/widgets', 'sha1', 'sha2'))
      .rejects.toThrow(/HTTP 500/);
  });

  it('rate-limit responses surface as RateLimitError (not swallowed as missing)', async () => {
    const fetchFn = vi.fn(async () => jsonRes({}, 429));
    await expect(harness(fetchFn).isAncestor('acme/widgets', 'sha1', 'sha2'))
      .rejects.toThrow(RateLimitError);
  });

  it('an unexpected compare status throws', async () => {
    const fetchFn = vi.fn(async () => jsonRes({ status: 'sideways' }));
    await expect(harness(fetchFn).isAncestor('acme/widgets', 'sha1', 'sha2'))
      .rejects.toThrow(/unexpected compare status "sideways"/);
  });

  it('hits the compare endpoint with base=merge-sha, head=deployed-sha, per_page=1, and auth', async () => {
    const fetchFn = vi.fn(async () => jsonRes({ status: 'ahead' }));
    await harness(fetchFn).isAncestor('acme/widgets', 'mergeSha', 'deployedSha');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.github.com/repos/acme/widgets/compare/mergeSha...deployedSha?per_page=1');
    expect(init.headers.authorization).toBe('Bearer tok');
  });

  it('routes the request through the owner-covering installation client (App mode)', async () => {
    // registry with one installation covering 'acme'; the router mints that
    // installation's token, and the compare request must carry it
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/app/installations')) {
        return jsonRes([{ id: 7, account: { login: 'acme' } }]);
      }
      if (url.endsWith('/app/installations/7/access_tokens')) {
        return jsonRes({ token: 'inst-tok-7', expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      if (url.includes('/compare/')) return jsonRes({ status: 'identical' });
      throw new Error(`unexpected url ${url}`);
    });
    const signer = new AppJwtSigner({ appId: 1, privateKeyPath: writePem(pem) });
    const registry = new InstallationRegistry({ signer, fetchFn: fetchFn as unknown as typeof fetch });
    await registry.load();
    const router = ClientRouter.forRegistry(registry, { fetchFn: fetchFn as unknown as typeof fetch });
    const anc = new ApiAncestry(router);
    expect(await anc.isAncestor('acme/widgets', 'a', 'b')).toBe('yes');
    const compareCall = fetchFn.mock.calls.find((c) => (c as unknown as [string])[0].includes('/compare/')) as unknown as [string, { headers: Record<string, string> }];
    const init = compareCall[1];
    expect(init.headers.authorization).toBe('Bearer inst-tok-7');
  });

  it('throws when no installation covers the owner', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/app/installations')) {
        return jsonRes([{ id: 7, account: { login: 'acme' } }]);
      }
      throw new Error(`unexpected url ${url}`);
    });
    const signer = new AppJwtSigner({ appId: 1, privateKeyPath: writePem(pem) });
    const registry = new InstallationRegistry({ signer, fetchFn: fetchFn as unknown as typeof fetch });
    await registry.load();
    const anc = new ApiAncestry(ClientRouter.forRegistry(registry, { fetchFn: fetchFn as unknown as typeof fetch }));
    await expect(anc.isAncestor('unknown-owner/repo', 'a', 'b'))
      .rejects.toThrow(/owner 'unknown-owner' has no installation/);
  });
});
