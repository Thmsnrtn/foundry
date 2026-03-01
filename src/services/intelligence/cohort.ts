// =============================================================================
// FOUNDRY — Cohort Intelligence
// =============================================================================

import { query, getCohorts } from '../../db/client.js';
import type { CohortSummary } from '../../types/index.js';
import type { CohortRow } from '../../types/database.js';

export async function getLatestCohortSummary(productId: string): Promise<CohortSummary | null> {
  const result = await query(
    'SELECT * FROM cohorts WHERE product_id = ? ORDER BY acquisition_period DESC LIMIT 1',
    [productId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as unknown as CohortRow;
  const avg = await getHistoricalAverage(productId);

  return {
    period: row.acquisition_period,
    channel: row.acquisition_channel,
    retention_day_14: row.founder_count > 0 ? (row.retained_day_14 / row.founder_count) * 100 : 0,
    retention_day_30: row.founder_count > 0 ? (row.retained_day_30 / row.founder_count) * 100 : 0,
    vs_historical_average_14: avg ? ((row.founder_count > 0 ? (row.retained_day_14 / row.founder_count) * 100 : 0) - avg.day_14) : 0,
    vs_historical_average_30: avg ? ((row.founder_count > 0 ? (row.retained_day_30 / row.founder_count) * 100 : 0) - avg.day_30) : 0,
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

export async function getCohortsByChannel(productId: string): Promise<Record<string, { count: number; avgRetention14: number }>> {
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

  const result2: Record<string, { count: number; avgRetention14: number }> = {};
  for (const [ch, data] of Object.entries(channels)) {
    result2[ch] = { count: data.founderCount, avgRetention14: data.count > 0 ? data.totalRetention / data.count : 0 };
  }
  return result2;
}
