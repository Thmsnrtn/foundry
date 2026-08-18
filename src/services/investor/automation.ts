// =============================================================================
// FOUNDRY — Investor & Board Automation
// Auto-generated updates, board decks, fundraise readiness, data rooms.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

// `generateInvestorUpdate` was here — the second writer into
// `investor_updates`, and the one that never set `month`. Every dashboard read
// keys on that column: `WHERE product_id=? AND month=?` for the duplicate
// check, `ORDER BY month DESC` for the list. So an update created through the
// API was invisible to the surface that shows updates AND invisible to the
// check that stops a second one being written for the same month.
//
// The canonical writer is in services/scp/investor/investor-update.ts, and it
// deliberately fills both generations of column names so every reader of
// either sees the same update. Retired in migration 164, which backfills
// `month` and `draft_text` for the rows this one left behind.

export async function generateBoardDeck(productId: string, ownerId: string): Promise<{ id: string; slides: string[] }> {
  const product = await query('SELECT name, sector_profile, growth_stage FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const prompt = `Generate board deck slide content (text only) for a quarterly board meeting.

Product: ${p?.name ?? 'Unknown'} (${p?.sector_profile ?? 'SaaS'}, ${p?.growth_stage ?? 'growth'})

Generate 6-8 slides:
1. Executive Summary (3 bullets)
2. Key Metrics (MRR, growth, churn, NPS)
3. Customer Health (cohort trends, churn analysis)
4. Product & Engineering (shipped, roadmap)
5. Competitive Landscape
6. Financial Overview (runway, unit economics)
7. Asks & Discussion Topics
8. Next Quarter Priorities

Return JSON: {"slides": ["slide 1 content", "slide 2 content", ...]}`;

  const response = await callOpus(
    'You are writing board meeting slides for a SaaS startup. Be strategic and data-focused.',
    prompt,
    4096,
    productId
  );

  const result = parseJSONResponse<{ slides: string[] }>(response.content);
  const id = nanoid();
  const period = new Date().toISOString().slice(0, 7);

  await query(
    `INSERT INTO board_decks (id, product_id, owner_id, period, slides, status) VALUES (?, ?, ?, ?, ?, 'draft')`,
    [id, productId, ownerId, period, JSON.stringify(result.slides)]
  );

  return { id, slides: result.slides };
}

/**
 * Assess fundraise readiness against what investors look for.
 */
export async function assessFundraiseReadiness(
  productId: string,
  ownerId: string,
  targetRound: string = 'seed'
): Promise<{
  overall_score: number;
  dimensions: Record<string, { score: number; gap: string }>;
  recommendations: string[];
}> {
  const [product, metrics, economics] = await Promise.all([
    query('SELECT name, sector_profile, growth_stage FROM products WHERE id = ?', [productId]),
    query('SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1', [productId]),
    query('SELECT * FROM unit_economics_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1', [productId]),
  ]);

  const p = product.rows[0] as Record<string, string> | undefined;
  const m = metrics.rows[0] as Record<string, unknown> | undefined;
  const e = economics.rows[0] as Record<string, unknown> | undefined;

  const prompt = `Assess this product's readiness for a ${targetRound} fundraise.

Product: ${p?.name ?? 'Unknown'} (${p?.sector_profile ?? 'SaaS'})
Stage: ${p?.growth_stage ?? 'early'}
Metrics: ${JSON.stringify(m ?? {})}
Unit Economics: ${JSON.stringify(e ?? {})}

Score 0-100 on each dimension, identify the gap, and provide specific recommendations.
Dimensions: growth_rate, retention, market_size, team, unit_economics, product_market_fit, defensibility

Return JSON:
{
  "overall_score": 0-100,
  "dimensions": {"growth_rate": {"score": N, "gap": "..."}, ...},
  "recommendations": ["specific actions to improve readiness"]
}`;

  const response = await callOpus(
    'You are a fundraising readiness advisor. Score against real investor expectations.',
    prompt,
    2048,
    productId
  );

  const result = parseJSONResponse<{
    overall_score: number;
    dimensions: Record<string, { score: number; gap: string }>;
    recommendations: string[];
  }>(response.content);

  await query(
    `INSERT INTO fundraise_readiness (id, product_id, owner_id, target_round, overall_score, dimension_scores, gaps, recommendations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), productId, ownerId, targetRound,
      result.overall_score,
      JSON.stringify(result.dimensions),
      JSON.stringify(Object.values(result.dimensions).map((d) => d.gap)),
      JSON.stringify(result.recommendations),
    ]
  );

  return result;
}
