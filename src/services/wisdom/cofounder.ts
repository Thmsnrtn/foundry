// =============================================================================
// FOUNDRY — Co-Founder Alignment Module
// Measures DNA divergence, decision attribution, gate agreements.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

export interface AlignmentScore {
  overall_alignment: number;
  vision_alignment: number;
  priority_alignment: number;
  risk_alignment: number;
  divergence_axis: string | null;
  recommendations: string[];
}

export interface DecisionAttribution {
  total_decisions: number;
  by_founder: Record<string, { proposed: number; approved: number }>;
  imbalance_detected: boolean;
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
      overall_alignment: 0,
      vision_alignment: 0,
      priority_alignment: 0,
      risk_alignment: 0,
      divergence_axis: null,
      recommendations: ['No co-founder DNA responses collected yet.'],
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
      overall_alignment: 100,
      vision_alignment: 100,
      priority_alignment: 100,
      risk_alignment: 100,
      divergence_axis: null,
      recommendations: ['Only one co-founder has responded. Need at least two for alignment analysis.'],
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

  const result = parseJSONResponse<AlignmentScore>(response.content);

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
  let sql = `SELECT * FROM decisions WHERE product_id = ? AND decided_at IS NOT NULL`;
  const args: unknown[] = [productId];

  if (dateRange) {
    sql += ' AND decided_at BETWEEN ? AND ?';
    args.push(dateRange.start, dateRange.end);
  }

  const result = await query(sql, args);
  const byFounder: Record<string, { proposed: number; approved: number }> = {};

  for (const row of result.rows as unknown as Array<Record<string, string>>) {
    const decidedBy = row.decided_by ?? 'system';
    if (!byFounder[decidedBy]) byFounder[decidedBy] = { proposed: 0, approved: 0 };
    if (row.status === 'approved') byFounder[decidedBy]!.approved++;
    byFounder[decidedBy]!.proposed++;
  }

  const founders = Object.keys(byFounder).filter((k) => !k.startsWith('system'));
  let imbalance = false;
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
