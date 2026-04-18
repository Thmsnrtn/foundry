// =============================================================================
// FOUNDRY — Rate Limiting Middleware
// In-memory sliding window. Per-IP for public routes, per-founder for auth routes.
// =============================================================================

import { createMiddleware } from 'hono/factory';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 10000; // DEFECT-0046: Prevent unbounded memory growth

// Clean up expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
  // Emergency eviction if store grows too large (DDoS protection)
  if (store.size > MAX_STORE_SIZE) {
    const entries = Array.from(store.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < entries.length / 2; i++) store.delete(entries[i]![0]);
  }
}, 60000);

/**
 * Rate limiting middleware factory.
 * @param maxRequests Maximum requests per window
 * @param windowMs Window size in milliseconds
 * @param keyFn Function to extract the rate limit key from the request
 */
export function rateLimit(maxRequests: number, windowMs: number, keyFn?: (c: any) => string) {
  return createMiddleware(async (c, next) => {
    const key = keyFn
      ? keyFn(c)
      : c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown';

    const now = Date.now();
    let entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    await next();
  });
}

/** Standard rate limits */
export const publicRateLimit = rateLimit(60, 60000);   // 60 req/min for public routes
export const apiRateLimit = rateLimit(120, 60000);      // 120 req/min for authenticated API
export const webhookRateLimit = rateLimit(300, 60000);  // 300 req/min for webhooks
export const authRateLimit = rateLimit(10, 60000);      // 10 req/min for auth endpoints
