// =============================================================================
// FOUNDRY — Target Probability Calculator
// Answers: "What's the probability we hit our OKR targets?"
// =============================================================================

import { query } from '../../../db/client.js';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface TargetForecast {
  metric: string; // 'mrr', 'activation_rate', 'churn_rate'
  current_value: number;
  target_value: number;
  target_date: string; // ISO date
  probability: number; // 0-1
  required_monthly_change: number;
  current_monthly_change: number; // trailing 4-week average
  on_track: boolean;
  projected_value_at_target_date: number;
}

// ─── Linear regression helper ─────────────────────────────────────────────────

/**
 * Simple linear regression over (x, y) pairs.
 * Returns slope and intercept.
 */
function linearRegression(points: Array<{ x: number; y: number }>): {
  slope: number;
  intercept: number;
  r_squared: number;
} {
  const n = points.length;
  if (n < 2) {
    return { slope: 0, intercept: points[0]?.y ?? 0, r_squared: 0 };
  }

  const sumX = points.reduce((acc, p) => acc + p.x, 0);
  const sumY = points.reduce((acc, p) => acc + p.y, 0);
  const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0);
  const sumX2 = points.reduce((acc, p) => acc + p.x * p.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const yMean = sumY / n;
  const ssTot = points.reduce((acc, p) => acc + Math.pow(p.y - yMean, 2), 0);
  const ssRes = points.reduce((acc, p) => acc + Math.pow(p.y - (slope * p.x + intercept), 2), 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r_squared: rSquared };
}

/**
 * Map a metric name from key_results to a metric_snapshots column name.
 */
function mapMetricToSnapshotColumn(metric: string): string | null {
  const mapping: Record<string, string> = {
    mrr: 'new_mrr_cents',
    new_mrr_cents: 'new_mrr_cents',
    activation_rate: 'activation_rate',
    churn_rate: 'churn_rate',
    retention: 'day_30_retention',
    day_30_retention: 'day_30_retention',
    active_users: 'active_users',
    nps: 'nps_score',
    nps_score: 'nps_score',
    signups: 'signups_7d',
    signups_7d: 'signups_7d',
  };
  return mapping[metric.toLowerCase()] ?? null;
}

// ─── Public: Forecast probability for a single target ────────────────────────

export async function forecastTargetProbability(
  productId: string,
  metric: string,
  targetValue: number,
  targetDate: string
): Promise<TargetForecast> {
  const columnName = mapMetricToSnapshotColumn(metric);

  // Default result for when we lack data
  const defaultForecast: TargetForecast = {
    metric,
    current_value: 0,
    target_value: targetValue,
    target_date: targetDate,
    probability: 0.5,
    required_monthly_change: 0,
    current_monthly_change: 0,
    on_track: false,
    projected_value_at_target_date: 0,
  };

  if (!columnName) return defaultForecast;

  // Load last 8 weeks of snapshots
  const since = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const snapshotResult = await query(
    `SELECT snapshot_date, ${columnName} as value
     FROM metric_snapshots
     WHERE product_id = ? AND snapshot_date >= ? AND ${columnName} IS NOT NULL
     ORDER BY snapshot_date ASC`,
    [productId, since]
  );

  const rows = snapshotResult.rows as Array<Record<string, unknown>>;

  if (rows.length < 2) return defaultForecast;

  // Convert to numeric points (x = days from first snapshot, y = value)
  const firstDate = new Date(rows[0]!.snapshot_date as string).getTime();
  const points = rows.map((r) => ({
    x: (new Date(r.snapshot_date as string).getTime() - firstDate) / (1000 * 60 * 60 * 24),
    y: (r.value as number) ?? 0,
  }));

  const { slope, intercept, r_squared } = linearRegression(points);

  const latestRow = rows[rows.length - 1]!;
  const currentValue = (latestRow.value as number) ?? 0;
  const latestDate = new Date(latestRow.snapshot_date as string);
  const targetDateObj = new Date(targetDate);

  // Days from first snapshot to target date
  const daysToTarget = (targetDateObj.getTime() - firstDate) / (1000 * 60 * 60 * 24);
  const daysFromLatest = (targetDateObj.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysFromLatest <= 0) return { ...defaultForecast, current_value: currentValue };

  // Project to target date
  const projectedValue = slope * daysToTarget + intercept;

  // Monthly change from slope (slope is per day)
  const currentMonthlyChange = slope * 30;

  // Required monthly change to hit target
  const monthsToTarget = daysFromLatest / 30;
  const requiredMonthlyChange = monthsToTarget > 0
    ? (targetValue - currentValue) / monthsToTarget
    : 0;

  // Determine if on track: projected value reaches target (with direction awareness)
  const targetIsHigher = targetValue > currentValue;
  const onTrack = targetIsHigher
    ? projectedValue >= targetValue
    : projectedValue <= targetValue;

  // Probability calculation:
  // Base: 0.5, adjusted by:
  // 1. R-squared (trend consistency): higher R² = more confident
  // 2. Whether on track: +0.3 if on track, -0.2 if not
  // 3. How much buffer: ratio of projected / target
  let probability = 0.5;

  const trendConfidence = Math.max(0, Math.min(1, r_squared));
  probability += (trendConfidence - 0.5) * 0.2; // ±0.1 from trend confidence

  if (onTrack) {
    probability += 0.25;
    // Bonus if significantly ahead
    if (targetIsHigher && projectedValue > targetValue * 1.1) probability += 0.1;
    if (!targetIsHigher && projectedValue < targetValue * 0.9) probability += 0.1;
  } else {
    probability -= 0.2;
    // Extra penalty if far off
    if (targetIsHigher && projectedValue < targetValue * 0.7) probability -= 0.1;
    if (!targetIsHigher && projectedValue > targetValue * 1.3) probability -= 0.1;
  }

  probability = Math.max(0.02, Math.min(0.97, probability));

  return {
    metric,
    current_value: currentValue,
    target_value: targetValue,
    target_date: targetDate,
    probability,
    required_monthly_change: requiredMonthlyChange,
    current_monthly_change: currentMonthlyChange,
    on_track: onTrack,
    projected_value_at_target_date: projectedValue,
  };
}

// ─── Public: Get active target forecasts from OKRs ───────────────────────────

export async function getActiveTargetForecasts(productId: string): Promise<TargetForecast[]> {
  // Load active OKRs with key results that have metric_name set
  const krResult = await query(
    `SELECT kr.id, kr.metric_name, kr.target_value, kr.current_value, kr.description,
            co.period
     FROM key_results kr
     JOIN company_okrs co ON co.id = kr.okr_id
     WHERE co.product_id = ?
       AND co.status NOT IN ('completed', 'cancelled')
       AND kr.status NOT IN ('completed')
       AND kr.metric_name IS NOT NULL
       AND kr.target_value IS NOT NULL
     ORDER BY co.created_at DESC`,
    [productId]
  );

  const rows = krResult.rows as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  // Derive target_date from period string (e.g. '2024-Q2' → end of Q2)
  function periodToTargetDate(period: string): string {
    const quarterMatch = period.match(/^(\d{4})-Q(\d)$/);
    if (quarterMatch) {
      const year = parseInt(quarterMatch[1]!, 10);
      const quarter = parseInt(quarterMatch[2]!, 10);
      const endMonth = quarter * 3; // Q1→3, Q2→6, Q3→9, Q4→12
      const endDate = new Date(year, endMonth, 0); // Last day of the quarter's last month
      return endDate.toISOString().slice(0, 10);
    }
    const halfMatch = period.match(/^(\d{4})-H(\d)$/);
    if (halfMatch) {
      const year = parseInt(halfMatch[1]!, 10);
      const half = parseInt(halfMatch[2]!, 10);
      const endMonth = half === 1 ? 6 : 12;
      const endDate = new Date(year, endMonth, 0);
      return endDate.toISOString().slice(0, 10);
    }
    // Fallback: end of current year
    return `${new Date().getFullYear()}-12-31`;
  }

  const forecasts = await Promise.all(
    rows.map((row) =>
      forecastTargetProbability(
        productId,
        (row.metric_name as string),
        (row.target_value as number),
        periodToTargetDate(row.period as string)
      )
    )
  );

  return forecasts;
}
