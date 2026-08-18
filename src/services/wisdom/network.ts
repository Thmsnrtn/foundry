// =============================================================================
// FOUNDRY — Cross-Product Wisdom Network
// Aggregates anonymized insights from opted-in products.
// Privacy guarantee: no individual product data surfaces. Min sample size = 10.
// =============================================================================

import { createHmac } from 'crypto';

import { query } from '../../db/client.js';
import { callOpus, institutionSpend, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

export interface CrossProductInsight {
  id: string;
  sector: string;
  growth_stage: string;
  insight_type: string;
  description: string;
  sample_size: number;
  confidence: number;
  avg_impact: number;
  conditions: Record<string, unknown> | null;
}

const MIN_SAMPLE_SIZE = 10;

/**
 * How many DISTINCT companies must be behind an insight before it is published
 * to any of their competitors.
 *
 * `MIN_SAMPLE_SIZE` above gates the COHORT — how many opted-in companies exist
 * in a sector and stage. It never gated the insight. The patterns feeding one
 * were selected with `HAVING cnt >= 3`, three ROWS, which a single company
 * making three similar decisions satisfies on its own. So an insight derived
 * from one company was published to that company's competitors, in a file whose
 * header promises "no individual product data surfaces".
 */
export const MIN_CONTRIBUTORS = 3;

/** How the aggregation was done. Stamped on every insight so a row can be read
 * against the method that produced it — the contributor count and the cohort
 * count were the same field once, and nothing recorded which one a given row
 * meant. */
export const AGGREGATION_METHOD_VERSION = 'contributor-counted/v2';

/** How old the underlying decisions may be and still be called a peer signal.
 * A row existing is not the same as a claim being current, and an insight drawn
 * from decisions two years old should not be injected into a prompt as though
 * it described the market now. */
export const INSIGHT_FRESHNESS_DAYS = 365;

/**
 * A stable, non-reversible identity for a contributing company.
 *
 * `decision_patterns` carries no product_id on purpose, and that cost the
 * aggregation the ability to tell three companies from one. This gives it back
 * exactly the property it needs — distinctness — and nothing more: an HMAC
 * keyed with the application secret, so a leaked table cannot be walked back to
 * product ids by guessing them.
 */
export function contributorHash(productId: string): string {
  const key = process.env.ENCRYPTION_KEY ?? 'foundry-dev-contributor-key';
  return createHmac('sha256', key).update(`decision_pattern:${productId}`).digest('hex').slice(0, 32);
}

/**
 * Weekly aggregation: analyze anonymized decision patterns + outcomes across opted-in products.
 */
export async function aggregateInsights(): Promise<number> {
  // Count opted-in products by sector and stage
  const optedIn = await query(
    `SELECT p.sector_profile, p.growth_stage, COUNT(*) as cnt
     FROM products p
     JOIN founders f ON p.owner_id = f.id
     WHERE f.wisdom_network_opted_in = 1 AND p.status = 'active'
     GROUP BY p.sector_profile, p.growth_stage
     HAVING cnt >= ?`,
    [MIN_SAMPLE_SIZE]
  );

  let insightsGenerated = 0;

  for (const row of optedIn.rows as unknown as Array<Record<string, unknown>>) {
    const sector = row.sector_profile as string;
    const stage = row.growth_stage as string;
    const sampleSize = row.cnt as number;

    // Get anonymized decision patterns for this cohort.
    //
    // COUNT(DISTINCT contributor_hash), not COUNT(*): the threshold is about
    // how many COMPANIES are behind a pattern, and counting rows let one
    // company satisfy it alone. NULL hashes — rows written before migration 144
    // — are ignored by COUNT(DISTINCT), so legacy patterns count toward nobody
    // and an insight that needs them is not published. Fail-closed: the
    // alternative is publishing insights whose provenance is unknown.
    const patterns = await query(
      `SELECT dp.decision_type, dp.option_chosen_category, dp.outcome_direction,
              dp.outcome_magnitude, COUNT(*) as cnt,
              COUNT(DISTINCT dp.contributor_hash) as contributors,
              MIN(dp.created_at) as first_observed, MAX(dp.created_at) as last_observed
       FROM decision_patterns dp
       WHERE dp.market_category = ? AND dp.product_lifecycle_stage = ?
       AND dp.outcome_direction IS NOT NULL
       GROUP BY dp.decision_type, dp.option_chosen_category, dp.outcome_direction, dp.outcome_magnitude
       HAVING cnt >= 3 AND contributors >= ?`,
      [sector, stage, MIN_CONTRIBUTORS]
    );

    if (patterns.rows.length === 0) continue;

    // How many companies are actually behind this insight. This is the number
    // that gets published and printed into other founders' prompts — see
    // `injectNetworkWisdom` — so it has to be the number that was measured, not
    // the size of the cohort the patterns were drawn from.
    const patternRows = patterns.rows as unknown as Array<Record<string, unknown>>;
    const contributorCount = Math.min(...patternRows.map((r) => Number(r.contributors)));

    // What a reader would need to reconstruct this claim. Recorded because the
    // claim crosses a tenant boundary: it is derived from several companies and
    // shown to another, and "12 contributing companies" was already wrong once
    // — invisibly, because nothing on the row could be checked.
    //
    // No company identities: the hashes are counted, never listed.
    const observedThrough = patternRows
      .map((r) => String(r.last_observed ?? '')).sort().slice(-1)[0] ?? null;
    const provenance = {
      method: AGGREGATION_METHOD_VERSION,
      population: { sector, stage, cohort_products: sampleSize },
      unit: 'distinct contributing companies',
      distinct_contributors: contributorCount,
      supporting_rows: patternRows.reduce((n, r) => n + Number(r.cnt), 0),
      options: patternRows.map((r) => ({
        option: String(r.option_chosen_category),
        direction: String(r.outcome_direction),
        companies: Number(r.contributors),
        rows: Number(r.cnt),
      })),
      window: {
        first_observed: patternRows.map((r) => String(r.first_observed ?? '')).sort()[0] ?? null,
        last_observed: observedThrough,
      },
      excluded: [
        'patterns with no outcome direction',
        'patterns with fewer than 3 rows or fewer than MIN_CONTRIBUTORS distinct companies',
        'rows written before migration 144, which name no contributor',
      ],
      eligibility_floor_only: true,
    };

    // Use Claude to extract insights from the aggregate data
    const prompt = `Analyze these anonymized decision patterns. They come from at least ${contributorCount} contributing companies in the ${sector} sector at ${stage} stage, drawn from a cohort of ${sampleSize}.

Patterns:
${(patterns.rows as unknown as Array<Record<string, unknown>>).map((p) =>
  `- ${p.decision_type} → chose ${p.option_chosen_category}: ${p.outcome_direction} (${p.outcome_magnitude}) × ${p.cnt}`
).join('\n')}

Extract 1-3 statistically significant insights. Each insight must:
1. Be derived from at least 3 data points
2. Describe a pattern that would help a founder in this sector/stage
3. Include estimated impact

Return JSON array:
[{"insight_type": "retention_tactic|pricing_strategy|acquisition_channel|churn_reduction|onboarding_pattern", "description": "...", "confidence": 0.0-1.0, "avg_impact": percentage_improvement, "conditions": {"when": "..."}}]

Return empty array if no significant patterns emerge.`;

    const response = await callOpus(
      'You are a cross-product pattern analyst. Only surface statistically significant insights.',
      prompt,
      2048,
      // Institutional, and declared rather than omitted. Naming any single
      // contributor here would be a lie about who incurred the cost, and
      // leaving the argument off would make this indistinguishable from the
      // fifty-five call sites that had simply forgotten.
      institutionSpend('cross-company pattern aggregation: the cost belongs to no single contributor'),
    );

    const insights = parseJSONResponse<Array<{
      insight_type: string;
      description: string;
      confidence: number;
      avg_impact: number;
      conditions: Record<string, unknown> | null;
    }>>(response.content);

    for (const insight of insights) {
      await query(
        `INSERT INTO cross_product_insights (id, sector, growth_stage, insight_type, description, sample_size, confidence, avg_impact, conditions, provenance_json, observed_through)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nanoid(), sector, stage, insight.insight_type,
          // The contributing companies, not the cohort. What a founder is shown
          // has to be what was counted.
          insight.description, contributorCount, insight.confidence,
          insight.avg_impact, insight.conditions ? JSON.stringify(insight.conditions) : null,
          JSON.stringify(provenance), observedThrough,
        ]
      );
      insightsGenerated++;
    }
  }

  return insightsGenerated;
}

/**
 * Get insights relevant to a specific product's sector, stage, and challenges.
 */
export async function getRelevantInsights(productId: string): Promise<CrossProductInsight[]> {
  const product = await query('SELECT sector_profile, growth_stage FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return [];

  const result = await query(
    `SELECT * FROM cross_product_insights
     WHERE sector = ? AND growth_stage = ? AND sample_size >= ?
       -- A row existing is not a claim being current. An insight drawn from
       -- decisions a year old describes a market that has moved, and injecting
       -- it into a prompt as a peer signal presents age as evidence.
       AND (observed_through IS NULL
            OR datetime(observed_through) > datetime('now', ?))
     ORDER BY confidence DESC, avg_impact DESC
     LIMIT 5`,
    // `sample_size` now means contributing companies, so the floor is the
    // contributor threshold. Reading it against MIN_SAMPLE_SIZE would silently
    // hide every insight written after this change.
    [p.sector_profile ?? 'b2b_saas', p.growth_stage ?? 'growth', MIN_CONTRIBUTORS,
      `-${INSIGHT_FRESHNESS_DAYS} days`]
  );

  return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    sector: row.sector as string,
    growth_stage: row.growth_stage as string,
    insight_type: row.insight_type as string,
    description: row.description as string,
    sample_size: row.sample_size as number,
    confidence: row.confidence as number,
    avg_impact: row.avg_impact as number,
    conditions: row.conditions ? JSON.parse(row.conditions as string) : null,
  }));
}

/**
 * Inject network wisdom into a context string for AI prompts.
 */
export async function injectNetworkWisdom(context: string, productId: string): Promise<string> {
  const insights = await getRelevantInsights(productId);
  if (insights.length === 0) return context;

  const wisdomSection = insights.map((i) =>
    `[Network insight, ${i.sample_size} contributing companies, ${(i.confidence * 100).toFixed(0)}% confidence]: ${i.description} (avg impact: ${i.avg_impact > 0 ? '+' : ''}${i.avg_impact.toFixed(0)}%)`
  ).join('\n');

  return context + '\n\n--- CROSS-PRODUCT WISDOM ---\n' + wisdomSection;
}

/**
 * Compute statistical confidence for an insight.
 */
export function computeInsightConfidence(
  sampleSize: number,
  effectConsistency: number // 0-1: how consistent the effect is across products
): number {
  // Simple confidence model: sample size + consistency
  const sizeFactor = Math.min(1, sampleSize / 50); // Max out at 50 products
  return Math.round((sizeFactor * 0.5 + effectConsistency * 0.5) * 100) / 100;
}
