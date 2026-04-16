// =============================================================================
// FOUNDRY — Network Intelligence: Cohort Patterns
// Derives cohort profiles from product data and surfaces collective intelligence
// — patterns no single company could see on its own.
// =============================================================================

import { query } from '../../db/client.js';
import { getProductDNA } from '../wisdom/dna.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CohortProfile {
  business_model: 'b2b_saas' | 'b2c' | 'marketplace' | 'api' | 'other';
  stage: 'pre_seed' | 'seed' | 'series_a' | 'series_b';
  mrr_bucket: '<5k' | '5k-25k' | '25k-100k' | '100k+';
  team_size_bucket: '1-3' | '4-10' | '11-25' | '25+';
}

export interface CohortPatternRow {
  id: string;
  cohort_key: string;
  cohort_definition_json: string;
  pattern_type: string;
  pattern_name: string;
  pattern_description: string;
  supporting_data_json: string | null;
  confidence: number;
  company_count: number;
  computed_at: string;
}

export interface CohortBenchmarkRow {
  metric: string;
  your_value: number | null;
  cohort_p25: number;
  cohort_median: number;
  cohort_p75: number;
  your_percentile: number | null;
  trend: 'improving' | 'declining' | 'stable';
  cohort_insight: string;
}

// ─── Cohort Profile Derivation ────────────────────────────────────────────────

/**
 * Derives a cohort profile from a product's DNA fields and latest metrics.
 * Falls back to sensible defaults when data is sparse.
 */
export async function getProductCohortProfile(productId: string): Promise<CohortProfile> {
  const [productResult, snapshotResult, contributionResult] = await Promise.all([
    query(
      `SELECT p.market_category, p.stack_description,
              ls.current_prompt, ls.prompt_2_5_tier
       FROM products p
       LEFT JOIN lifecycle_state ls ON ls.product_id = p.id
       WHERE p.id = ?`,
      [productId],
    ),
    query(
      `SELECT new_mrr_cents FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
      [productId],
    ),
    query(
      `SELECT team_size_bucket FROM benchmark_contributions WHERE product_id = ? ORDER BY contributed_at DESC LIMIT 1`,
      [productId],
    ),
  ]);

  const product = productResult.rows[0] as Record<string, unknown> | undefined;
  const snapshot = snapshotResult.rows[0] as Record<string, unknown> | undefined;
  const contribution = contributionResult.rows[0] as Record<string, unknown> | undefined;

  // ── Business model ──
  let business_model: CohortProfile['business_model'] = 'b2b_saas';
  const category = (product?.market_category as string | null) ?? '';
  if (category.includes('b2c') || category.includes('consumer')) {
    business_model = 'b2c';
  } else if (category.includes('marketplace')) {
    business_model = 'marketplace';
  } else if (category.includes('api') || category.includes('developer')) {
    business_model = 'api';
  } else if (category && !category.includes('saas')) {
    business_model = 'other';
  }

  // ── Stage from lifecycle prompt ──
  const prompt = (product?.current_prompt as string | null) ?? 'prompt_1';
  const tier = (product?.prompt_2_5_tier as number | null) ?? 0;
  let stage: CohortProfile['stage'] = 'pre_seed';
  if (prompt === 'prompt_1') stage = 'pre_seed';
  else if (prompt === 'prompt_2' || prompt === 'prompt_2_5' || tier <= 1) stage = 'seed';
  else if (prompt === 'prompt_3' || prompt === 'prompt_4') stage = 'series_a';
  else stage = 'series_b';

  // ── MRR bucket ──
  const mrrCents = (snapshot?.new_mrr_cents as number | null) ?? 0;
  const mrr = mrrCents / 100;
  let mrr_bucket: CohortProfile['mrr_bucket'] = '<5k';
  if (mrr >= 100000) mrr_bucket = '100k+';
  else if (mrr >= 25000) mrr_bucket = '25k-100k';
  else if (mrr >= 5000) mrr_bucket = '5k-25k';

  // ── Team size bucket ──
  const rawTeamBucket = contribution?.team_size_bucket as string | null;
  let team_size_bucket: CohortProfile['team_size_bucket'] = '1-3';
  if (rawTeamBucket === '2-5' || rawTeamBucket === '1') team_size_bucket = '1-3';
  else if (rawTeamBucket === '6-15') team_size_bucket = '4-10';
  else if (rawTeamBucket === '16-50') team_size_bucket = '11-25';
  else if (rawTeamBucket === '50+') team_size_bucket = '25+';

  return { business_model, stage, mrr_bucket, team_size_bucket };
}

function buildCohortKey(profile: CohortProfile): string {
  return `${profile.business_model}_${profile.stage}_${profile.mrr_bucket.replace(/[<>]/g, '')}`;
}

// ─── Cohort Patterns ──────────────────────────────────────────────────────────

/**
 * Returns cohort patterns relevant to this product, with a relevance score and
 * formatted insight string.
 */
export async function getCohortPatterns(productId: string): Promise<Array<{
  pattern: CohortPatternRow;
  relevance_score: number;
  insight: string;
}>> {
  const profile = await getProductCohortProfile(productId);
  const cohortKey = buildCohortKey(profile);

  // Fetch patterns for exact cohort key or broader matches
  const result = await query(
    `SELECT * FROM cohort_patterns
     WHERE cohort_key = ? OR cohort_key LIKE ?
     ORDER BY confidence DESC, company_count DESC
     LIMIT 10`,
    [cohortKey, `${profile.business_model}_${profile.stage}%`],
  );

  const patterns = result.rows as CohortPatternRow[];

  return patterns.map((p) => {
    const exactMatch = p.cohort_key === cohortKey;
    const relevance_score = exactMatch ? Math.min(1, p.confidence * 1.2) : p.confidence * 0.75;

    const supportingData = p.supporting_data_json
      ? (JSON.parse(p.supporting_data_json) as Record<string, unknown>)
      : null;

    let insight = p.pattern_description;
    if (supportingData?.median_weeks_to_event) {
      insight += ` Typically occurs within ${supportingData.median_weeks_to_event} weeks.`;
    }
    if (p.company_count > 0) {
      insight += ` Observed across ${p.company_count} similar companies.`;
    }

    return { pattern: p, relevance_score: Math.round(relevance_score * 100) / 100, insight };
  });
}

// ─── Cohort Benchmarks ────────────────────────────────────────────────────────

const COHORT_BENCHMARK_METRICS = [
  {
    key: 'mrr_growth_rate',
    label: 'MRR Growth Rate',
    unit: '%',
    higherIsBetter: true,
    snapshotField: null, // computed below
    insight: (pct: number) =>
      pct >= 75
        ? 'Top-quartile MRR growth — sustain by investing in expansion revenue.'
        : pct >= 50
          ? 'Above-median growth. Focus on converting trial users to improve further.'
          : 'Below median. Investigate whether churn is masking new revenue gains.',
  },
  {
    key: 'churn_rate',
    label: 'Churn Rate',
    unit: '%',
    higherIsBetter: false,
    snapshotField: 'churn_rate',
    insight: (pct: number) =>
      pct >= 75
        ? 'Low churn vs. cohort — a strong moat signal. Double down on what retains users.'
        : pct >= 50
          ? 'Churn near cohort median. Review onboarding completion rates.'
          : 'Churn above cohort median. Prioritise exit interviews.',
  },
  {
    key: 'activation_rate',
    label: 'Activation Rate',
    unit: '%',
    higherIsBetter: true,
    snapshotField: 'activation_rate',
    insight: (pct: number) =>
      pct >= 75
        ? 'Strong activation. Your onboarding flow is working better than most peers.'
        : pct >= 50
          ? 'Solid activation. Small onboarding tweaks could push you into the top quartile.'
          : 'Activation below cohort. This is often the root cause of downstream churn.',
  },
  {
    key: 'nps_score',
    label: 'NPS Score',
    unit: 'pts',
    higherIsBetter: true,
    snapshotField: 'nps_score',
    insight: (pct: number) =>
      pct >= 75
        ? 'Top-quartile NPS — lean into word-of-mouth growth.'
        : pct >= 50
          ? 'NPS above median. Identify your promoters and ask for referrals.'
          : 'NPS below cohort median. Prioritise closing the gap between promises and delivery.',
  },
  {
    key: 'day_30_retention',
    label: '30-Day Retention',
    unit: '%',
    higherIsBetter: true,
    snapshotField: 'day_30_retention',
    insight: (pct: number) =>
      pct >= 75
        ? 'Excellent retention. Product-market fit signals are strong for your cohort.'
        : pct >= 50
          ? 'Retention above median. Identify the habits that keep your top users engaged.'
          : 'Retention below cohort median — often a product-market fit signal worth investigating.',
  },
] as const;

function computePercentileRank(
  yourValue: number,
  p25: number,
  p50: number,
  p75: number,
  higherIsBetter: boolean,
): number {
  if (higherIsBetter) {
    if (yourValue >= p75) return 85;
    if (yourValue >= p50) return 62;
    if (yourValue >= p25) return 37;
    return 15;
  } else {
    if (yourValue <= p25) return 85;
    if (yourValue <= p50) return 62;
    if (yourValue <= p75) return 37;
    return 15;
  }
}

/**
 * Richer benchmark data enriched with cohort context and trend direction.
 * Pulls the last 4 snapshots to compute trend.
 */
export async function getCohortBenchmarks(productId: string): Promise<CohortBenchmarkRow[]> {
  const profile = await getProductCohortProfile(productId);

  // Map profile to benchmark_contributions bucket keys
  const lcState =
    profile.stage === 'pre_seed'
      ? 'prompt_1'
      : profile.stage === 'seed'
        ? 'prompt_2'
        : profile.stage === 'series_a'
          ? 'prompt_3'
          : 'prompt_4';

  const categoryMap: Record<CohortProfile['business_model'], string> = {
    b2b_saas: 'b2b_saas',
    b2c: 'b2c_saas',
    marketplace: 'marketplace',
    api: 'developer_tools',
    other: 'other',
  };
  const companyCategory = categoryMap[profile.business_model];

  const [percentilesResult, recentSnapshotsResult] = await Promise.all([
    query(
      `SELECT metric_name, p25, p50, p75, sample_count
       FROM benchmark_percentiles
       WHERE lifecycle_state = ? AND company_category = ?
         AND metric_name IN ('churn_rate','activation_rate','nps_score','day_30_retention','mrr_growth_rate')
       ORDER BY computed_at DESC`,
      [lcState, companyCategory],
    ),
    query(
      `SELECT snapshot_date, new_mrr_cents, churn_rate, activation_rate, nps_score, day_30_retention
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 4`,
      [productId],
    ),
  ]);

  const percentilesByMetric: Record<string, { p25: number; p50: number; p75: number }> = {};
  for (const row of percentilesResult.rows as Array<Record<string, unknown>>) {
    const name = row.metric_name as string;
    if (!percentilesByMetric[name]) {
      percentilesByMetric[name] = {
        p25: row.p25 as number,
        p50: row.p50 as number,
        p75: row.p75 as number,
      };
    }
  }

  const snapshots = recentSnapshotsResult.rows as Array<Record<string, unknown>>;
  const latest = snapshots[0] ?? null;
  const oldest = snapshots[snapshots.length - 1] ?? null;

  // Compute MRR growth rate from snapshot pair
  let mrrGrowthRate: number | null = null;
  if (snapshots.length >= 2) {
    const latestMrr = (latest?.new_mrr_cents as number | null) ?? 0;
    const oldestMrr = (oldest?.new_mrr_cents as number | null) ?? 0;
    if (oldestMrr > 0) {
      mrrGrowthRate = ((latestMrr - oldestMrr) / oldestMrr) * 100;
    }
  }

  function getTrend(
    field: string,
    higherIsBetter: boolean,
  ): 'improving' | 'declining' | 'stable' {
    if (snapshots.length < 2) return 'stable';
    const latestVal = (latest?.[field] as number | null) ?? null;
    const oldestVal = (oldest?.[field] as number | null) ?? null;
    if (latestVal === null || oldestVal === null) return 'stable';
    const delta = latestVal - oldestVal;
    if (Math.abs(delta) < 0.5) return 'stable';
    if (higherIsBetter) return delta > 0 ? 'improving' : 'declining';
    return delta < 0 ? 'improving' : 'declining';
  }

  const results: CohortBenchmarkRow[] = [];

  for (const m of COHORT_BENCHMARK_METRICS) {
    const bench = percentilesByMetric[m.key];
    // Use fallback percentiles when no benchmark data exists yet
    const p25 = bench?.p25 ?? (m.higherIsBetter ? 20 : 15);
    const p50 = bench?.p50 ?? (m.higherIsBetter ? 40 : 8);
    const p75 = bench?.p75 ?? (m.higherIsBetter ? 65 : 4);

    let yourValue: number | null = null;
    if (m.key === 'mrr_growth_rate') {
      yourValue = mrrGrowthRate;
    } else if (m.snapshotField && latest) {
      yourValue = (latest[m.snapshotField] as number | null) ?? null;
    }

    const your_percentile =
      yourValue !== null
        ? computePercentileRank(yourValue, p25, p50, p75, m.higherIsBetter)
        : null;

    const trend =
      m.key === 'mrr_growth_rate'
        ? 'stable' // MRR growth is point-in-time comparison, not trended separately
        : m.snapshotField
          ? getTrend(m.snapshotField, m.higherIsBetter)
          : 'stable';

    const cohort_insight = m.insight(your_percentile ?? 50);

    results.push({
      metric: m.key,
      your_value: yourValue,
      cohort_p25: p25,
      cohort_median: p50,
      cohort_p75: p75,
      your_percentile,
      trend,
      cohort_insight,
    });
  }

  return results;
}

// ─── Seed Default Cohort Patterns ─────────────────────────────────────────────

/**
 * Populates cohort_patterns with illustrative examples if the table is empty.
 * These represent collected wisdom across the Foundry network.
 */
export async function seedDefaultCohortPatterns(): Promise<void> {
  const existing = await query('SELECT COUNT(*) as cnt FROM cohort_patterns', []);
  const count = (existing.rows[0] as Record<string, number>).cnt;
  if (count > 0) return;

  const now = new Date().toISOString();
  const patterns: Array<[string, string, string, string, string, string, string, number, number]> = [
    [
      'cp_b2b_seed_churn',
      'b2b_saas_seed',
      JSON.stringify({ business_model: 'b2b_saas', stage: 'seed' }),
      'churn_inflection',
      'Seed-Stage Churn Inflection at Month 6',
      'B2B SaaS companies at seed stage commonly see a churn spike between months 5-7 as early-adopter cohorts hit natural evaluation checkpoints. Companies that run structured quarterly business reviews survive this window at 2.3× higher rates.',
      JSON.stringify({ median_weeks_to_event: 24, survival_rate_with_qbr: 0.71, without_qbr: 0.31 }),
      0.72,
      38,
      now,
    ],
    [
      'cp_b2b_seed_growth',
      'b2b_saas_seed',
      JSON.stringify({ business_model: 'b2b_saas', stage: 'seed' }),
      'growth_trajectory',
      'Activation → Growth Flywheel',
      'Seed-stage B2B SaaS companies with activation rates above 55% show MRR growth 2.1× higher in the following quarter. Improving activation is a higher-leverage move than increasing top-of-funnel spend at this stage.',
      JSON.stringify({ activation_threshold: 55, mrr_growth_multiplier: 2.1, sample_companies: 52 }),
      0.68,
      52,
      now,
    ],
    [
      'cp_b2b_seed_fundraising',
      'b2b_saas_seed',
      JSON.stringify({ business_model: 'b2b_saas', stage: 'seed' }),
      'fundraising_window',
      'Series A Fundraising Window',
      'The optimal fundraising window for seed-stage B2B SaaS typically opens when NRR crosses 105% and MRR exceeds $25k. Companies that start outreach 6 months before runway depletion close rounds at 3× the rate of those who wait.',
      JSON.stringify({ nrr_threshold: 105, mrr_threshold: 25000, lead_time_months: 6 }),
      0.65,
      44,
      now,
    ],
    [
      'cp_b2b_series_a_team',
      'b2b_saas_series_a',
      JSON.stringify({ business_model: 'b2b_saas', stage: 'series_a' }),
      'team_scaling',
      'First Sales Hire Timing',
      'Series A B2B SaaS companies that hire their first dedicated sales rep before closing $50k MRR report 40% lower ramp time and 1.8× faster growth in the 12 months following the hire.',
      JSON.stringify({ mrr_at_hire_threshold: 50000, ramp_time_reduction: 0.4, growth_multiplier: 1.8 }),
      0.61,
      29,
      now,
    ],
    [
      'cp_marketplace_seed_liquidity',
      'marketplace_seed',
      JSON.stringify({ business_model: 'marketplace', stage: 'seed' }),
      'growth_trajectory',
      'Marketplace Liquidity Unlock',
      'Seed-stage marketplaces that achieve a fill-rate above 70% in their core geography before expanding see 3× higher retention in both buyer and seller cohorts. Geographic concentration before expansion is consistently the winning playbook.',
      JSON.stringify({ fill_rate_threshold: 70, retention_multiplier: 3.0, sample_companies: 18 }),
      0.58,
      18,
      now,
    ],
  ];

  for (const [id, cohort_key, cohort_definition_json, pattern_type, pattern_name, pattern_description, supporting_data_json, confidence, company_count, computed_at] of patterns) {
    await query(
      `INSERT OR IGNORE INTO cohort_patterns
       (id, cohort_key, cohort_definition_json, pattern_type, pattern_name,
        pattern_description, supporting_data_json, confidence, company_count, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, cohort_key, cohort_definition_json, pattern_type, pattern_name, pattern_description, supporting_data_json, confidence, company_count, computed_at],
    );
  }
}
