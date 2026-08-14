// =============================================================================
// FOUNDRY — Clerk Authentication Middleware
// Validates Clerk session and resolves founder from database.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { Clerk as ClerkBackend, verifyToken, type VerifyTokenOptions } from '@clerk/backend';
import { getFounderByClerkId, query } from '../db/client.js';
import { nanoid } from 'nanoid';
import type { Founder, FounderPreferences } from '../types/index.js';
import type { FounderRow } from '../types/database.js';
import { logger } from '../services/logger.js';

export interface AuthEnv {
  Variables: {
    founder: Founder;
  };
}

/**
 * Authentication middleware. Validates Clerk JWT from cookie or Authorization header.
 * Resolves the founder record from the database.
 * All dashboard and API routes must use this middleware.
 */
/** Return true if the request looks like a browser navigation (accepts HTML). */
function isBrowserRequest(acceptHeader: string | undefined): boolean {
  return !!acceptHeader && acceptHeader.includes('text/html');
}

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return c.json({ error: 'Server configuration error' }, 500);
  }

  const accept = c.req.header('Accept');

  // Extract token from Authorization header or __session cookie
  let token: string | null = null;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // Try cookie
    const cookie = c.req.header('Cookie');
    if (cookie) {
      const sessionCookie = cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('__session='));
      if (sessionCookie) {
        token = sessionCookie.split('=')[1] ?? null;
      }
    }
  }

  if (!token) {
    if (isBrowserRequest(accept)) {
      return c.redirect('/auth/login');
    }
    return c.json({ error: 'Authentication required' }, 401);
  }

  try {
    const payload = await verifyToken(token, {
      secretKey,
      issuer: (iss: string) => iss.includes('clerk'),
    } satisfies VerifyTokenOptions);

    const clerkUserId = payload.sub;
    if (!clerkUserId) {
      if (isBrowserRequest(accept)) {
        return c.redirect('/auth/login');
      }
      return c.json({ error: 'Invalid session' }, 401);
    }

    // Resolve founder from database
    let result = await getFounderByClerkId(clerkUserId);

    // Auto-provision founder if the webhook hasn't fired yet
    // This handles the race condition where the user logs in before the Clerk webhook arrives
    if (result.rows.length === 0) {
      try {
        const clerk = ClerkBackend({ secretKey });
        const user = await clerk.users.getUser(clerkUserId);
        const email = user.emailAddresses?.[0]?.emailAddress ?? '';
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
        const founderId = nanoid();

        // Wave 3 — referral attribution. The __foundry_ref cookie was set
        // when the visitor arrived via ?ref=<code>. Capture it on the
        // founder row so the 'paid' conversion event later resolves
        // without the cookie (Stripe webhook arrives without browser
        // context).
        const cookieHeader = c.req.header('cookie') ?? '';
        const refMatch = cookieHeader.match(/(?:^|;\s*)__foundry_ref=([\w-]{4,32})/);
        const referredByCode = refMatch ? refMatch[1] : null;

        await query(
          `INSERT INTO founders (id, clerk_user_id, email, name, referred_by_code)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (clerk_user_id) DO NOTHING`,
          [founderId, clerkUserId, email, name, referredByCode]
        );

        // Fire signup conversion event when the row was created via this
        // path (a no-op when the ON CONFLICT branch took the INSERT).
        if (referredByCode) {
          try {
            const { recordReferralEvent } = await import(
              '../services/distribution/referrals.js'
            );
            await recordReferralEvent(referredByCode, 'signup', {
              invited_founder_id: founderId,
            });
          } catch { /* attribution failure is non-fatal */ }
        }

        result = await getFounderByClerkId(clerkUserId);

        // Welcome email on provisioning (idempotent via the gateway, so this
        // never double-sends with the Clerk webhook path). Use the resolved
        // row's real id for a stable dedup key. Fire-and-forget.
        const provisioned = result.rows[0] as Record<string, unknown> | undefined;
        if (provisioned?.id && provisioned?.email) {
          void (async () => {
            try {
              const { sendFounderWelcome } = await import('../services/founder/welcome-sequence.js');
              await sendFounderWelcome({
                id: String(provisioned.id),
                email: String(provisioned.email),
                name: (provisioned.name as string | null) ?? null,
                created_at: String(provisioned.created_at ?? new Date().toISOString()),
              });
            } catch { /* non-fatal; cron will retry */ }
          })();
        }
      } catch (e) {
        logger.error('Auto-provision founder failed', { error: String(e) });
      }
    }

    if (result.rows.length === 0) {
      if (isBrowserRequest(accept)) {
        return c.redirect('/auth/login');
      }
      return c.json({ error: 'Founder not found' }, 401);
    }

    const row = result.rows[0] as unknown as FounderRow;
    const founder: Founder = {
      id: row.id,
      clerk_user_id: row.clerk_user_id,
      email: row.email,
      name: row.name,
      stripe_customer_id: row.stripe_customer_id,
      tier: row.tier as Founder['tier'],
      cohort_id: row.cohort_id,
      created_at: row.created_at,
      preferences: row.preferences ? (JSON.parse(row.preferences) as FounderPreferences) : null,
      lifestyle_mode: (row.lifestyle_mode ?? 0) === 1,
      lifestyle_target_mrr: row.lifestyle_target_mrr ?? null,
      trial_ends_at: (row as unknown as Record<string, unknown>).trial_ends_at as string | null ?? null,
    };

    c.set('founder', founder);

    // Update last_seen_at (fire-and-forget)
    query('UPDATE founders SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [founder.id]).catch((err) => { logger.error(`last_seen_at update failed: ${err}`); });

    await next();
  } catch {
    if (isBrowserRequest(accept)) {
      return c.redirect('/auth/login');
    }
    return c.json({ error: 'Invalid or expired session' }, 401);
  }
});

/**
 * Browser/session API boundary.
 *
 * REST API v1 owns its machine authentication inside `apiV1`. Letting the
 * blanket Clerk middleware consume its bearer token first makes valid API keys
 * unusable and also hides the intentionally public v1 health endpoint.
 */
export const sessionAuthForApiRoutes = createMiddleware<AuthEnv>(async (c, next) => {
  const path = c.req.path;
  if (path === '/api/v1' || path.startsWith('/api/v1/')) {
    return next();
  }
  return authMiddleware(c, next);
});
