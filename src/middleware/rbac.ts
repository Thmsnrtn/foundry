// =============================================================================
// FOUNDRY — RBAC Enforcement Middleware
// Gates routes by permission or minimum role level.
// =============================================================================

import { createMiddleware } from 'hono/factory';

import type { MemberCapability } from '../services/team/members.js';

/**
 * WHO IS ACTING, AS A HUMAN, AND ON WHICH COMPANY.
 *
 * Both guards below read `c.get('productId')` and `c.get('userId')` — context
 * keys that ONLY the public API's key middleware sets. Every dashboard route
 * they guard therefore returned 401 to the founder who owns the company: pause,
 * resume, checkout, manage subscription, API keys, ingest credentials, share
 * links, the wisdom-network toggle. Twelve founder-facing routes, guarded into
 * unreachability by a check that was looking at the wrong surface's identity.
 *
 * The policy is "the acting user must hold this role on this company". This
 * resolves that subject once, for whichever surface the request arrived on,
 * so the two guards cannot disagree about who is asking.
 *
 * The selected-company cookie is a SELECTION, not an authorisation: it says
 * which company the user means, and the role check below decides whether they
 * may. A forged cookie therefore buys nothing — it can only name a company the
 * caller must still prove a role on.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function actingSubject(c: any): Promise<{ userId?: string; productId?: string }> {
  const { principalOf } = await import('./principal.js');
  const principal = principalOf(c);

  // A ROLE IS A PROPERTY OF A PERSON. `requireRole` and `requirePermission` ask
  // whether the acting HUMAN holds a role on this company, so only a human
  // session can answer them.
  //
  // An API key cannot: `api_keys.created_by` names the founder who minted it,
  // and reading that as the acting user would let a scoped, revocable metrics
  // credential pause the company it was issued for. An ingest credential and a
  // service principal cannot either — neither is a person, and neither has a
  // role to hold.
  //
  // Their own authority is real and checked elsewhere: `requireScope` for API
  // keys, the intake purpose check for ingest. This guard is not the place, and
  // conflating them is how a transport became an authority.
  if (!principal || principal.kind !== 'human_session') return {};

  // A ROUTE THAT NAMES A COMPANY IN ITS PATH IS NAMING THE COMPANY THE HANDLER
  // WILL SERVE. `getLayoutContext` treats that param as the highest-priority
  // override, and this read did not look at it at all — so on `/products/:id/
  // revenue` the guard asked about whichever company the cookie happened to
  // hold while the handler served `:id`. Reading it here is what makes the two
  // agree. An id the caller cannot see is passed through unchanged rather than
  // replaced by a fallback: the capability check then fails on it, which is
  // both the right answer and one that reveals nothing.
  const routeNamed = (c.req.param('productId') as string | undefined)
    ?? (typeof c.req.routePath === 'string' && c.req.routePath.includes('/products/:id')
      ? (c.req.param('id') as string | undefined)
      : undefined);

  const product = c.get('product') as { id?: string } | undefined;
  const { getCookie } = await import('hono/cookie');
  const named = principal.productId ?? product?.id ?? getCookie(c, 'foundry_product');

  // THE GUARD AND THE HANDLER MUST NAME THE SAME COMPANY.
  //
  // `getLayoutContext` resolves the acting company as: explicit override, then
  // the cookie, then THE FIRST COMPANY THIS PERSON CAN SEE — and it falls back
  // to the first when the cookie names a company they cannot see. This read
  // stopped at the cookie, so a founder whose browser had not set one yet (a
  // fresh session, a client that drops it, a direct POST) got "No company
  // selected" from the guard on a route whose handler would have worked
  // perfectly. That is a guard refusing the legitimate principal, which is not
  // extra secure.
  //
  // Falling back the same way is not a widening: the fallback only ever names
  // a company this person is already a member of, and the capability check
  // still has to pass on it. A forged cookie still buys nothing — it can only
  // name a company they must prove a permission on, or be ignored.
  const { visibleProductIds } = await import('../services/team/members.js');
  const visible = await visibleProductIds(principal.founderId);
  const productId = routeNamed
    ?? (named && visible.includes(named) ? named : visible[0]);

  return { userId: principal.founderId, productId };
}

/**
 * ONE COMPANY AUTHORIZATION MODEL, NOT TWO.
 *
 * There were two. `account_roles` held a viewer/analyst/admin/owner ladder that
 * `requireRole` read, and `assignRole` — its only writer — had no callers
 * anywhere, so no row was ever created. `getUserRole` always returned null and
 * `requireRole('admin')` reduced to the owner check inside it: seventeen
 * routes that read as "an admin may do this" were owner-only in practice, and
 * an accepted co-founder could reach none of them. `requirePermission` and its
 * eleven-permission map had no call sites at all.
 *
 * Meanwhile `team_members` — what the invite flow actually writes — carried the
 * real permissions and nothing consulted them.
 *
 * The owner's decision is that company membership is canonical and ownership is
 * a distinct, stronger property. So there are two questions and two guards:
 *
 *   requireOwner()              the exceptional boundary. Ending the
 *                               subscription, pausing the company, archiving
 *                               the product. Not a capability; nothing grants
 *                               it.
 *
 *   requireCompanyCapability()  ordinary company work, resolved through the
 *                               member's explicit permissions. The owner
 *                               passes because they hold every capability by
 *                               virtue of being the owner, not because they
 *                               sit at the top of a ladder.
 *
 * A role label — co_founder, advisor, investor_observer — is product shorthand.
 * It is what the permissions were backfilled from and what a settings page
 * shows a human. It grants nothing by itself, and no guard reads it.
 */

/** The exceptional boundary. */
export function requireOwner() {
  return createMiddleware(async (c, next) => {
    const { userId, productId } = await actingSubject(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    if (!productId) return c.json({ error: 'No company selected' }, 400);

    const { isCompanyOwner } = await import('../services/team/members.js');
    if (!(await isCompanyOwner(productId, userId))) {
      return c.json({ error: 'Only the company owner can do this' }, 403);
    }
    await next();
  });
}

/** Ordinary company work, gated on the member's explicit permission. */
export function requireCompanyCapability(capability: MemberCapability) {
  return createMiddleware(async (c, next) => {
    const { userId, productId } = await actingSubject(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    if (!productId) return c.json({ error: 'No company selected' }, 400);

    const { memberMay } = await import('../services/team/members.js');
    if (!(await memberMay(productId, userId, capability))) {
      // The same answer for "not a member" and "member without this
      // permission": telling them apart tells a stranger who is on the team.
      const acceptHeader = c.req.header('Accept') ?? '';
      if (acceptHeader.includes('text/html')) {
        return c.html(
          '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;'
          + 'margin:100px auto;text-align:center;">'
          + '<h2>Not available to you</h2>'
          + '<p>Your access to this company does not include this.</p>'
          + '<a href="/dashboard">&#8592; Back to Dashboard</a></body></html>', 403);
      }
      return c.json({ error: 'Not permitted for your access to this company' }, 403);
    }
    await next();
  });
}
