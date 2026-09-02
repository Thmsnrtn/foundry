// =============================================================================
// FOUNDRY — which company the owner is working on
//
// MOVED OUT OF THE OLD DASHBOARD'S PLUMBING (`routes/dashboard/_shared.ts`),
// and the reason is the layer boundary rather than tidiness.
//
// `_shared.ts` is the multi-tenant dashboard's shared furniture — the layout,
// the trial banner, the plan CTA — and it imports commercial billing to draw
// them. The private owner shell needed exactly one thing from it, this
// function, and importing it dragged the whole commercial dependency into the
// owner's experience. Which company someone is working on is an institutional
// question, not a property of that dashboard's chrome, so it lives in the
// kernel and both surfaces read it from there.
// =============================================================================

import { getCookie } from 'hono/cookie';
import { query } from '../../db/client.js';

/**
 * The company this founder is acting on, or null.
 *
 * WHICHEVER COMPANY SORTED FIRST WAS DECIDING REAL ACTIONS. Three POST routes
 * resolved the company with `SELECT id FROM products WHERE owner_id = ? LIMIT 1`
 * — no ORDER BY, so the row SQLite happened to return first. A founder with two
 * companies rotated an ingest token on whichever one that was, generated a
 * public share link for it, and had the week's plan written for it. The
 * pause/resume routes already did this correctly, from the cookie the company
 * switcher sets; this is that rule with one home.
 *
 * Returns null when there is no selection or the selection is not this
 * founder's, and the caller does nothing rather than acting on a guess.
 */
export async function selectedProductId(
  honoCtx: Parameters<typeof getCookie>[0],
  founderId: string,
): Promise<string | null> {
  const cookieProductId = getCookie(honoCtx, 'foundry_product');
  if (cookieProductId) {
    const owned = await query(
      'SELECT id FROM products WHERE id = ? AND owner_id = ?',
      [cookieProductId, founderId]);
    if (owned.rows.length > 0) return (owned.rows[0] as Record<string, string>).id;
  }

  // No cookie, or a stale one. A founder with exactly ONE company has made an
  // unambiguous choice by having only one; more than one is a choice nobody has
  // made, and picking is what this function exists to stop.
  //
  // REAL COMPANIES ONLY, or reference companies would break this by existing.
  // The rule is "exactly one, so the choice is unambiguous" — and a synthetic
  // company created to exercise the institution is not a choice he has to make.
  // Without this, seeding the reference world would push the count above one
  // and silently return null, and every route that depends on this function
  // would stop resolving a company for an owner who still has exactly one.
  const { realCompany } = await import('../../db/client.js');
  // No ORDER BY: the result is used only when it has exactly one row, so an
  // ordering would decide nothing. (`id` is a nanoid, and ordering by one is
  // what `check-id-tiebreak` exists to catch — converting this to a template
  // literal for the predicate made the scanner able to read it for the first
  // time, which is how a pointless clause surfaced after years.)
  const all = await query(
    `SELECT id FROM products WHERE owner_id = ? AND status != 'archived'
       AND ${realCompany()}`,
    [founderId]);
  return all.rows.length === 1 ? (all.rows[0] as Record<string, string>).id : null;
}
