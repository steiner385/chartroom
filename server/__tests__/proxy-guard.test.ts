import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// We need to import the module fresh each time to test env-at-call-time behavior,
// but since the module itself reads env at call time (not module scope), we can
// import it once and just set/unset env vars.
import { requireProxySecret } from '../proxy-guard';

function makeReq(path: string, authHeader?: string): Request {
  return {
    path,
    headers: authHeader ? { authorization: authHeader } : {},
    get(h: string) { return this.headers[h.toLowerCase() as keyof typeof this.headers]; },
  } as unknown as Request;
}

function makeRes(): { res: Response; statusCode: number | undefined; body: unknown; statusCalled: boolean } {
  const ctx = { res: null as unknown as Response, statusCode: undefined as number | undefined, body: undefined as unknown, statusCalled: false };
  const jsonFn = vi.fn((b: unknown) => { ctx.body = b; return ctx.res; });
  const statusFn = vi.fn((code: number) => { ctx.statusCode = code; ctx.statusCalled = true; return ctx.res; });
  ctx.res = { status: statusFn, json: jsonFn } as unknown as Response;
  return ctx;
}

describe('requireProxySecret', () => {
  const ORIG = process.env.PRDASH_PROXY_SECRET;

  afterEach(() => {
    if (ORIG !== undefined) process.env.PRDASH_PROXY_SECRET = ORIG;
    else delete process.env.PRDASH_PROXY_SECRET;
  });

  describe('env unset → standalone pass-through', () => {
    beforeEach(() => { delete process.env.PRDASH_PROXY_SECRET; });

    it('calls next() with no header check when env is unset', () => {
      const next = vi.fn();
      const { res } = makeRes();
      requireProxySecret(makeReq('/api/state'), res, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next() even with a /health path when env is unset', () => {
      const next = vi.fn();
      const { res } = makeRes();
      requireProxySecret(makeReq('/health'), res, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('env set → bearer required', () => {
    const SECRET = 'super-secret-token-abc123';

    beforeEach(() => { process.env.PRDASH_PROXY_SECRET = SECRET; });

    it('returns 401 when Authorization header is missing', () => {
      const next = vi.fn();
      const ctx = makeRes();
      requireProxySecret(makeReq('/api/state'), ctx.res, next as unknown as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.statusCode).toBe(401);
      expect(ctx.body).toMatchObject({ error: 'unauthorized' });
    });

    it('returns 401 when Authorization header has wrong token', () => {
      const next = vi.fn();
      const ctx = makeRes();
      requireProxySecret(makeReq('/api/state', 'Bearer wrong-token'), ctx.res, next as unknown as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.statusCode).toBe(401);
      expect(ctx.body).toMatchObject({ error: 'unauthorized' });
    });

    it('returns 401 when Authorization header is not Bearer scheme', () => {
      const next = vi.fn();
      const ctx = makeRes();
      requireProxySecret(makeReq('/api/state', 'Basic dXNlcjpwYXNz'), ctx.res, next as unknown as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.statusCode).toBe(401);
    });

    it('calls next() when correct bearer token is provided', () => {
      const next = vi.fn();
      const { res } = makeRes();
      requireProxySecret(makeReq('/api/state', `Bearer ${SECRET}`), res, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('exempts GET /health — always calls next() regardless of auth', () => {
      const next = vi.fn();
      const { res } = makeRes();
      requireProxySecret(makeReq('/health'), res, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('does NOT exempt /health/check or /healthz (only exact /health)', () => {
      const next = vi.fn();
      const ctx = makeRes();
      requireProxySecret(makeReq('/healthz'), ctx.res, next as unknown as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.statusCode).toBe(401);
    });

    it('reads PRDASH_PROXY_SECRET at call time (env changes after import take effect)', () => {
      const next = vi.fn();
      // correct token right now
      const { res } = makeRes();
      requireProxySecret(makeReq('/api/state', `Bearer ${SECRET}`), res, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledOnce();

      // change the secret
      process.env.PRDASH_PROXY_SECRET = 'new-secret-xyz';
      const next2 = vi.fn();
      const ctx2 = makeRes();
      // old token should now fail
      requireProxySecret(makeReq('/api/state', `Bearer ${SECRET}`), ctx2.res, next2 as unknown as NextFunction);
      expect(next2).not.toHaveBeenCalled();
      expect(ctx2.statusCode).toBe(401);
    });
  });
});
