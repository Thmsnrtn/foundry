// =============================================================================
// FOUNDRY — the public API asks whether Foundry may act for this company
//
// The API authenticated the credential, checked its scopes and limited its
// rate, and then never asked the question every other surface asks: is this a
// company Foundry is currently operating?
//
// The owner's decision is that an unpaid account is READ-ONLY — no spend, no
// outward effects — and the deepest layers do hold that line: the AI client
// refuses to reserve spend for a company that is not operating, and the
// outbound gateway refuses to dispatch. So an agent run through the API failed
// somewhere in the middle rather than succeeding.
//
// But writes are not spend and not outward effects. `POST /v1/customers`,
// `PUT /v1/customers/:id/health`, `POST /v1/metrics/snapshots`,
// `POST /v1/experiments` all write company state, and every one of them worked
// for a company whose subscription had lapsed or whose founder had paused it.
// Read-only was true of two layers and not of the surface.
//
// WHY THE METHOD DECIDES. This is the one place where the owner decision maps
// cleanly onto a mechanical property: a GET is the read the decision permits,
// and anything else changes the company. Enumerating routes instead would mean
// a list that a new endpoint can be added beside without joining.
//
// ARCHIVED IS NOT PAUSED. A company whose data was erased has no keys left —
// `api_keys` carries a `product_id` and goes with the erasure — so that case
// is closed by deletion rather than by this. The check still names it, because
// depending on a key being gone is depending on something two files away.
// =============================================================================

import { createMiddleware } from 'hono/factory';

import type { ApiAuthEnv } from './auth.js';
import { operatingProduct, query } from '../../db/client.js';

/**
 * Refuse a state-changing request for a company Foundry is not operating.
 *
 * Reads are deliberately allowed: the owner's decision is that an unpaid
 * account can still see its own data. Refusing those would turn a billing
 * lapse into a data lockout, which is not what was asked for.
 */
export const requireOperatingForWrites = createMiddleware<ApiAuthEnv>(async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    return next();
  }

  const productId = c.get('productId');
  // No company on the request is a different failure, and auth has already
  // decided about it. Saying nothing here keeps one answer per question.
  if (!productId) return next();

  // The canonical predicate, not a hand-copied piece of it. It has grown an
  // axis twice, and both times every copy stopped seeing the case it was
  // written for.
  const res = await query(
    `SELECT CASE WHEN ${operatingProduct()} THEN 1 ELSE 0 END AS operating,
            COALESCE(status,'active') AS status,
            COALESCE(scp_status,'active') AS scp_status,
            entitlement_paused_at
       FROM products WHERE id = ?`, [productId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;

  // An id naming no company is not this middleware's question either — the
  // key resolved it, and inventing a refusal here would hide that.
  if (!row) return next();
  if (Number(row.operating) === 1) return next();

  const reason = String(row.status) !== 'active'
    ? 'this company has been archived'
    : row.entitlement_paused_at != null
      ? 'this company\'s subscription is not active'
      : 'this company is paused';

  return c.json({
    error: 'read_only',
    message: `Foundry is not currently acting for this company — ${reason}. `
      + 'Reads still work; anything that changes the company does not.',
  }, 403);
});
