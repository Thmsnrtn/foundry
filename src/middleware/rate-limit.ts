// =============================================================================
// FOUNDRY — Rate Limiting Middleware
// In-memory sliding window rate limiter. Swap for Redis-backed in multi-instance.
// =============================================================================

import { createMiddleware } from 'hono/factory';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** Maximum requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key extractor — determines what to rate limit by */
  keyFn?: (c: any) => string;
  /** Message returned when rate limited */
  message?: string;
}

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup of expired entries (every 60 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 60_000);

/**
 * Create a rate limiting middleware with the given configuration.
 */
export function rateLimit(config: RateLimitConfig) {
  const { max, windowMs, message = 'Too many requests, please try again later' } = config;
  const keyFn = config.keyFn ?? defaultKeyFn;

  return createMiddleware(async (c, next) => {
    const key = keyFn(c);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, max - entry.count);
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json({ error: message }, 429);
    }

    await next();
  });
}

function defaultKeyFn(c: any): string {
  // Use founder ID if authenticated, otherwise IP
  const founder = c.get?.('founder');
  if (founder?.id) return `founder:${founder.id}`;

  const forwarded = c.req.header('X-Forwarded-For');
  const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';
  return `ip:${ip}`;
}

// ─── Preset Configurations ─────────────────────────────────────────────────

/** General API rate limit: 100 requests per minute */
export const apiRateLimit = rateLimit({
  max: 100,
  windowMs: 60_000,
});

/** Strict rate limit for auth endpoints: 10 requests per minute per IP */
export const authRateLimit = rateLimit({
  max: 10,
  windowMs: 60_000,
  keyFn: (c) => {
    const forwarded = c.req.header('X-Forwarded-For');
    const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';
    return `auth:${ip}`;
  },
});

/** Webhook rate limit: 50 requests per minute per IP (generous for retries) */
export const webhookRateLimit = rateLimit({
  max: 50,
  windowMs: 60_000,
  keyFn: (c) => {
    const forwarded = c.req.header('X-Forwarded-For');
    const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';
    return `webhook:${ip}`;
  },
});
