// =============================================================================
// FOUNDRY — Internal API Middleware
// Validates ecosystem service key for /internal/* routes.
// Valid key grants full access. Invalid key returns 401, no info leak.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { timingSafeEqual } from 'node:crypto';

/**
 * Internal middleware. Validates the ecosystem service key.
 * All /internal/* routes except /internal/health require this.
 * Uses timing-safe comparison to prevent key enumeration via timing attacks.
 */
export const internalMiddleware = createMiddleware(async (c, next) => {
  const serviceKey = process.env.ECOSYSTEM_SERVICE_KEY;
  if (!serviceKey) {
    return c.json({ error: 'Server configuration error' }, 500);
  }

  const providedKey =
    c.req.header('X-Ecosystem-Key') ||
    c.req.header('Authorization')?.replace('Bearer ', '');

  if (!providedKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Timing-safe comparison to prevent key enumeration
  const a = Buffer.from(providedKey);
  const b = Buffer.from(serviceKey);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
});
