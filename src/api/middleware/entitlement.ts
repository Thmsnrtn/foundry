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
export type ChangeVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; axis: 'archived' | 'entitlement' | 'paused' | 'erasure' };

export async function companyMayBeChanged(productId: string): Promise<ChangeVerdict> {
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

  // A SCHEDULED ERASURE IS ITS OWN AXIS, AND IT SAYS SO.
  //
  // This used to return `allowed: true` for the whole write surface whenever
  // the only thing stopping the company was a pending erasure, on the grounds
  // that the thirty-day window exists so the founder can change their mind and
  // refusing their writes for a month would punish a reversible click.
  //
  // The reasoning was sound and the exemption did not serve it. THE WRITE THAT
  // CHANGES THEIR MIND IS `POST /privacy/delete/cancel` ON THE DASHBOARD, which
  // is behind `requireOwner()` and never passes through here. What this
  // exemption actually permitted was every route it does guard: creating
  // customers, recording metrics, opening experiments, running agents, and —
  // through the voice-reply webhook — APPROVING AN ACTION FOR EXECUTION. New
  // third-party personal data flowing into a company scheduled for deletion,
  // and outward effects dispatched on its behalf. An identity ("this is still
  // their account") had been allowed to stand in for a purpose ("this write
  // completes or reverses the erasure").
  //
  // So the axis is REPORTED rather than waived. Callers know their own request
  // and decide against it: the middleware permits the reductions below and
  // nothing else, and anything new defaults to refused, which is the direction
  // that is safe to be wrong in.
  //
  // Kept as a distinct axis, not folded into 'paused': a founder who scheduled
  // an erasure, a founder who paused the company, and a lapsed subscription are
  // three different facts, and a caller that needs to tell them apart — to say
  // something true to the person reading the error — cannot do it from one
  // collapsed status.
  if (row.erasure_scheduled_at != null && Number(row.operating_ignoring_erasure) === 1) {
    return {
      allowed: false,
      axis: 'erasure',
      reason: 'this company is scheduled for erasure',
    };
  }
  return String(row.status) !== 'active'
    ? { allowed: false, axis: 'archived', reason: 'this company has been archived' }
    : row.entitlement_paused_at != null
      ? { allowed: false, axis: 'entitlement', reason: "this company's subscription is not active" }
      : { allowed: false, axis: 'paused', reason: 'this company is paused' };
}

/**
 * The writes that stay permitted while an erasure is pending, and why each one
 * is permitted.
 *
 * PURPOSE, NOT IDENTITY. The test is not "is this the founder" — it is always
 * the founder, that is what an API key means, and if that were enough the whole
 * surface would be open again. It is "does this write REDUCE what Foundry can
 * do to the outside world". Disconnecting an outbound webhook is something a
 * company on its way out must always be able to do; nothing else on this
 * surface completes the erasure, reverses it, or makes anything safer.
 *
 * A route not named here is refused during the window. That is the point: an
 * endpoint added next year joins the refused set by default rather than the
 * permitted one.
 */
const REDUCTIONS_PERMITTED_WHILE_ERASING: Array<{
  method: string; path: RegExp; purpose: string;
}> = [
  {
    method: 'DELETE',
    path: /^\/v1\/webhooks\/[^/]+\/?$/,
    purpose: 'removing an outbound effect path — a reduction, and one a company being deleted should never be made to wait thirty days for',
  },
];

/** Exported so a test can read the purposes rather than re-deriving them. */
export const ERASURE_PERMITTED_REDUCTIONS = REDUCTIONS_PERMITTED_WHILE_ERASING;

function isPermittedReduction(method: string, path: string): boolean {
  return REDUCTIONS_PERMITTED_WHILE_ERASING.some(
    (r) => r.method === method.toUpperCase() && r.path.test(path));
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
  // The erasure axis is the only one with a permitted-purpose door, because it
  // is the only one where the company is on its way out rather than merely
  // stopped: a reduction stays available all the way to the end.
  if (verdict.axis === 'erasure' && isPermittedReduction(c.req.method, c.req.path)) {
    return next();
  }

  return c.json({
    error: 'read_only',
    message: `Foundry is not currently acting for this company — ${verdict.reason}. `
      + 'Reads still work; anything that changes the company does not.',
  }, 403);
});
