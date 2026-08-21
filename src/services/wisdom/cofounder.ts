// =============================================================================
// FOUNDRY — Co-Founder Alignment Module
// Measures DNA divergence, decision attribution, gate agreements.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

/**
 * PERFECT AGREEMENT WITH SOMEONE WHO NEVER ANSWERED.
 *
 * These four were plain numbers, and the two branches that have nothing to
 * compare returned opposite extremes of the same absence:
 *
 *   no responses at all   → 0, 0, 0, 0     (complete disagreement)
 *   one founder responded → 100, 100, 100, 100  (perfect agreement)
 *
 * The recommendation string explained which case it was. The numbers did not,
 * and a number is what a caller renders. A solo founder was reported as being
 * in perfect alignment with co-founders who had said nothing.
 *
 * Null now, in both branches. `recommendations` still says why.
 */
export interface AlignmentScore {
  overall_alignment: number | null;
  vision_alignment: number | null;
  priority_alignment: number | null;
  risk_alignment: number | null;
  divergence_axis: string | null;
  recommendations: string[];
  /** How many co-founders have answered. Zero and one both mean "cannot score". */
  respondents: number;
}

/**
 * WHICH CO-FOUNDER, AND WHICH KIND OF DECIDER.
 *
 * `by_founder` was keyed on `decisions.decided_by`. That column does not hold a
 * person. Migration 153 said so in as many words — "`decided_by` holds
 * 'founder' or 'second_self'. That is a KIND" — and added
 * `decided_by_founder_id` for the person. Migration 158 put the CHECK on it.
 *
 * So "by_founder" had at most two keys, and neither was a co-founder. One was
 * the human role and the other was Foundry deciding for itself. The imbalance
 * check then compared those two and reported: "One co-founder is approving
 * significantly more decisions than the other." It was telling a founder their
 * co-founder was out of balance, about a comparison between the founder and the
 * machine.
 *
 * Both questions are worth answering and they are different questions, so both
 * are answered, from the columns that hold each.
 *
 * `decided` was called `proposed`. It counts decisions CLOSED. Nobody proposed
 * them; `decisions` has no proposer column.
 */
export interface DecisionAttribution {
  total_decisions: number;
  /** Keyed by `decided_by_founder_id` — an actual person. */
  by_founder: Record<string, { decided: number; approved: number }>;
  /** Closed decisions with no founder id recorded, which cannot be attributed. */
  unattributed: number;
  /** How many the founder closed and how many Foundry closed for them. */
  by_decider_kind: { founder: number; second_self: number };
  /**
   * Null when fewer than two PEOPLE have decided anything — there is nobody to
   * be imbalanced against. It used to be `false` in that case, which reads as
   * "we checked and they are balanced".
   */
  imbalance_detected: boolean | null;
  imbalance_description: string | null;
}

/**
 * Compute alignment score by comparing co-founder DNA responses.
 */
export async function getAlignmentScore(productId: string): Promise<AlignmentScore> {
  // Get all co-founder DNA responses
  const responses = await query(
    'SELECT * FROM cofounder_dna_responses WHERE product_id = ?',
    [productId]
  );

  if (responses.rows.length === 0) {
    return {
      overall_alignment: null,
      vision_alignment: null,
      priority_alignment: null,
      risk_alignment: null,
      divergence_axis: null,
      recommendations: ['No co-founder DNA responses collected yet.'],
      respondents: 0,
    };
  }

  // Group responses by founder
  const byFounder: Record<string, Record<string, string>> = {};
  for (const row of responses.rows as unknown as Array<Record<string, string>>) {
    if (!byFounder[row.founder_id]) byFounder[row.founder_id] = {};
    byFounder[row.founder_id]![row.dna_field] = row.response;
  }

  const founderIds = Object.keys(byFounder);
  if (founderIds.length < 2) {
    return {
      overall_alignment: null,
      vision_alignment: null,
      priority_alignment: null,
      risk_alignment: null,
      divergence_axis: null,
      recommendations: ['Only one co-founder has responded. Need at least two for alignment analysis.'],
      respondents: founderIds.length,
    };
  }

  // Use Claude Opus to analyze alignment
  const prompt = `Analyze alignment between co-founders based on their independent DNA responses.

Responses by founder:
${founderIds.map((id, i) => `Founder ${i + 1}:\n${JSON.stringify(byFounder[id], null, 2)}`).join('\n\n')}

Return JSON:
{
  "overall_alignment": 0-100,
  "vision_alignment": 0-100 (ICP + positioning agreement),
  "priority_alignment": 0-100 (decision pattern agreement),
  "risk_alignment": 0-100 (risk tolerance agreement),
  "divergence_axis": "build-vs-sell | depth-vs-breadth | speed-vs-quality | null",
  "recommendations": ["actionable alignment actions"]
}

Score 100 = perfect agreement, 0 = complete disagreement. Be specific about where they diverge.`;

  const response = await callOpus(
    'You are a co-founder alignment analyst. Identify systematic disagreement patterns, not just surface differences.',
    prompt,
    2048,
    productId
  );

  const parsed = parseJSONResponse<Omit<AlignmentScore, 'respondents'>>(response.content);
  const result: AlignmentScore = { ...parsed, respondents: founderIds.length };

  // Persist
  const today = new Date().toISOString().split('T')[0]!;
  await query(
    `INSERT INTO cofounder_alignment_scores (id, product_id, score_date, overall_alignment, vision_alignment, priority_alignment, risk_alignment, divergence_axis, recommendations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), productId, today,
      result.overall_alignment, result.vision_alignment,
      result.priority_alignment, result.risk_alignment,
      result.divergence_axis, JSON.stringify(result.recommendations),
    ]
  );

  return result;
}

/**
 * Detect systematic divergence patterns from decision history.
 */
export async function detectDivergenceAxis(productId: string): Promise<string | null> {
  const decisions = await query(
    `SELECT * FROM decisions WHERE product_id = ? AND status IN ('approved', 'rejected') ORDER BY decided_at DESC LIMIT 20`,
    [productId]
  );

  if (decisions.rows.length < 5) return null;

  const prompt = `Analyze these product decisions for systematic co-founder disagreement patterns.

Decisions:
${(decisions.rows as unknown as Array<Record<string, string>>).map((d) =>
  `- ${d.what} [${d.category}] → ${d.status} by ${d.decided_by}`
).join('\n')}

If you detect a systematic pattern (build-vs-sell, depth-vs-breadth, speed-vs-quality), return it as a single phrase. If no pattern, return "none".`;

  const response = await callOpus(
    'You are a co-founder dynamics analyst.',
    prompt,
    256,
    productId
  );

  const axis = response.content.trim().toLowerCase();
  return axis === 'none' ? null : axis;
}

/**
 * Get decision attribution: who proposed vs approved each decision.
 */
export async function getDecisionAttribution(
  productId: string,
  dateRange?: { start: string; end: string }
): Promise<DecisionAttribution> {
  let sql = `SELECT status, decided_by, decided_by_founder_id
               FROM decisions WHERE product_id = ? AND decided_at IS NOT NULL`;
  const args: unknown[] = [productId];

  if (dateRange) {
    sql += ' AND decided_at BETWEEN ? AND ?';
    args.push(dateRange.start, dateRange.end);
  }

  const result = await query(sql, args);
  const byFounder: Record<string, { decided: number; approved: number }> = {};
  const byKind = { founder: 0, second_self: 0 };
  let unattributed = 0;

  for (const row of result.rows as unknown as Array<Record<string, string>>) {
    if (row.decided_by === 'founder') byKind.founder++;
    else if (row.decided_by === 'second_self') byKind.second_self++;

    const founderId = row.decided_by_founder_id ?? null;
    if (founderId === null) { unattributed++; continue; }
    if (!byFounder[founderId]) byFounder[founderId] = { decided: 0, approved: 0 };
    if (row.status === 'approved') byFounder[founderId]!.approved++;
    byFounder[founderId]!.decided++;
  }

  const founders = Object.keys(byFounder);
  // Null, not false: with fewer than two people there is nobody to be
  // imbalanced against, and `false` reads as "we checked, they are balanced" —
  // which is the opposite of what one person deciding everything means.
  let imbalance: boolean | null = founders.length >= 2 ? false : null;
  let desc: string | null = null;

  if (founders.length >= 2) {
    const counts = founders.map((f) => byFounder[f]!.approved);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max > 0 && min / max < 0.3) {
      imbalance = true;
      desc = 'One co-founder is approving significantly more decisions than the other.';
    }
  }

  return {
    total_decisions: result.rows.length,
    by_founder: byFounder,
    unattributed,
    by_decider_kind: byKind,
    imbalance_detected: imbalance,
    imbalance_description: desc,
  };
}

/**
 * Check if a decision category requires co-founder gate agreement.
 */
export async function checkGateAgreement(
  productId: string,
  decisionCategory: string
): Promise<{ required: boolean; gate_level: number; requires_unanimous: boolean } | null> {
  const result = await query(
    'SELECT * FROM cofounder_gate_agreements WHERE product_id = ? AND decision_category = ?',
    [productId, decisionCategory]
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    required: true,
    gate_level: row.gate_level as number,
    requires_unanimous: (row.requires_unanimous as number) === 1,
  };
}
