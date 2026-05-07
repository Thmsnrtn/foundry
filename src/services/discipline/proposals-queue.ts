// =============================================================================
// FOUNDRY — Phase Beta Proposals Queue (V3.1 Layer A)
// When the architecture freeze blocks a decision, evolution, or addition,
// the original intent is captured here for review at end of freeze.
// Nothing silently disappears.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProposalSourceType =
  | 'decision'
  | 'evolution'
  | 'cron_addition'
  | 'integration'
  | 'agent_provision';

export type ProposalStatus =
  | 'queued'
  | 'approved'
  | 'rejected'
  | 'force_applied'
  | 'superseded';

export interface PhaseBetaProposal {
  id: string;
  product_id: string;
  source_type: ProposalSourceType;
  source_id: string | null;
  proposed_change: string;
  proposed_by: string;
  rationale: string | null;
  blocked_at: string;
  blocked_during_freeze_id: string | null;
  status: ProposalStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
}

export interface QueueProposalInput {
  source_type: ProposalSourceType;
  source_id?: string | null;
  proposed_change: string;
  proposed_by: string;
  rationale?: string | null;
  blocked_during_freeze_id?: string | null;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function rowToProposal(r: Record<string, unknown>): PhaseBetaProposal {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    source_type: r.source_type as ProposalSourceType,
    source_id: (r.source_id as string | null) ?? null,
    proposed_change: r.proposed_change as string,
    proposed_by: r.proposed_by as string,
    rationale: (r.rationale as string | null) ?? null,
    blocked_at: r.blocked_at as string,
    blocked_during_freeze_id: (r.blocked_during_freeze_id as string | null) ?? null,
    status: (r.status as ProposalStatus) ?? 'queued',
    reviewed_at: (r.reviewed_at as string | null) ?? null,
    reviewed_by: (r.reviewed_by as string | null) ?? null,
    review_notes: (r.review_notes as string | null) ?? null,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listQueued(productId: string): Promise<PhaseBetaProposal[]> {
  const result = await query(
    `SELECT * FROM phase_beta_proposals
     WHERE product_id = ? AND status = 'queued'
     ORDER BY blocked_at ASC`,
    [productId]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToProposal);
}

export async function getProposal(id: string): Promise<PhaseBetaProposal | null> {
  const result = await query(
    `SELECT * FROM phase_beta_proposals WHERE id = ?`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return rowToProposal(result.rows[0] as Record<string, unknown>);
}

export async function listForFreeze(freezeId: string): Promise<PhaseBetaProposal[]> {
  const result = await query(
    `SELECT * FROM phase_beta_proposals
     WHERE blocked_during_freeze_id = ?
     ORDER BY blocked_at ASC`,
    [freezeId]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToProposal);
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function queueProposal(
  productId: string,
  input: QueueProposalInput
): Promise<PhaseBetaProposal> {
  const id = nanoid();
  await query(
    `INSERT INTO phase_beta_proposals
       (id, product_id, source_type, source_id, proposed_change, proposed_by,
        rationale, blocked_during_freeze_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      input.source_type,
      input.source_id ?? null,
      input.proposed_change,
      input.proposed_by,
      input.rationale ?? null,
      input.blocked_during_freeze_id ?? null,
    ]
  );
  const created = await getProposal(id);
  if (!created) throw new Error(`failed to queue proposal ${id}`);
  return created;
}

export async function reviewProposal(
  proposalId: string,
  decision: 'approved' | 'rejected' | 'force_applied' | 'superseded',
  reviewedBy: string,
  notes?: string
): Promise<void> {
  await query(
    `UPDATE phase_beta_proposals
     SET status = ?, reviewed_at = datetime('now'),
         reviewed_by = ?, review_notes = ?
     WHERE id = ? AND status = 'queued'`,
    [decision, reviewedBy, notes ?? null, proposalId]
  );
}
