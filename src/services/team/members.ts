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
    const canTrigger = inv.role === 'co_founder';
    await query(
      `INSERT INTO team_members
       (id, product_id, founder_id, role, can_trigger_actions, invited_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), inv.product_id, founderId, inv.role, canTrigger ? 1 : 0, inv.invited_by],
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

  // Get recent decision votes to measure priority consensus
  const recentVotes = await query(
    `SELECT dv.decision_id, dv.vote, dv.preferred_option, f.id as founder_id
     FROM decision_votes dv
     JOIN founders f ON dv.founder_id = f.id
     WHERE dv.product_id = ? AND dv.voted_at > date('now', '-30 days')`,
    [productId],
  );

  const votes = recentVotes.rows as Array<{ decision_id: string; vote: string; preferred_option: string | null; founder_id: string }>;

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
 * Check if a founder has access to a product (owner or active team member).
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
