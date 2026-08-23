// =============================================================================
// FOUNDRY — Cohort Intelligence
// =============================================================================

import { query, getCohorts } from '../../db/client.js';
import type { CohortSummary } from '../../types/index.js';
import type { CohortRow } from '../../types/database.js';

/** Retention as a percentage, or null when the cohort has nobody in it. */
function retentionPct(retained: number, founders: number): number | null {
  return founders > 0 ? (retained / founders) * 100 : null;
}

export async function getLatestCohortSummary(productId: string): Promise<CohortSummary | null> {
  const result = await query(
    'SELECT * FROM cohorts WHERE product_id = ? ORDER BY acquisition_period DESC LIMIT 1',
    [productId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as unknown as CohortRow;
  const avg = await getHistoricalAverage(productId);

  // TWO SUBSTITUTIONS, BOTH OF WHICH READ AS FINDINGS.
  //
  // `founder_count > 0 ? … : 0` gave a cohort with NOBODY IN IT a retention of
  // 0%. `stressor.ts` subtracts that from the historical average, so an empty
  // cohort row produced a full-average gap and raised "Severe cohort retention
  // drop" at CRITICAL severity — about a cohort that had no one to retain.
  //
  // `avg ? (… - avg.day_14) : 0` is worse, because zero is not a neutral value
  // in that field: it is the specific claim "exactly at the historical
  // average". A company with a single cohort — every company, at first — was
  // told it was performing precisely at an average that does not exist. It
  // reaches the founder through the digest's evaluation context and the
  // stressor report.
  const day14 = retentionPct(row.retained_day_14, row.founder_count);
  const day30 = retentionPct(row.retained_day_30, row.founder_count);

  return {
    period: row.acquisition_period,
    channel: row.acquisition_channel,
    retention_day_14: day14,
    retention_day_30: day30,
    vs_historical_average_14: avg === null || day14 === null ? null : day14 - avg.day_14,
    vs_historical_average_30: avg === null || day30 === null ? null : day30 - avg.day_30,
  };
}

export async function getHistoricalAverage(productId: string): Promise<{ day_7: number; day_14: number; day_30: number } | null> {
  const result = await getCohorts(productId);
  if (result.rows.length < 2) return null; // Need at least 2 cohorts for meaningful comparison

  const rows = result.rows as unknown as CohortRow[];
  let total7 = 0, total14 = 0, total30 = 0, count = 0;

  for (const row of rows) {
    if (row.founder_count > 0) {
      total7 += (row.retained_day_7 / row.founder_count) * 100;
      total14 += (row.retained_day_14 / row.founder_count) * 100;
      total30 += (row.retained_day_30 / row.founder_count) * 100;
      count++;
    }
  }

  if (count === 0) return null;
  return { day_7: total7 / count, day_14: total14 / count, day_30: total30 / count };
}

/**
 * Day-14 retention per acquisition channel, and how many people came through
 * it. `avgRetention14` is NULL for a channel whose cohorts had nobody in
 * them — it used to be 0, rendered on the cohorts page as "0%" beside the
 * channel name, which is a verdict on a channel rather than an absence of one.
 */
export async function getCohortsByChannel(productId: string): Promise<Record<string, { count: number; avgRetention14: number | null }>> {
  const result = await getCohorts(productId);
  const rows = result.rows as unknown as CohortRow[];
  const channels: Record<string, { totalRetention: number; count: number; founderCount: number }> = {};

  for (const row of rows) {
    const ch = row.acquisition_channel ?? 'unknown';
    if (!channels[ch]) channels[ch] = { totalRetention: 0, count: 0, founderCount: 0 };
    if (row.founder_count > 0) {
      channels[ch].totalRetention += (row.retained_day_14 / row.founder_count) * 100;
      channels[ch].count++;
      channels[ch].founderCount += row.founder_count;
    }
  }

  const result2: Record<string, { count: number; avgRetention14: number | null }> = {};
  for (const [ch, data] of Object.entries(channels)) {
    result2[ch] = {
      count: data.founderCount,
      avgRetention14: data.count > 0 ? data.totalRetention / data.count : null,
    };
  }
  return result2;
}
