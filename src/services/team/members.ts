// =============================================================================
// FOUNDRY — who may act for a company
// Ownership and member capability, read at every door that acts.
// =============================================================================

import { query } from '../../db/client.js';

// ONE OWNER, NO MEMBERS (Private S7b3, 29 September 2026).
//
// Foundry is the owner's alone. Invitations, votes, co-founders, advisors and
// investor observers all went: nobody else is ever admitted (S2), so nobody
// else is ever a member. Every question below used to be "the owner OR an
// active member"; each is now the owner, which is the same answer on this
// deployment and a narrower one everywhere — a stale membership row, if one
// existed, admits nobody. The questions themselves stay, because the doors
// that ask them are live and should keep asking.

/**
 * WHAT A MEMBER MAY DO, NOT MERELY THAT THEY ARE ONE.
 *
 * `team_members` has carried five permission columns since migration 010 —
 * can_view_decisions, can_vote_decisions, can_view_financials, can_view_audit,
 * can_trigger_actions — and the invite flow writes them. Nothing read any of
 * them. The only guard was `hasProductAccess`, which asks whether somebody is
 * on the team at all, so an `investor_observer` — a role whose name says they
 * observe — could cast a vote on a company decision, and those votes feed the
 * co-founder alignment score.
 *
 * The columns were not decoration: `can_trigger_actions` defaults to FALSE
 * while the others default TRUE, which is a considered position about what an
 * advisor should be able to do. It was written down and never asked.
 *
 * The owner is always allowed: they are not a member and have no row here.
 */
/**
 * WHAT THE INSTITUTION ACTUALLY ENFORCES.
 *
 * This union carried six names. Three of them — `can_view_decisions`,
 * `can_view_financials`, `can_view_audit` — were read only by Commercial
 * Foundry's decision queue, investor pages, ROI dashboard and audit log, all
 * deleted on 13 September 2026. A capability stored on a row and consulted by
 * nothing is not governance; it is a checkbox that reassures whoever set it
 * and stops nobody, and `permission-edges` exists to say so. So the three left
 * with their routes.
 *
 * `can_vote_decisions` nearly left with them, and would have been wrong to:
 * its consumer is `foundry_resolve_decision` in the MCP loop, which is a live
 * entry point that the gate checking this vocabulary was not looking at. A key
 * acting for a founder who may not decide for a company is exactly what it
 * stops, and it very nearly lost that because the gate's search path had three
 * directories in it and the institution has four doors.
 *
 * THE COLUMNS STAY FOR NOW. Dropping them is a migration against a production
 * database, and the prior question is whether a single-owner institution has
 * "members" at all — the same question as the forty-eight services orphaned by
 * the same deletion. Until that is decided the columns are inert data with no
 * reader, which is a smaller and more honest thing than a vocabulary that
 * claims to gate what it does not.
 */
export type MemberCapability =
  | 'can_vote_decisions'
  | 'can_trigger_actions'
  /** Ordinary company management: credentials, integrations, share links, the
   * sending address, inviting colleagues. NOT ownership — cancelling the
   * subscription, pausing the company and archiving the product stay behind an
   * ownership check, because they are not capabilities anyone can be granted. */
  | 'can_manage_company';

/** Every capability, so a gate can iterate them rather than a list going stale
 * beside the union. */
export const MEMBER_CAPABILITIES: readonly MemberCapability[] = [
  'can_vote_decisions', 'can_trigger_actions', 'can_manage_company',
] as const;

export async function memberMay(
  productId: string, founderId: string, capability: MemberCapability,
): Promise<boolean> {
  // THE UNION IS A TYPE, AND TYPES ARE ERASED.
  //
  // The capability is interpolated into SQL as a column name. It was protected
  // by every call site happening to pass a string literal — which is a property
  // of the wiring, not of this function, and this function is one call site
  // away from being reachable with a request-supplied string.
  //
  // `push.ts` carries the identical shape and was given a runtime lookup for
  // exactly this reason. This is the AUTHORITY check, so it is the last place
  // that should be relying on a type that does not exist at runtime.
  //
  // Fails CLOSED. An unrecognised capability is not "no such restriction", it
  // is "I do not know what you are asking for", and the safe answer to that is
  // no — checked before the ownership shortcut, so an unknown capability cannot
  // be answered `true` for an owner either.
  if (!MEMBER_CAPABILITIES.includes(capability)) return false;

  // The owner may do everything a capability names, and there is nobody else.
  return isCompanyOwner(productId, founderId);
}

/**
 * Is this person the owner of this company?
 *
 * OWNERSHIP IS NOT A PERMISSION. It is the exceptional boundary: the one
 * person who can end the subscription, pause the company, archive the product
 * and decide who pays. Nothing grants it and no membership row confers it,
 * which is why it is asked separately rather than being the top rung of a
 * ladder.
 */
export async function isCompanyOwner(productId: string, founderId: string): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM products WHERE id = ? AND owner_id = ?`, [productId, founderId]);
  return res.rows.length > 0;
}

/**
 * The companies this person may see: the ones they own. Accepted members were
 * added to this once, when co-founders could be invited; with one owner and no
 * members (Private S7b3) it is ownership again, and an old membership row
 * shows nobody anything.
 *
 * Visibility is not capability. Being able to see the company is where the
 * question starts, and every consequential route still asks its own.
 */
export async function visibleProductIds(founderId: string): Promise<string[]> {
  const res = await query(
    `SELECT id FROM products WHERE owner_id = ? AND status != 'archived' ORDER BY 1`,
    [founderId]);
  return (res.rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.id));
}

/**
 * Does this person belong to this company at all? Only its owner does.
 *
 * MEMBERSHIP, NOT PERMISSION. Callers deciding whether somebody may DO
 * something want `memberMay`; this only answers whether they belong here.
 */
export async function hasProductAccess(productId: string, founderId: string): Promise<boolean> {
  return isCompanyOwner(productId, founderId);
}
