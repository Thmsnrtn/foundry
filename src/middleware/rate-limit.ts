// =============================================================================
// FOUNDRY — Rate Limiting Middleware
// In-memory sliding window. Per-IP for public routes, per-founder for auth routes.
// =============================================================================

import { createMiddleware } from 'hono/factory';

import { query } from '../db/client.js';
import { log } from '../lib/logger.js';

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
 * The caller's address, as reported by something the caller cannot write.
 *
 * The default key used to be `x-forwarded-for` verbatim, whole, and first in
 * preference order. That header is APPENDED to by each hop: on Fly, which is
 * where this runs, the platform adds the real address to the end of whatever
 * the client sent. Reading the whole string therefore let a caller choose its
 * own bucket — a random value per request is a fresh counter every time and no
 * limit at all — and filled a store whose emergency eviction resets the
 * counters of everyone else in it.
 *
 * Order of trust: the platform's own header, then the CDN's, then the LAST hop
 * of X-Forwarded-For, which is the entry the nearest trusted proxy wrote. Only
 * the front of that list is attacker-controlled.
 */
export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const fly = c.req.header('fly-client-ip');
  if (fly) return fly.trim();
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
  }
  return 'unknown';
}

/**
 * Rate limiting middleware factory.
 * @param maxRequests Maximum requests per window
 * @param windowMs Window size in milliseconds
 * @param keyFn Function to extract the rate limit key from the request
 * @param namespace Distinguishes this limiter's counters from every other
 *   limiter's. Required, because omitting it is not a smaller mistake: four
 *   limiters previously shared the default IP key and therefore ONE counter, so
 *   fifty page views spent the ten-request login allowance and the 120/min API
 *   budget was really "120 minus whatever else that address did".
 */
export function rateLimit(
  maxRequests: number,
  windowMs: number,
  keyFn?: (c: any) => string,
  namespace = 'ip',
) {
  return createMiddleware(async (c, next) => {
    const key = keyFn ? keyFn(c) : `${namespace}:${clientIp(c)}`;

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

/** Standard rate limits. Each namespaced, so they count their own traffic. */
export const publicRateLimit = rateLimit(60, 60000, undefined, 'public');    // 60 req/min
export const apiRateLimit = rateLimit(120, 60000, undefined, 'api');         // 120 req/min
export const webhookRateLimit = rateLimit(300, 60000, undefined, 'webhook'); // 300 req/min
export const authRateLimit = rateLimit(10, 60000, undefined, 'auth');        // 10 req/min

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
export const aiRateLimit = sharedRateLimit(30, 60 * 60 * 1000, (c) => {
  const founder = c.get('founder' as never) as { id?: string } | undefined;
  if (founder?.id) return `ai:founder:${founder.id}`;
  return `ai:ip:${clientIp(c)}`;
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
export const apiModelRateLimit = sharedRateLimit(60, 60 * 60 * 1000, (c) => {
  const productId = c.get('productId' as never) as string | undefined;
  return `apimodel:${productId ?? 'unattributed'}`;
});

export const auditRateLimit = sharedRateLimit(6, 60 * 60 * 1000, (c) => {
  const founder = c.get('founder' as never) as { id?: string } | undefined;
  if (founder?.id) return `audit:founder:${founder.id}`;
  return `audit:ip:${clientIp(c)}`;
});

// ─── Shared counters, for the limits that guard money ────────────────────────
//
// Every limit above is a Map in ONE Node process, and fly.toml runs
// `min_machines_running = 2` behind a load balancer. So each of those limits is
// really twice what its docstring says, and more if the web group is ever
// scaled up. For flood control that is tolerable — blunting a burst twice as
// generously still blunts it. For the limits that exist to stop a bill it is
// not: those are the front stop to real money, and a ceiling multiplied by the
// machine count is not a ceiling.
//
// These count in the database instead, so every machine shares one number.

/** Increment and read the shared counter for (key, window). One statement, so
 * two machines incrementing at once cannot both read 9 and both write 10. */
async function bumpSharedCounter(
  key: string, windowMs: number, now: number,
): Promise<number | null> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  try {
    const res = await query(
      `INSERT INTO rate_limit_counters (key, window_start, window_ms, count, updated_at)
            VALUES (?, ?, ?, 1, datetime('now'))
       ON CONFLICT(key, window_start)
       DO UPDATE SET count = count + 1, updated_at = datetime('now')
         RETURNING count`,
      [key, windowStart, windowMs]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? Number(row.count) : null;
  } catch (err) {
    log.warn('rate_limit.shared_counter_failed', { key, error: (err as Error).message });
    return null;
  }
}

/**
 * A rate limit every machine agrees on.
 *
 * Falls back to the in-process limiter when the database is unreachable. That
 * is deliberately fail-OPEN relative to the shared counter and fail-CLOSED
 * relative to nothing: the caller is still limited, just per-machine, which is
 * exactly the behaviour this replaced. Refusing all traffic because a counter
 * table is unavailable would turn a bookkeeping outage into an outage.
 */
export function sharedRateLimit(
  maxRequests: number, windowMs: number, keyFn: (c: any) => string,
) {
  const fallback = rateLimit(maxRequests, windowMs, keyFn);
  return createMiddleware(async (c, next) => {
    const key = keyFn(c);
    const count = await bumpSharedCounter(key, windowMs, Date.now());
    if (count === null) return fallback(c, next);

    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));
    c.header('X-RateLimit-Reset', String(Math.ceil((windowStart + windowMs) / 1000)));
    if (count > maxRequests) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    await next();
  });
}

/** Drop counters for windows that have closed. Called by an hourly job; the
 * table is otherwise append-mostly and would grow without bound. */
export async function sweepRateLimitCounters(now: number = Date.now()): Promise<number> {
  const res = await query(
    `DELETE FROM rate_limit_counters WHERE window_start + window_ms < ?`, [now]);
  return Number(res.rowsAffected ?? 0);
}
