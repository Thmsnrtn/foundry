// =============================================================================
// FOUNDRY — Cohort Intelligence
// =============================================================================

import { query, getCohorts } from '../../db/client.js';
import type { CohortSummary } from '../../types/index.js';
import type { CohortRow } from '../../types/database.js';

/** Retention as a percentage; null when the cohort has nobody in it OR when
 *  nobody has recorded how many were retained. Migration 212 made the second
 *  case expressible: the column used to be `DEFAULT 0`, so "we never measured
 *  this" and "not one of them came back" were the same value, and nothing in
 *  this codebase writes it. */
function retentionPct(retained: number | null | undefined, founders: number): number | null {
  if (retained == null || founders <= 0) return null;
  return (retained / founders) * 100;
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
    // Each comparison needs BOTH halves: this cohort's figure and an average
    // for the same day. An average that exists for day 7 says nothing about
    // day 30.
    vs_historical_average_14: day14 === null || avg?.day_14 == null ? null : day14 - avg.day_14,
    vs_historical_average_30: day30 === null || avg?.day_30 == null ? null : day30 - avg.day_30,
  };
}

export async function getHistoricalAverage(productId: string): Promise<
  { day_7: number | null; day_14: number | null; day_30: number | null } | null
> {
  const result = await getCohorts(productId);
  if (result.rows.length < 2) return null; // Need at least 2 cohorts for meaningful comparison

  // THE MEAN ACROSS COHORTS THAT REPORTED A NUMBER, per day, counted
  // separately — a cohort that recorded day-7 but not day-30 belongs in one
  // average and not the other. It used to add an unmeasured column's `DEFAULT
  // 0` into every total and divide by every cohort, so one unreported cohort
  // pulled the "historical average" towards zero and the page compared the
  // newest cohort against it.
  //
  // It is the mean of the cohorts' RATES, not the retention of the historical
  // population — a small cohort counts as much as a large one. That is what the
  // page's "Historical Avg" row has always shown; it is named here rather than
  // quietly changed, because switching to a size-weighted mean would move a
  // number a founder may have been reading for months.
  const rows = result.rows as unknown as CohortRow[];
  const sums = { day_7: 0, day_14: 0, day_30: 0 };
  const counts = { day_7: 0, day_14: 0, day_30: 0 };

  for (const row of rows) {
    if (row.founder_count <= 0) continue;
    for (const [key, retained] of [
      ['day_7', row.retained_day_7], ['day_14', row.retained_day_14],
      ['day_30', row.retained_day_30],
    ] as const) {
      if (retained == null) continue;
      sums[key] += (retained / row.founder_count) * 100;
      counts[key] += 1;
    }
  }

  if (counts.day_7 + counts.day_14 + counts.day_30 === 0) return null;
  return {
    day_7: counts.day_7 > 0 ? sums.day_7 / counts.day_7 : null,
    day_14: counts.day_14 > 0 ? sums.day_14 / counts.day_14 : null,
    day_30: counts.day_30 > 0 ? sums.day_30 / counts.day_30 : null,
  };
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
    // The channel's SIZE is countable whether or not anyone measured its
    // retention; the RATE needs a reported figure. Counting a NULL as a zero
    // rate is the defect this function's own header describes, one column
    // further in: `retained_day_14` is unwritten by anything in this codebase.
    if (row.founder_count > 0) {
      channels[ch].founderCount += row.founder_count;
      if (row.retained_day_14 != null) {
        channels[ch].totalRetention += (row.retained_day_14 / row.founder_count) * 100;
        channels[ch].count++;
      }
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
