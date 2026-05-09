// =============================================================================
// FOUNDRY — Founder Feedback (Wave 2, action 16)
// One-tap NPS prompt + storage. Per 300-persona review Council 18: Foundry
// has no NPS surface anywhere; aggregate-level qualitative signal is
// invisible. This module captures it cheaply.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedbackType = 'nps' | 'csat' | 'rejection_reason';
export type NpsCategory = 'detractor' | 'passive' | 'promoter';

export interface FeedbackEntry {
  id: string;
  founder_id: string;
  product_id: string | null;
  feedback_type: FeedbackType;
  score: number | null;
  category: NpsCategory | null;
  comment: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function submitNps(
  founderId: string,
  productId: string | null,
  score: number,
  comment?: string
): Promise<FeedbackEntry> {
  const clamped = Math.max(0, Math.min(10, Math.round(score)));
  const category: NpsCategory =
    clamped >= 9 ? 'promoter' : clamped >= 7 ? 'passive' : 'detractor';

  const id = nanoid();
  await query(
    `INSERT INTO founder_feedback
       (id, founder_id, product_id, feedback_type, score, category, comment)
     VALUES (?, ?, ?, 'nps', ?, ?, ?)`,
    [id, founderId, productId, clamped, category, comment ?? null]
  );

  return {
    id,
    founder_id: founderId,
    product_id: productId,
    feedback_type: 'nps',
    score: clamped,
    category,
    comment: comment ?? null,
    context: null,
    created_at: new Date().toISOString(),
  };
}

export async function submitRejectionReason(
  founderId: string,
  productId: string,
  draftId: string,
  agentName: string | null,
  reason: string
): Promise<void> {
  await query(
    `INSERT INTO founder_feedback
       (id, founder_id, product_id, feedback_type, comment, context_json)
     VALUES (?, ?, ?, 'rejection_reason', ?, ?)`,
    [
      nanoid(),
      founderId,
      productId,
      reason,
      JSON.stringify({ draftId, agentName }),
    ]
  );
}

/**
 * Returns true when the founder is due for the monthly NPS prompt
 * (no NPS submitted in the trailing 30 days).
 */
export async function isDueForNps(founderId: string): Promise<boolean> {
  const r = await query(
    `SELECT MAX(datetime(created_at)) AS last_nps
       FROM founder_feedback
      WHERE founder_id = ? AND feedback_type = 'nps'`,
    [founderId]
  );
  const row = r.rows[0] as Record<string, string | null> | undefined;
  const last = row?.last_nps;
  if (!last) return true;
  const lastMs = new Date(last.replace(' ', 'T') + 'Z').getTime();
  const daysSince = (Date.now() - lastMs) / (1000 * 60 * 60 * 24);
  return daysSince >= 30;
}

/**
 * Aggregate trailing-90d NPS for founder-ops surface.
 */
export async function getNpsAggregate(): Promise<{
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
  responses: number;
}> {
  const r = await query(
    `SELECT category, COUNT(*) AS n FROM founder_feedback
      WHERE feedback_type = 'nps'
        AND datetime(created_at) > datetime('now', '-90 days')
      GROUP BY category`,
    []
  );
  let promoters = 0, passives = 0, detractors = 0;
  for (const row of r.rows) {
    const rec = row as Record<string, unknown>;
    const c = rec.category as NpsCategory;
    const n = Number(rec.n ?? 0);
    if (c === 'promoter') promoters = n;
    else if (c === 'passive') passives = n;
    else if (c === 'detractor') detractors = n;
  }
  const responses = promoters + passives + detractors;
  const nps = responses === 0 ? null : Math.round(((promoters - detractors) / responses) * 100);
  return { promoters, passives, detractors, nps, responses };
}
