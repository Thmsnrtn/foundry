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
 * Is this company one Foundry may act for? Answered once, for both callers.
 *
 * Exported so the MCP transport can ask the same question per tool that this
 * middleware asks per method — one predicate, two ways of deciding what counts
 * as a write, rather than two predicates that can disagree.
 */
export async function companyMayBeChanged(
  productId: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  // `operating_ignoring_erasure` is the same predicate without the third axis.
  // Spelled out rather than composed, because the whole point is that this one
  // question deliberately differs from the canonical one — hiding that behind a
  // shared builder is how the difference stops being visible.
  const res = await query(
    `SELECT CASE WHEN ${operatingProduct()} THEN 1 ELSE 0 END AS operating,
            COALESCE(status,'active') AS status,
            entitlement_paused_at,
            erasure_scheduled_at,
            CASE WHEN status = 'active'
                   AND COALESCE(scp_status,'active') NOT IN ('paused','archived')
                   AND entitlement_paused_at IS NULL
                 THEN 1 ELSE 0 END AS operating_ignoring_erasure
       FROM products WHERE id = ?`, [productId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  // An id naming no company is not this question — the credential resolved it,
  // and inventing a refusal here would hide that.
  if (!row || Number(row.operating) === 1) return { allowed: true };

  // A SCHEDULED ERASURE STOPS FOUNDRY ACTING; IT DOES NOT LOCK THE FOUNDER OUT
  // OF THEIR OWN ACCOUNT. `operatingProduct()` answers "may Foundry act on its
  // own for this company", and a deletion on its way is a no. This middleware
  // answers something narrower — "may this company still be written to" — and
  // the thirty-day window exists precisely so the founder can change their
  // mind. Refusing their writes for a month would be a punishment for clicking
  // a button that is still reversible.
  if (row.erasure_scheduled_at != null && Number(row.operating_ignoring_erasure) === 1) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: String(row.status) !== 'active'
      ? 'this company has been archived'
      : row.entitlement_paused_at != null
        ? "this company's subscription is not active"
        : 'this company is paused',
  };
}

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
  // MCP IS ONE POST CARRYING TWENTY CONSEQUENCES, so the method says nothing
  // about it: `tools/call` reads and writes through the same route, and
  // refusing all of it would refuse the reads the owner decision permits. It
  // asks per tool instead, using the same read/write vocabulary its scope
  // check already uses — see `scopeForTool` in api/v1/mcp.ts.
  if (c.req.path.includes('/mcp')) return next();

  const productId = c.get('productId');
  // No company on the request is a different failure, and auth has already
  // decided about it. Saying nothing here keeps one answer per question.
  if (!productId) return next();

  const verdict = await companyMayBeChanged(productId);
  if (verdict.allowed) return next();

  return c.json({
    error: 'read_only',
    message: `Foundry is not currently acting for this company — ${verdict.reason}. `
      + 'Reads still work; anything that changes the company does not.',
  }, 403);
});
