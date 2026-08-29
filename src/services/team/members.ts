// =============================================================================
// FOUNDRY — Team / Co-Founder Mode: Member Management
// Invite co-founders, manage roles, compute alignment scores.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { computeSignal } from '../signal.js';
import { nanoid } from 'nanoid';
import type { TeamMember, TeamInvitation, AlignmentSnapshot } from '../../types/index.js';

// ─── Get Team ─────────────────────────────────────────────────────────────────

export async function getTeamMembers(productId: string): Promise<TeamMember[]> {
  const result = await query(
    `SELECT tm.*, f.name as founder_name, f.email as founder_email
     FROM team_members tm
     JOIN founders f ON tm.founder_id = f.id
     WHERE tm.product_id = ? AND tm.status = 'active'
     ORDER BY tm.joined_at ASC`,
    [productId],
  );
  return result.rows as unknown as TeamMember[];
}

export async function getPendingInvitations(productId: string): Promise<TeamInvitation[]> {
  const result = await query(
    `SELECT * FROM team_invitations
     WHERE product_id = ? AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC`,
    [productId],
  );
  return result.rows as unknown as TeamInvitation[];
}

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

// ─── Decision Votes ───────────────────────────────────────────────────────────

export async function submitDecisionVote(
  decisionId: string,
  productId: string,
  founderId: string,
  vote: 'approve' | 'reject' | 'abstain' | 'needs_more_info',
  preferredOption?: string,
  rationale?: string,
  concerns?: string[],
): Promise<void> {
  await query(
    `INSERT INTO decision_votes
     (id, decision_id, product_id, founder_id, vote, preferred_option, rationale, concerns)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(decision_id, founder_id) DO UPDATE SET
       vote = excluded.vote, preferred_option = excluded.preferred_option,
       rationale = excluded.rationale, concerns = excluded.concerns,
       voted_at = CURRENT_TIMESTAMP`,
    [nanoid(), decisionId, productId, founderId, vote, preferredOption ?? null, rationale ?? null, JSON.stringify(concerns ?? [])],
  );
}

export async function getDecisionVotes(decisionId: string): Promise<Array<{
  founder_name: string;
  vote: string;
  preferred_option: string | null;
  rationale: string | null;
}>> {
  const result = await query(
    `SELECT f.name as founder_name, dv.vote, dv.preferred_option, dv.rationale
     FROM decision_votes dv
     JOIN founders f ON dv.founder_id = f.id
     WHERE dv.decision_id = ?`,
    [decisionId],
  );
  return result.rows as unknown as Array<{ founder_name: string; vote: string; preferred_option: string | null; rationale: string | null }>;
}

// ─── Alignment Score ──────────────────────────────────────────────────────────

/**
 * Compute the co-founder alignment score for a product.
 * Measures: signal interpretation consensus, risk state agreement, priority consensus.
 * Called weekly when a product has 2+ active team members.
 */
export async function computeAlignmentScore(productId: string): Promise<AlignmentSnapshot | null> {
  const members = await getTeamMembers(productId);
  if (members.length < 2) return null;

  // Recent decision votes, FROM PRINCIPALS ENTITLED TO CAST THEM.
  //
  // `can_vote_decisions` existed and nothing read it, so an investor_observer
  // could vote and their vote fed this score. Refusing new ones at the route
  // stops the intake; it does not clean what the intake already accepted.
  //
  // The rows stay. What actually happened is evidence, and deleting it would
  // be fabricating a history in which it did not. What changes is that the
  // CURRENT canonical alignment is computed only from votes whose caster is
  // entitled to vote today: the owner, and members whose membership carries
  // the permission. A vote from somebody since removed, or since restricted,
  // stops counting — which is the same rule read forwards.
  const recentVotes = await query(
    `SELECT dv.decision_id, dv.vote, dv.preferred_option, dv.founder_id
       FROM decision_votes dv
      WHERE dv.product_id = ? AND dv.voted_at > date('now', '-30 days')
        AND (
          EXISTS (SELECT 1 FROM products p
                   WHERE p.id = dv.product_id AND p.owner_id = dv.founder_id)
          OR EXISTS (SELECT 1 FROM team_members t
                      WHERE t.product_id = dv.product_id
                        AND t.founder_id = dv.founder_id
                        AND t.status = 'active'
                        AND t.can_vote_decisions = 1)
        )`,
    [productId],
  );

  const votes = recentVotes.rows as unknown as Array<{ decision_id: string; vote: string; preferred_option: string | null; founder_id: string }>;

  // Group by decision
  const votesByDecision = new Map<string, typeof votes>();
  for (const v of votes) {
    if (!votesByDecision.has(v.decision_id)) votesByDecision.set(v.decision_id, []);
    votesByDecision.get(v.decision_id)!.push(v);
  }

  // Count decisions with consensus vs divergence
  let consensusCount = 0;
  let totalDecisions = 0;
  const divergenceAreas: string[] = [];

  for (const [decisionId, decVotes] of votesByDecision) {
    if (decVotes.length < 2) continue;
    totalDecisions++;

    const allApprove = decVotes.every((v) => v.vote === 'approve');
    const allReject = decVotes.every((v) => v.vote === 'reject');
    const sameOption = decVotes.every((v) => v.preferred_option === decVotes[0].preferred_option);

    if (allApprove || allReject || sameOption) {
      consensusCount++;
    } else {
      // Get the decision title for the divergence report
      const dResult = await query(`SELECT what FROM decisions WHERE id = ?`, [decisionId]);
      if (dResult.rows.length > 0) {
        divergenceAreas.push((dResult.rows[0] as Record<string, string>).what);
      }
    }
  }

  const priorityConsensus = totalDecisions > 0 ? consensusCount / totalDecisions > 0.7 : true;
  const alignmentScore = totalDecisions > 0
    ? Math.round(70 + (priorityConsensus ? 30 : 0) * (consensusCount / totalDecisions))
    : 75; // default when no decisions voted on yet

  const today = new Date().toISOString().slice(0, 10);
  const id = nanoid();

  await query(
    `INSERT INTO alignment_snapshots
     (id, product_id, snapshot_date, alignment_score, priority_consensus, divergence_areas)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id, snapshot_date) DO UPDATE SET
       alignment_score = excluded.alignment_score,
       priority_consensus = excluded.priority_consensus,
       divergence_areas = excluded.divergence_areas`,
    [id, productId, today, alignmentScore, priorityConsensus ? 1 : 0, JSON.stringify(divergenceAreas)],
  );

  return {
    id, product_id: productId, snapshot_date: today,
    alignment_score: alignmentScore,
    signal_consensus: null,
    divergence_areas: divergenceAreas,
    risk_state_consensus: null,
    priority_consensus: priorityConsensus,
    notes: null,
    created_at: new Date().toISOString(),
  };
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
export type MemberCapability =
  | 'can_view_decisions'
  | 'can_vote_decisions'
  | 'can_view_financials'
  | 'can_view_audit'
  | 'can_trigger_actions'
  /** Ordinary company management: credentials, integrations, share links, the
   * sending address, inviting colleagues. NOT ownership — cancelling the
   * subscription, pausing the company and archiving the product stay behind an
   * ownership check, because they are not capabilities anyone can be granted. */
  | 'can_manage_company';

/** Every capability, so a gate can iterate them rather than a list going stale
 * beside the union. */
export const MEMBER_CAPABILITIES: readonly MemberCapability[] = [
  'can_view_decisions', 'can_vote_decisions', 'can_view_financials',
  'can_view_audit', 'can_trigger_actions', 'can_manage_company',
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
