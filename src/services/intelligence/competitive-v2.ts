// =============================================================================
// FOUNDRY — Competitive Intelligence 2.0
// Extends competitive.ts with platform dependency, incumbent response,
// moat erosion, switching cost analysis, and market migration detection.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

/**
 * Model incumbent response probability and form.
 */
export async function modelIncumbentResponse(
  productId: string,
  competitorId: string
): Promise<{
  probability: number;
  timeline_months: number;
  likely_response: string;
  our_counter: string;
}> {
  const product = await query('SELECT name, market_category, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const competitor = await query('SELECT * FROM competitors WHERE id = ? AND product_id = ?', [competitorId, productId]);
  const c = competitor.rows[0] as Record<string, string> | undefined;
  if (!p || !c) return { probability: 0, timeline_months: 0, likely_response: '', our_counter: '' };

  const prompt = `Model the incumbent's likely competitive response.

Our product: ${p.name} (${p.sector_profile})
Incumbent: ${c.name} — ${c.positioning ?? 'unknown positioning'}
Their pricing: ${c.pricing_model ?? 'unknown'}
Their known weaknesses: ${c.known_weaknesses ?? 'unknown'}

Return JSON:
{"probability": 0.0-1.0, "timeline_months": N, "likely_response": "description", "our_counter": "recommended counter-strategy"}`;

  const response = await callOpus(
    'You are a competitive strategist. Model probable competitive responses based on market dynamics.',
    prompt,
    1024, productId
  );

  const result = parseJSONResponse<{
    probability: number;
    timeline_months: number;
    likely_response: string;
    our_counter: string;
  }>(response.content);

  // Update competitor record
  await query(
    'UPDATE competitors SET incumbent_response_probability = ? WHERE id = ?',
    [result.probability, competitorId]
  );

  return result;
}

/**
 * Assess platform dependency risk.
 */
export async function assessPlatformDependency(productId: string): Promise<{
  risk_score: number;
  dependencies: Array<{ platform: string; risk: string; mitigation: string }>;
}> {
  const product = await query('SELECT name, stack_description, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return { risk_score: 0, dependencies: [] };

  const prompt = `Assess platform dependency risk for this SaaS product.

Product: ${p.name}
Stack: ${p.stack_description ?? 'unknown'}
Sector: ${p.sector_profile ?? 'b2b_saas'}

Identify dependencies on platforms/APIs that could change terms, deprecate features, or compete directly.

Return JSON:
{"risk_score": 0-100, "dependencies": [{"platform": "...", "risk": "...", "mitigation": "..."}]}`;

  const response = await callSonnet(
    'You are a platform risk analyst for SaaS products.',
    prompt,
    2048, productId
  );

  return parseJSONResponse<{
    risk_score: number;
    dependencies: Array<{ platform: string; risk: string; mitigation: string }>;
  }>(response.content);
}

/**
 * Assess technology moat erosion rate.
 */
export async function assessTechnologyMoat(productId: string): Promise<{
  moat_strength: number;
  erosion_rate: number;
  threats: string[];
  reinforcement_opportunities: string[];
}> {
  const product = await query('SELECT name, stack_description, sector_profile, market_category FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return { moat_strength: 0, erosion_rate: 0, threats: [], reinforcement_opportunities: [] };

  const prompt = `Evaluate the technology moat for this product and how fast it's eroding.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market: ${p.market_category ?? 'general'}

Consider: AI/foundation model improvements, open-source alternatives, incumbent R&D, commoditization trends.

Return JSON:
{"moat_strength": 0-100, "erosion_rate": 0.0-1.0 (monthly % decline), "threats": ["..."], "reinforcement_opportunities": ["..."]}`;

  const response = await callOpus(
    'You are a technology moat analyst. Evaluate defensibility and erosion trends.',
    prompt,
    2048, productId
  );

  return parseJSONResponse<{
    moat_strength: number;
    erosion_rate: number;
    threats: string[];
    reinforcement_opportunities: string[];
  }>(response.content);
}

/**
 * Analyze switching costs to/from the product vs competitors.
 */
export async function analyzeSwitchingCosts(productId: string, ownerId: string): Promise<{
  cost_to_leave_us: number;
  cost_to_leave_incumbent: number;
  switching_cost_ratio: number;
  data_portability_score: number;
  integration_depth_score: number;
}> {
  const product = await query('SELECT name, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return { cost_to_leave_us: 0, cost_to_leave_incumbent: 0, switching_cost_ratio: 1, data_portability_score: 50, integration_depth_score: 50 };

  const prompt = `Estimate switching costs for this SaaS product.

Product: ${p.name} (${p.sector_profile ?? 'b2b_saas'})

Estimate in hours of customer effort:
1. Cost for a customer to leave our product for a competitor
2. Cost for a customer to leave the incumbent for us
3. Data portability (0-100: how easy to export/import)
4. Integration depth (0-100: how embedded in customer workflow)

Return JSON:
{"cost_to_leave_us": hours, "cost_to_leave_incumbent": hours, "data_portability_score": 0-100, "integration_depth_score": 0-100}`;

  const response = await callSonnet(
    'You are a switching cost analyst for SaaS products.',
    prompt,
    1024, productId
  );

  const result = parseJSONResponse<{
    cost_to_leave_us: number;
    cost_to_leave_incumbent: number;
    data_portability_score: number;
    integration_depth_score: number;
  }>(response.content);

  const ratio = result.cost_to_leave_incumbent > 0
    ? result.cost_to_leave_us / result.cost_to_leave_incumbent
    : 1;

  // Persist
  await query(
    `INSERT INTO switching_cost_analysis (id, product_id, owner_id, cost_to_leave_us, cost_to_leave_incumbent, switching_cost_ratio, data_portability_score, integration_depth_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), productId, ownerId, result.cost_to_leave_us, result.cost_to_leave_incumbent, ratio, result.data_portability_score, result.integration_depth_score]
  );

  return { ...result, switching_cost_ratio: ratio };
}

/**
 * Detect market migration: when the customer segment itself is shifting.
 */
export async function detectMarketMigration(productId: string): Promise<{
  migration_detected: boolean;
  description: string | null;
  recommended_response: string | null;
}> {
  const product = await query('SELECT name, market_category, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return { migration_detected: false, description: null, recommended_response: null };

  const prompt = `Detect if the target market for this product is undergoing a structural migration.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market: ${p.market_category ?? 'general'}

Market migrations: hotels→STRs, retail→e-commerce, on-prem→cloud, manual→automated, etc.

Return JSON:
{"migration_detected": boolean, "description": "..." or null, "recommended_response": "..." or null}`;

  const response = await callSonnet(
    'You are a market dynamics analyst. Identify structural market shifts.',
    prompt,
    1024, productId
  );

  return parseJSONResponse<{
    migration_detected: boolean;
    description: string | null;
    recommended_response: string | null;
  }>(response.content);
}

/**
 * Generate comprehensive competitive strategy brief.
 */
export async function generateCompetitiveStrategyBrief(productId: string): Promise<string> {
  const product = await query('SELECT name, market_category, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return 'No product found.';

  const competitors = await query('SELECT * FROM competitors WHERE product_id = ?', [productId]);
  const signals = await query(
    `SELECT * FROM competitive_signals WHERE product_id = ? AND detected_at > datetime('now', '-30 days') ORDER BY significance DESC LIMIT 10`,
    [productId]
  );

  const moat = await assessTechnologyMoat(productId);
  const platform = await assessPlatformDependency(productId);
  const migration = await detectMarketMigration(productId);

  const prompt = `Generate a comprehensive competitive strategy brief.

Product: ${p.name} (${p.sector_profile})
Market: ${p.market_category ?? 'general'}

Competitors:
${(competitors.rows as unknown as Array<Record<string, string>>).map((c) =>
  `- ${c.name}: ${c.positioning ?? 'unknown'}`
).join('\n')}

Recent signals:
${(signals.rows as unknown as Array<Record<string, string>>).map((s) =>
  `- [${s.significance}] ${s.competitor_name}: ${s.signal_summary}`
).join('\n') || 'None'}

Moat strength: ${moat.moat_strength}/100, erosion rate: ${(moat.erosion_rate * 100).toFixed(1)}%/month
Platform risk: ${platform.risk_score}/100
Market migration: ${migration.migration_detected ? migration.description : 'None detected'}

Write a strategic brief (500-800 words) with specific recommendations.`;

  const response = await callOpus(
    'You are a competitive strategist writing a strategic brief for a SaaS founder.',
    prompt,
    4096, productId
  );

  return response.content;
}
