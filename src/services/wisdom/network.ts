// =============================================================================
// FOUNDRY — Cross-Product Wisdom Network
// Aggregates anonymized patterns from opted-in products.
//
// Two floors, and they are not the same number. A sector/stage cohort must
// hold MIN_SAMPLE_SIZE opted-in companies before it is aggregated at all; a
// published pattern must stand on MIN_CONTRIBUTORS distinct companies. Both
// are eligibility floors chosen so that no single company's decisions can be
// shown to its competitors. Neither is a sample size drawn to support
// inference, and nothing here may present them as one.
// =============================================================================

import { createHmac } from 'crypto';

import { query } from '../../db/client.js';
import { callOpus, institutionSpend, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

/**
 * A pattern observed across companies, and — separately — what a model made of
 * it.
 *
 * The two halves used to be one flat bag of numbers whose names all read as
 * measurements: `confidence`, `avg_impact`, `sample_size`. Only the last was
 * counted. `confidence` and `avg_impact` are values the analysis model wrote
 * into its JSON, and they were rendered to a founder as "80% confidence, avg
 * impact +12%" — a statistic-shaped presentation of an estimate.
 *
 * So the fields say which they are, and the provenance that was already being
 * recorded travels with them instead of stopping at the table.
 */
export interface CrossProductInsight {
  id: string;
  sector: string;
  growth_stage: string;
  insight_type: string;
  description: string;
  /** DISTINCT contributing companies — the unit, named. Not rows, not cohort. */
  contributing_companies: number;
  /** The model's own stated confidence in its reading. Not a confidence
   * interval, not a p-value, not derived from the sample at all. */
  model_confidence: number;
  /** The model's estimate of impact, in percent. Not a measured average. */
  estimated_impact_pct: number;
  conditions: Record<string, unknown> | null;
  /** How the aggregation was done, stamped at write time. Null for rows
   * written before migration 146. */
  provenance: Record<string, unknown> | null;
  /** The last decision date behind the claim. What makes it current or stale. */
  observed_through: string | null;
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
        // WHAT THIS CLOCK IS. `decision_patterns` carries one timestamp,
        // `created_at`, and it is when the pattern row was WRITTEN — which for
        // a decision outcome is when the outcome was scored, not when the
        // decision was taken. So the freshness window bounds how long ago the
        // institution learned this, not how long ago it happened. The
        // difference is a scoring lag rather than years, but a window named
        // for observation and measured on recording is the kind of thing that
        // stops being close enough the moment somebody backfills.
        measures: 'when the pattern was recorded, not when the decision was taken',
        first_recorded: patternRows.map((r) => String(r.first_observed ?? '')).sort()[0] ?? null,
        last_recorded: observedThrough,
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

Describe 1-3 patterns these rows actually show. Each one must:
1. Be supported by at least 3 of the rows above
2. Describe something a founder in this sector/stage could act on
3. Carry your own estimate of impact, and your own confidence in that estimate

${contributorCount} companies is an eligibility floor, not a sample drawn to
support inference. Do not describe anything below as statistically significant,
proven, validated, a consensus, or what the market does — you have not been
given the data to support any of those words, and a founder will act on this.
Say what these companies did and what it looks like it was worth.

Return JSON array:
[{"insight_type": "retention_tactic|pricing_strategy|acquisition_channel|churn_reduction|onboarding_pattern", "description": "...", "confidence": 0.0-1.0, "avg_impact": percentage_improvement, "conditions": {"when": "..."}}]

Return an empty array if the rows show no pattern worth describing.`;

    const response = await callOpus(
      'You are a cross-product pattern analyst reading a small number of anonymized companies. Report what they did. Do not claim significance, proof, or consensus.',
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
    `SELECT id, sector, growth_stage, insight_type, description, sample_size,
            confidence, avg_impact, conditions, provenance_json, observed_through
       FROM cross_product_insights
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
    // The column names are the old ones; what they hold has not changed. What
    // changed is that a reader can no longer take `confidence` for a statistic
    // or `avg_impact` for a measurement, because neither word reaches them.
    contributing_companies: Number(row.sample_size),
    model_confidence: Number(row.confidence),
    estimated_impact_pct: Number(row.avg_impact),
    conditions: row.conditions ? JSON.parse(row.conditions as string) : null,
    provenance: row.provenance_json
      ? JSON.parse(row.provenance_json as string) as Record<string, unknown>
      : null,
    observed_through: (row.observed_through as string | null) ?? null,
  }));
}

/**
 * Inject network wisdom into a context string for AI prompts.
 */
export async function injectNetworkWisdom(context: string, productId: string): Promise<string> {
  const insights = await getRelevantInsights(productId);
  if (insights.length === 0) return context;

  // WHAT THIS LINE USED TO SAY: "[Network insight, 3 contributing companies,
  // 90% confidence]: ... (avg impact: +12%)". Every part of that framing was a
  // promotion. "Network insight" is a finding; this is a pattern. "90%
  // confidence" is a statistic; this is the analysis model's own number.
  // "avg impact" is a measured mean; this is that model's estimate. The
  // downstream model reads it as evidence and reasons about a founder's
  // company from it, so the labels have to survive the trip.
  const wisdomSection = insights.map((i) =>
    `[Peer pattern — ${i.contributing_companies} contributing companies, an eligibility floor rather than a sample]: `
    + `${i.description} (model's own confidence ${(i.model_confidence * 100).toFixed(0)}%; `
    + `impact ESTIMATED at ${i.estimated_impact_pct > 0 ? '+' : ''}${i.estimated_impact_pct.toFixed(0)}%, not measured)`
  ).join('\n');

  return context
    + '\n\n--- PATTERNS FROM OTHER COMPANIES (not evidence about this one) ---\n'
    + wisdomSection;
}

