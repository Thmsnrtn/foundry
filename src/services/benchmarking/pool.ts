// =============================================================================
// FOUNDRY — Benchmarking Pool Service
//
// Cross-product metric comparison, from companies that agreed to contribute.
//
// THIS HEADER SAID "ANONYMOUS OPT-IN" AND THE CODE WAS NEITHER. `submitBenchmark`
// took every operating company's churn and activation rate with no consent
// check at all, and stored each contribution against its `product_id`. The
// privacy page meanwhile promised the founder that their data would be
// "stripped of all identifying information before contributing", and offered a
// toggle — `benchmark_contribution` — that no code path read. Ticking it and
// leaving it untouched produced identical behaviour.
//
// Both halves are fixed here, and the honest one is worth stating: the pool is
// NOT anonymous at rest and cannot be. A company must be able to erase what it
// contributed, and erasure needs to know whose row it is. What is true is that
// contribution is consented, and that nothing leaves the pool except an
// aggregate over a minimum number of DISTINCT companies. The privacy page now
// says that instead.
//
// Based on migration 030 (benchmark_contributions, benchmark_percentiles tables).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { hasConsent } from '../privacy/consent.js';

/**
 * The smallest number of DISTINCT companies a published percentile may rest on.
 *
 * Counting rows instead would let one company contributing weekly become a
 * "sample" of fifty-two — the same defect `decisions/patterns.ts` documents as
 * fixed on its own reader and `intelligence/peer-signal.ts` still has. Below
 * this, the segment publishes nothing: a percentile over one contributor is
 * that contributor's exact number, handed to everybody in their segment.
 */
import { MIN_CONTRIBUTORS } from '../institution/contributor-floor.js';
export { MIN_CONTRIBUTORS };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkContribution {
  metric_name: string; // e.g. 'mrr_growth_rate', 'churn_rate', 'activation_rate', 'cac_payback_months'
  value: number;
  company_stage: string; // 'pre_revenue' | 'early' | 'growth' | 'scale'
  industry: string; // optional, defaults to 'saas'
}

// ─── submitBenchmark ──────────────────────────────────────────────────────────

/**
 * Contribute this company's metrics, if the company agreed to.
 *
 * The consent check is HERE rather than in the caller, so every caller
 * converges on it. A gate one caller remembers is not a gate.
 */
export async function submitBenchmark(
  productId: string,
  contributions: BenchmarkContribution[]
): Promise<void> {
  if (!(await hasConsent(productId, 'benchmark_contribution'))) return;
  for (const contrib of contributions) {
    const industry = contrib.industry ?? 'saas';
    const category = mapIndustryToCategory(industry);
    const sizeBucket = '1'; // default bucket; caller should enrich if possible
    const mrrBucket = '0-1k'; // default bucket

    await query(
      `INSERT INTO benchmark_contributions
         (id, product_id, lifecycle_state, company_category, team_size_bucket, mrr_bucket,
          activation_rate, churn_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        productId,
        contrib.company_stage,
        category,
        sizeBucket,
        mrrBucket,
        contrib.metric_name === 'activation_rate' ? contrib.value : null,
        contrib.metric_name === 'churn_rate' ? contrib.value : null,
      ]
    );
  }
}

// ─── getPercentile ────────────────────────────────────────────────────────────

export async function getPercentile(
  metricName: string,
  value: number,
  stage: string
): Promise<number> {
  const column = metricNameToColumn(metricName);
  if (!column) return 50; // unknown metric → return median as default

  const totalResult = await query(
    `SELECT COUNT(*) as total FROM benchmark_contributions
     WHERE lifecycle_state = ? AND ${column} IS NOT NULL`,
    [stage]
  );
  const total = ((totalResult.rows[0] as Record<string, unknown>)?.total as number) ?? 0;
  if (total === 0) return 50;

  const belowResult = await query(
    `SELECT COUNT(*) as below FROM benchmark_contributions
     WHERE lifecycle_state = ? AND ${column} IS NOT NULL AND ${column} <= ?`,
    [stage, value]
  );
  const below = ((belowResult.rows[0] as Record<string, unknown>)?.below as number) ?? 0;

  return Math.round((below / total) * 100);
}

// ─── getBenchmarkSummary ──────────────────────────────────────────────────────

export async function getBenchmarkSummary(
  productId: string,
  metricName: string
): Promise<{
  your_value: number | null;
  percentile: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  sample_size: number;
} | null> {
  // Get the product's own latest contribution for this metric
  const column = metricNameToColumn(metricName);
  if (!column) return null;

  const yourResult = await query(
    `SELECT ${column} as val, lifecycle_state FROM benchmark_contributions
     WHERE product_id = ? AND ${column} IS NOT NULL
     ORDER BY contributed_at DESC LIMIT 1`,
    [productId]
  );

  let yourValue: number | null = null;
  let stage = 'early';
  if (yourResult.rows.length > 0) {
    const r = yourResult.rows[0] as Record<string, unknown>;
    yourValue = r.val as number | null;
    stage = (r.lifecycle_state as string) ?? 'early';
  }

  // Get pre-computed percentiles
  const percResult = await query(
    `SELECT p25, p50, p75, sample_count FROM benchmark_percentiles
     WHERE metric_name = ? AND lifecycle_state = ?
     ORDER BY computed_at DESC LIMIT 1`,
    [metricName, stage]
  );

  let p25: number | null = null;
  let p50: number | null = null;
  let p75: number | null = null;
  let sampleSize = 0;

  if (percResult.rows.length > 0) {
    const pr = percResult.rows[0] as Record<string, unknown>;
    p25 = pr.p25 as number | null;
    p50 = pr.p50 as number | null;
    p75 = pr.p75 as number | null;
    sampleSize = (pr.sample_count as number) ?? 0;
  } else {
    // Fall back to counting contributions directly
    const countResult = await query(
      `SELECT COUNT(*) as cnt FROM benchmark_contributions
       WHERE lifecycle_state = ? AND ${column} IS NOT NULL`,
      [stage]
    );
    sampleSize = ((countResult.rows[0] as Record<string, unknown>)?.cnt as number) ?? 0;
  }

  const percentile =
    yourValue !== null ? await getPercentile(metricName, yourValue, stage) : null;

  return { your_value: yourValue, percentile, p25, p50, p75, sample_size: sampleSize };
}

// ─── refreshPercentiles ───────────────────────────────────────────────────────

export async function refreshPercentiles(): Promise<void> {
  const metricColumns = [
    { name: 'activation_rate', column: 'activation_rate' },
    { name: 'day_30_retention', column: 'day_30_retention' },
    { name: 'churn_rate', column: 'churn_rate' },
    { name: 'nps_score', column: 'nps_score' },
    { name: 'cac_usd', column: 'cac_usd' },
    { name: 'ltv_usd', column: 'ltv_usd' },
    { name: 'ai_cost_pct_of_mrr', column: 'ai_cost_pct_of_mrr' },
  ];

  // Get distinct (lifecycle_state, company_category) combinations
  const segmentsResult = await query(
    `SELECT DISTINCT lifecycle_state, company_category FROM benchmark_contributions`,
    []
  );

  for (const segRow of segmentsResult.rows) {
    const seg = segRow as Record<string, unknown>;
    const lifecycleState = seg.lifecycle_state as string;
    const companyCategory = seg.company_category as string;

    for (const metric of metricColumns) {
      const valuesResult = await query(
        `SELECT ${metric.column} as val, product_id FROM benchmark_contributions
         WHERE lifecycle_state = ? AND company_category = ? AND ${metric.column} IS NOT NULL
         ORDER BY ${metric.column} ASC`,
        [lifecycleState, companyCategory]
      );

      const rows = valuesResult.rows as unknown as Array<Record<string, unknown>>;
      const values = rows
        .map((r) => r.val as number)
        .filter((v) => v !== null && v !== undefined);

      // DISTINCT COMPANIES, not rows. The only floor here was `length === 0`,
      // so a segment with one contributor published that company's exact churn
      // as all four percentiles, to everybody in the segment. And the
      // `sample_count` a founder reads counted contributions, so one company
      // contributing weekly looked like fifty-two peers after a year.
      const contributors = new Set(rows.map((r) => String(r.product_id)));
      if (contributors.size < MIN_CONTRIBUTORS) continue;

      const p25 = percentileValue(values, 25);
      const p50 = percentileValue(values, 50);
      const p75 = percentileValue(values, 75);
      const p90 = percentileValue(values, 90);

      await query(
        `INSERT INTO benchmark_percentiles
           (id, lifecycle_state, company_category, metric_name, p25, p50, p75, p90, sample_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(lifecycle_state, company_category, metric_name, computed_at) DO UPDATE SET
           p25 = excluded.p25,
           p50 = excluded.p50,
           p75 = excluded.p75,
           p90 = excluded.p90,
           sample_count = excluded.sample_count`,
        [
          nanoid(),
          lifecycleState,
          companyCategory,
          metric.name,
          p25,
          p50,
          p75,
          p90,
          contributors.size,
        ]
      );
    }
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function percentileValue(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((pct / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function metricNameToColumn(metricName: string): string | null {
  const map: Record<string, string> = {
    activation_rate: 'activation_rate',
    day_30_retention: 'day_30_retention',
    churn_rate: 'churn_rate',
    nps_score: 'nps_score',
    cac_usd: 'cac_usd',
    ltv_usd: 'ltv_usd',
    ai_cost_pct_of_mrr: 'ai_cost_pct_of_mrr',
  };
  return map[metricName] ?? null;
}

/**
 * The segment a company belongs to in the benchmark pool: which lifecycle band
 * and which company category.
 *
 * ONE VOCABULARY, ONE HOME. The writer derived the lifecycle band inline in the
 * benchmark job — `prompt_1..prompt_9` mapped to
 * 'pre_revenue' | 'early' | 'growth' | 'scale' — and the cohort reader in
 * `network/cohort-patterns.ts` built its own key by mapping the company's
 * FUNDING stage to the literal strings 'prompt_1'..'prompt_4'. The two never
 * intersected, so the reader's lookup missed for every company, every time, and
 * fell through to a set of invented percentile bands nobody could see was
 * invented.
 *
 * Both sides now ask here. A segment key is a fact about how the pool is
 * partitioned, and the module that writes the partition owns it.
 */
export function lifecycleBandForPrompt(currentPrompt: string | null | undefined): string {
  const bands: Record<string, string> = {
    prompt_1: 'pre_revenue', prompt_2: 'pre_revenue', prompt_2_5: 'pre_revenue',
    prompt_3: 'early', prompt_4: 'early', prompt_5: 'early',
    prompt_6: 'growth', prompt_7: 'growth', prompt_8: 'scale', prompt_9: 'scale',
  };
  return bands[String(currentPrompt ?? '')] ?? 'early';
}

/** The pool segment for one product, read from what the pool is keyed on. */
export async function benchmarkSegment(
  productId: string,
): Promise<{ lifecycleState: string; companyCategory: string }> {
  const row = (await query(
    `SELECT ls.current_prompt AS current_prompt, p.market_category AS market_category
       FROM products p
       LEFT JOIN lifecycle_state ls ON ls.product_id = p.id
      WHERE p.id = ?`,
    [productId],
  )).rows[0] as Record<string, unknown> | undefined;

  return {
    lifecycleState: lifecycleBandForPrompt(row?.current_prompt as string | null),
    companyCategory: mapIndustryToCategory(String(row?.market_category ?? 'saas')),
  };
}

function mapIndustryToCategory(industry: string): string {
  const map: Record<string, string> = {
    saas: 'b2b_saas',
    b2b_saas: 'b2b_saas',
    b2c_saas: 'b2c_saas',
    marketplace: 'marketplace',
    developer_tools: 'developer_tools',
    fintech: 'fintech',
  };
  return map[industry.toLowerCase()] ?? 'other';
}
