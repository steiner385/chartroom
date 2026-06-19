import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Shared-secret proxy guard for hosted (Railway) deployments.
 *
 * Reads PRDASH_PROXY_SECRET at call time (not module scope), so:
 *  - Unset/empty → pass-through next() (standalone/local behavior unchanged).
 *  - Set → require `Authorization: Bearer <secret>`; compare with
 *    timingSafeEqual. Mismatch or missing header → 401.
 *
 * GET /health is always exempted (health checks must never be auth-gated).
 *
 * Wire in server/index.ts BEFORE API routes.
 */
export function requireProxySecret(req: Request, res: Response, next: NextFunction): void {
  // Always exempt /health (exact path).
  if (req.path === '/health') {
    next();
    return;
  }

  const secret = process.env.PRDASH_PROXY_SECRET;
  // Standalone / local: no secret configured → pass through.
  if (!secret) {
    next();
    return;
  }

  const authHeader = req.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const provided = authHeader.slice(prefix.length);
  // Guard equal-length first to avoid timingSafeEqual throw on mismatched buffers.
  const secretBuf = Buffer.from(secret, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (secretBuf.length !== providedBuf.length || !timingSafeEqual(secretBuf, providedBuf)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}
