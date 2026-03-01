// =============================================================================
// FOUNDRY — Clerk Authentication Middleware
// Validates Clerk session and resolves founder from database.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { Clerk as ClerkBackend, verifyToken } from '@clerk/backend';
import { getFounderByClerkId, query } from '../db/client.js';
import { nanoid } from 'nanoid';
import type { Founder, FounderPreferences } from '../types/index.js';
import type { FounderRow } from '../types/database.js';

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
    } as any);

    const clerkUserId = payload.sub;
    if (!clerkUserId) {
      if (isBrowserRequest(accept)) {
        return c.redirect('/auth/login');
      }
      return c.json({ error: 'Invalid session' }, 401);
    }

    // Resolve founder from database
    let result = await getFounderByClerkId(clerkUserId);

    // Auto-provision founder if the webhook hasn't fired yet (common in local dev)
    if (result.rows.length === 0) {
      try {
        const clerk = ClerkBackend({ secretKey });
        const user = await clerk.users.getUser(clerkUserId);
        const email = user.emailAddresses?.[0]?.emailAddress ?? '';
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
        const founderId = nanoid();

        await query(
          `INSERT INTO founders (id, clerk_user_id, email, name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (clerk_user_id) DO NOTHING`,
          [founderId, clerkUserId, email, name]
        );

        result = await getFounderByClerkId(clerkUserId);
      } catch (e) {
        console.error('Auto-provision founder failed:', e);
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
    };

    c.set('founder', founder);

    // Update last_seen_at (fire-and-forget)
    query('UPDATE founders SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [founder.id]).catch(() => {});

    await next();
  } catch {
    if (isBrowserRequest(accept)) {
      return c.redirect('/auth/login');
    }
    return c.json({ error: 'Invalid or expired session' }, 401);
  }
});
