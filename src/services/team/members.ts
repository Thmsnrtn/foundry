// =============================================================================
// FOUNDRY — who may act for a company
// Ownership and member capability, read at every door that acts.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { TeamInvitation } from '../../types/index.js';

// VOTES AND THE ALIGNMENT SCORE ARE GONE (Private S7, 29 September 2026).
// Foundry has one owner; nobody else votes, and a co-founder alignment score
// over one person measures nothing.
//
// THE INVITE STAYS UNTIL ITS READERS GO. It is the only writer of
// `team_members`, and seven live readers still take the union "owner OR
// active member" — the gate on writerless tables refuses a reader with no
// writer. Membership is removed in one change with every reader (Private S7b),
// so no door is left asking a question whose answer can only be "no".

// ─── Invite Co-Founder ────────────────────────────────────────────────────────

export async function inviteTeamMember(
  productId: string,
  invitedBy: string,
  email: string,
  role: 'co_founder' | 'advisor' | 'investor_observer',
  message?: string,
): Promise<TeamInvitation> {
  // Check if already a member
  const existing = await query(
    `SELECT tm.id FROM team_members tm
     JOIN founders f ON tm.founder_id = f.id
     WHERE tm.product_id = ? AND f.email = ? AND tm.status = 'active'`,
    [productId, email],
  );
  if (existing.rows.length > 0) {
    throw new Error('This person is already a team member.');
  }

  const id = nanoid();
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await query(
    `INSERT INTO team_invitations (id, product_id, invited_by, email, role, token, message, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, productId, invitedBy, email, role, token, message ?? null, expiresAt],
  );

  return { id, product_id: productId, invited_by: invitedBy, email, role, token, message: message ?? null, accepted_at: null, expires_at: expiresAt, created_at: new Date().toISOString() };
}

/**
 * Accept an invitation. Called when the invitee clicks the link.
 */
export async function acceptInvitation(token: string, founderId: string): Promise<{ product_id: string; role: string }> {
  const result = await query(
    `SELECT * FROM team_invitations
     WHERE token = ? AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [token],
  );
  if (result.rows.length === 0) throw new Error('Invalid or expired invitation.');

  const inv = result.rows[0] as Record<string, string>;

  // Check already a member
  const existing = await query(
    `SELECT id FROM team_members WHERE product_id = ? AND founder_id = ?`,
    [inv.product_id, founderId],
  );

  if (existing.rows.length === 0) {
    // A COLUMN A MIGRATION BACKFILLED AND THIS INSERT NEVER LEARNED ABOUT.
    //
    // Migration 151 added `can_manage_company` with DEFAULT FALSE and
    // backfilled it from the role label, saying what it was for: "Those routes
    // are not owner-only work... A co-founder should be able to do them; an
    // advisor or an investor observer should not." Every member who joined
    // AFTER that migration ran got the default instead, so a co-founder was
    // permanently denied the ~25 routes it gates — settings, API keys, sending
    // identity, integrations, connections, and the door where a company grants
    // Foundry permission to help at all.
    //
    // Nobody noticed because `memberMay` short-circuits true for the owner, and
    // the owner is who tries things.
    //
    // Derived from the role exactly as the migration's backfill derives it, and
    // exactly as `can_trigger_actions` beside it already does. A test compares
    // the two rules, because one rule written in two places is a defect unless
    // something checks that they still agree.
    const isCoFounder = inv.role === 'co_founder';
    await query(
      `INSERT INTO team_members
       (id, product_id, founder_id, role, can_trigger_actions, can_manage_company, invited_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), inv.product_id, founderId, inv.role,
        isCoFounder ? 1 : 0, isCoFounder ? 1 : 0, inv.invited_by],
    );
  }

  await query(
    `UPDATE team_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE token = ?`,
    [token],
  );

  return { product_id: inv.product_id, role: inv.role };
}

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

  const owner = await query(
    `SELECT 1 FROM products WHERE id = ? AND owner_id = ?`, [productId, founderId]);
  if (owner.rows.length > 0) return true;

  const res = await query(
    `SELECT ${capability} AS allowed FROM team_members
      WHERE product_id = ? AND founder_id = ? AND status = 'active'`,
    [productId, founderId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  // Not a member at all, and a member whose flag is off, are both "no". They
  // are different facts and the caller does not need to tell them apart —
  // saying which would tell a stranger whether somebody is on the team.
  if (!row) return false;
  return Number(row.allowed) === 1;
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
 * The companies this person may see: the ones they own, and the ones they have
 * been accepted into.
 *
 * THE DASHBOARD USED TO LIST BY `owner_id` ALONE. A founder could invite a
 * co-founder, have the invitation accepted, and that person would open the
 * dashboard to nothing at all — no company, no pages, no way in. The invite
 * flow existed, the membership row existed, and no query joined them to what
 * anybody could see.
 *
 * Visibility is not capability. Being able to see the company is where the
 * question starts, and every consequential route still asks its own.
 */
export async function visibleProductIds(founderId: string): Promise<string[]> {
  const res = await query(
    `SELECT id FROM products WHERE owner_id = ? AND status != 'archived'
      UNION
     SELECT p.id FROM products p
       JOIN team_members t ON t.product_id = p.id
      WHERE t.founder_id = ? AND t.status = 'active' AND p.status != 'archived'
     ORDER BY 1`,
    [founderId, founderId]);
  return (res.rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.id));
}

/**
 * Check if a founder has access to a product (owner or active team member).
 *
 * MEMBERSHIP, NOT PERMISSION. Callers deciding whether somebody may DO
 * something want `memberMay`; this only answers whether they belong here at
 * all, and every route that admits a team member has to say which capability
 * it requires.
 */
export async function hasProductAccess(productId: string, founderId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM products WHERE id = ? AND owner_id = ?
     UNION
     SELECT 1 FROM team_members WHERE product_id = ? AND founder_id = ? AND status = 'active'
     LIMIT 1`,
    [productId, founderId, productId, founderId],
  );
  return result.rows.length > 0;
}
