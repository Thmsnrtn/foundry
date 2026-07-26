// =============================================================================
// FOUNDRY — Investor & Board Automation
// Auto-generated updates, board decks, fundraise readiness, data rooms.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

/**
 * Generate a monthly investor update from product data.
 */
export async function generateInvestorUpdate(
  productId: string,
  ownerId: string,
  founderHighlight?: string
): Promise<{ id: string; content: string }> {
  const [product, metrics, stressors, decisions, competitive] = await Promise.all([
    query('SELECT name, sector_profile, growth_stage FROM products WHERE id = ?', [productId]),
    query('SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 4', [productId]),
    query("SELECT stressor_name, severity FROM stressor_history WHERE product_id = ? AND status = 'active'", [productId]),
    query("SELECT what, status, category FROM decisions WHERE product_id = ? AND decided_at > datetime('now', '-30 days')", [productId]),
    query("SELECT competitor_name, signal_summary, significance FROM competitive_signals WHERE product_id = ? AND detected_at > datetime('now', '-30 days')", [productId]),
  ]);

  const p = product.rows[0] as Record<string, string> | undefined;
  const m = metrics.rows as unknown as Array<Record<string, unknown>>;
  const latestMRR = m[0] ? (((m[0].new_mrr_cents as number) ?? 0) + ((m[0].expansion_mrr_cents as number) ?? 0)) / 100 : 0;

  const prompt = `Generate a professional monthly investor update email.

Product: ${p?.name ?? 'Unknown'}
Current MRR: $${latestMRR.toFixed(0)}
Growth stage: ${p?.growth_stage ?? 'growth'}
${founderHighlight ? `Founder highlight: ${founderHighlight}` : ''}

Metrics (last 4 periods): ${JSON.stringify(m.map((r) => ({
  date: r.snapshot_date, mrr: ((r.new_mrr_cents as number) ?? 0) / 100,
  users: r.active_users, churn: r.churn_rate,
})))}

Active stressors: ${(stressors.rows as unknown as Array<Record<string, string>>).map((s) => s.stressor_name).join(', ') || 'None'}

Key decisions: ${(decisions.rows as unknown as Array<Record<string, string>>).map((d) => `${d.what} (${d.status})`).join(', ') || 'None'}

Competitive signals: ${(competitive.rows as unknown as Array<Record<string, string>>).map((c) => `${c.competitor_name}: ${c.signal_summary}`).join('; ') || 'None'}

Format: Subject line, then structured update with: Highlights, Key Metrics, Challenges, Next Month Focus, Ask (if any).
Be concise and professional. Investors want signal, not noise.`;

  const response = await callOpus(
    'You are writing a monthly investor update for a SaaS founder. Professional, data-driven, concise.',
    prompt,
    2048,
    productId
  );

  const period = new Date().toISOString().slice(0, 7);
  const id = nanoid();

  await query(
    `INSERT INTO investor_updates (id, product_id, owner_id, period, subject, content, metrics_snapshot, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [id, productId, ownerId, period, `${p?.name} — ${period} Update`, response.content, JSON.stringify(m)]
  );

  return { id, content: response.content };
}

/**
 * Generate board deck slides from product data.
 */
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
