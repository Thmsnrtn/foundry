// =============================================================================
// FOUNDRY — Competitive Intelligence 2.0
// Extends competitive.ts with platform dependency, incumbent response,
// moat erosion, switching cost analysis, and market migration detection.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet, parseJSONResponse } from '../ai/client.js';

// ─── What these estimates are made of ────────────────────────────────────────
//
// Four of the functions below were given nothing but the product's NAME and its
// SECTOR, asked a model for numbers, and returned those numbers as analysis to a
// paying investor-layer endpoint. A moat strength of 62, an erosion rate of
// 0.04/month, a switching-cost ratio — about a company the model had never seen
// a single figure from.
//
// The numbers are not removed, because an estimate is a legitimate thing to
// offer. What is removed is the silence about what they are made of. Every one
// now carries `estimated_from`, in the same shape and with the same word as
// `Forecast.projected_from` in services/founder/intelligence.ts: what went in,
// and whether any of it was measured.
//
// `measured: false` means no figure from this company reached the estimate. A
// reader who wants to know whether to act on a number can now find out, and a
// reader who does not look is no worse off than before.
//
// The not-found branches used to be the worst of it: a product that does not
// exist got `risk_score: 0` (no risk), `moat_strength: 0`, and a switching-cost
// ratio of exactly 1 with portability and depth of 50. Reassurance and midpoints
// invented about nothing. They return nulls now.

/** What an estimate was made from. Mirrors `Forecast.projected_from`. */
export interface EstimateBasis {
  /** The company facts that reached the model. Empty means none did. */
  inputs: string[];
  /** True only when at least one measured company figure is among the inputs. */
  measured: boolean;
}

/** Nothing about this company reached the model beyond what the founder typed. */
const FROM_DESCRIPTION_ONLY = (fields: string[]): EstimateBasis => ({
  inputs: fields, measured: false,
});

/**
 * Model incumbent response probability and form.
 */
export async function modelIncumbentResponse(
  productId: string,
  competitorId: string
): Promise<{
  probability: number | null;
  timeline_months: number | null;
  likely_response: string;
  our_counter: string;
  estimated_from: EstimateBasis;
}> {
  const product = await query('SELECT name, market_category, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const competitor = await query('SELECT * FROM competitors WHERE id = ? AND product_id = ?', [competitorId, productId]);
  const c = competitor.rows[0] as Record<string, string> | undefined;
  // A probability of 0 said the incumbent will certainly not respond. That is
  // the most reassuring answer available, returned when we know nothing.
  if (!p || !c) {
    return { probability: null, timeline_months: null, likely_response: '', our_counter: '',
             estimated_from: { inputs: [], measured: false } };
  }

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

  return {
    ...result,
    // The competitor record is company-specific and founder-entered. That is
    // more than a category guess and less than a measurement, and the field
    // says which.
    estimated_from: {
      inputs: ['product name', 'sector', 'competitor record (as entered by the founder)'],
      measured: false,
    },
  };
}

/**
 * Assess platform dependency risk.
 */
export async function assessPlatformDependency(productId: string): Promise<{
  risk_score: number | null;
  dependencies: Array<{ platform: string; risk: string; mitigation: string }>;
  estimated_from: EstimateBasis;
}> {
  const product = await query('SELECT name, stack_description, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  // A risk score of 0 for a product we cannot find said "no platform risk".
  if (!p) return { risk_score: null, dependencies: [], estimated_from: { inputs: [], measured: false } };

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

  const parsed = parseJSONResponse<{
    risk_score: number;
    dependencies: Array<{ platform: string; risk: string; mitigation: string }>;
  }>(response.content);
  return {
    ...parsed,
    estimated_from: FROM_DESCRIPTION_ONLY(
      ['product name', 'sector', p.stack_description ? 'stack description (as written by the founder)' : 'no stack description on file']),
  };
}

/**
 * Assess technology moat erosion rate.
 */
export async function assessTechnologyMoat(productId: string): Promise<{
  moat_strength: number | null;
  erosion_rate: number | null;
  threats: string[];
  reinforcement_opportunities: string[];
  estimated_from: EstimateBasis;
}> {
  const product = await query('SELECT name, stack_description, sector_profile, market_category FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) {
    return { moat_strength: null, erosion_rate: null, threats: [],
             reinforcement_opportunities: [], estimated_from: { inputs: [], measured: false } };
  }

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

  const parsed = parseJSONResponse<{
    moat_strength: number;
    erosion_rate: number;
    threats: string[];
    reinforcement_opportunities: string[];
  }>(response.content);
  return {
    ...parsed,
    estimated_from: FROM_DESCRIPTION_ONLY(['product name', 'sector', 'market category']),
  };
}

/**
 * Analyze switching costs to/from the product vs competitors.
 */
export async function analyzeSwitchingCosts(productId: string): Promise<{
  cost_to_leave_us: number | null;
  cost_to_leave_incumbent: number | null;
  /** Null when the incumbent cost is zero or unknown — a ratio over nothing. */
  switching_cost_ratio: number | null;
  data_portability_score: number | null;
  integration_depth_score: number | null;
  estimated_from: EstimateBasis;
}> {
  const product = await query('SELECT name, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) {
    return { cost_to_leave_us: null, cost_to_leave_incumbent: null, switching_cost_ratio: null,
             data_portability_score: null, integration_depth_score: null,
             estimated_from: { inputs: [], measured: false } };
  }

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

  // A ratio of 1 means "exactly as costly to leave us as to leave the incumbent"
  // — a striking claim, and it was what a zero denominator produced.
  const ratio = result.cost_to_leave_incumbent > 0
    ? result.cost_to_leave_us / result.cost_to_leave_incumbent
    : null;

  // The row that used to be written here went into `switching_cost_analysis`,
  // which nothing has ever read; the route returns these values to its caller.
  // Retired in migration 187 rather than given an invented reader.
  return {
    ...result,
    switching_cost_ratio: ratio,
    estimated_from: FROM_DESCRIPTION_ONLY(['product name', 'sector']),
  };
}

/**
 * A MODEL'S READING OF THE CATEGORY, NOT A DETECTION.
 *
 * This was `detectMarketMigration`, returning `migration_detected: boolean`.
 * Both words claimed that Foundry had observed a structural shift in the
 * customer's market. It had observed nothing: it asked a model, given the
 * product's name, sector and market category, whether such a shift was
 * happening, and reported the answer as a detection. Downstream, the strategy
 * brief passed `'None detected'` to a second model when the first said no —
 * turning "we did not ask anything that could find out" into a negative finding.
 *
 * Competitive facts that were actually observed live in `competitive_signals`,
 * and the brief reads those separately. This is kept, because a strategist's
 * read on a category is worth having, and renamed, because it is not evidence.
 */
export async function assessMarketShift(productId: string): Promise<{
  /** The model's judgement from the category alone. Not an observation. */
  shift_indicated: boolean;
  description: string | null;
  recommended_response: string | null;
  estimated_from: EstimateBasis;
}> {
  const product = await query('SELECT name, market_category, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) {
    return { shift_indicated: false, description: null, recommended_response: null,
             estimated_from: { inputs: [], measured: false } };
  }

  const prompt = `Assess whether the target market for this product is undergoing a structural migration.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market: ${p.market_category ?? 'general'}

Market migrations: hotels\u2192STRs, retail\u2192e-commerce, on-prem\u2192cloud, manual\u2192automated, etc.

You are reasoning from the category alone. No data about this company or its
market has been given to you. Say so in the description rather than implying
observation.

Return JSON:
{"shift_indicated": boolean, "description": "..." or null, "recommended_response": "..." or null}`;

  const response = await callSonnet(
    'You are a market dynamics analyst. Identify structural market shifts.',
    prompt,
    1024, productId
  );

  const parsed = parseJSONResponse<{
    shift_indicated: boolean;
    description: string | null;
    recommended_response: string | null;
  }>(response.content);

  return {
    ...parsed,
    estimated_from: FROM_DESCRIPTION_ONLY(['product name', 'sector', 'market category']),
  };
}

/**
 * Generate comprehensive competitive strategy brief.
 */
export async function generateCompetitiveStrategyBrief(productId: string): Promise<string> {
  const { measured, ratePoints } = await import('../ai/measured.js');
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
  const shift = await assessMarketShift(productId);

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

The three lines below are a model's estimates from this product's description.
No figure from this company went into them. Treat them as one analyst's opinion,
say so where you rely on them, and do not restate them as measurements:
Moat strength: ${measured(moat.moat_strength)}/100, erosion rate: ${ratePoints(moat.erosion_rate)}/month
Platform risk: ${measured(platform.risk_score)}/100
Market shift (judged from the category alone, not observed): ${
  shift.shift_indicated && shift.description
    ? shift.description
    : 'the analyst saw no structural shift in this category — nothing was measured either way'}

The competitors and signals above ARE observed: they are what this company and
its watchers actually recorded. Weight them accordingly.

Write a strategic brief (500-800 words) with specific recommendations.`;

  const response = await callOpus(
    'You are a competitive strategist writing a strategic brief for a SaaS founder.',
    prompt,
    4096, productId
  );

  return response.content;
}
