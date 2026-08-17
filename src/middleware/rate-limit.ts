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

/**
 * AI rate limit — 30 requests / hour per founder. Front-stop to the
 * AI client's per-product daily cost ceiling (which is a backstop): a
 * confused founder hammering an "Ask AI" button is bounded to one call
 * every two minutes on average, plenty for real interaction. The cost
 * ceiling still catches a coordinated abuse case where the per-user
 * limit is bypassed.
 *
 * Keys on the founder id when authenticated, falls back to IP for
 * pre-auth paths so an unauthenticated burst can't drain quota.
 */
export const aiRateLimit = rateLimit(30, 60 * 60 * 1000, (c) => {
  const founder = c.get('founder' as never) as { id?: string } | undefined;
  if (founder?.id) return `ai:founder:${founder.id}`;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown';
  return `ai:ip:${ip}`;
});

/**
 * Audit rate limit — the onboarding audit is the single most expensive
 * operation (a full repo scrape + multi-call Opus scoring, minutes long and
 * real dollars each). 6/hour per founder is far more than any legitimate use
 * (you audit a product once, occasionally re-run) while stopping a stranger
 * from cost-bombing us by hammering run-audit. Keys on founder id, IP fallback.
 */
/**
 * The public API, limited by the CREDENTIAL rather than by the source address.
 *
 * `/api/*` already carries an IP-keyed flood guard, and that is the right shape
 * for an unauthenticated request. It is the wrong shape once a request carries
 * a credential: a single key rotating source addresses was unlimited, while
 * many customers behind one NAT shared a single budget. The limit that matters
 * on an authenticated surface is per key, and it belongs after authentication —
 * which is why it is applied inside the v1 router rather than beside the flood
 * guard in the composition root.
 *
 * The AI and audit limits have always keyed by founder. This is the same rule
 * reaching the surface the owner has just made live.
 */
export const apiKeyRateLimit = rateLimit(600, 60 * 60 * 1000, (c) => {
  const productId = c.get('productId' as never) as string | undefined;
  const userId = c.get('userId' as never) as string | undefined;
  if (productId) return `apikey:product:${productId}`;
  if (userId) return `apikey:user:${userId}`;
  // Unreachable behind apiKeyAuth, and fail-closed rather than unlimited if it
  // ever is: an unattributable request shares one bucket with every other.
  return 'apikey:unattributed';
});

/**
 * A tighter budget for the calls that spend money.
 *
 * The MCP transport reaches tools that call a model — `foundry_red_team` runs
 * Sonnet. Under the ordinary API allowance those were 600 model calls an hour
 * per key, guarded only by the global AI spend ceiling, which is a blunt
 * instrument that stops everyone at once when one caller is expensive.
 */
export const apiModelRateLimit = rateLimit(60, 60 * 60 * 1000, (c) => {
  const productId = c.get('productId' as never) as string | undefined;
  return `apimodel:${productId ?? 'unattributed'}`;
});

export const auditRateLimit = rateLimit(6, 60 * 60 * 1000, (c) => {
  const founder = c.get('founder' as never) as { id?: string } | undefined;
  if (founder?.id) return `audit:founder:${founder.id}`;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown';
  return `audit:ip:${ip}`;
});
