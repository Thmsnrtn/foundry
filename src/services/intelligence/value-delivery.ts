// =============================================================================
// FOUNDRY — Value Delivery Index
// Measures how effectively the product delivers value to users.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { StressorReportItem } from '../../types/index.js';

export interface ValueDeliverySnapshot {
  value_delivery_index: number;
  core_workflow_completion_rate: number;
  feature_utilization_breadth: number;
  time_to_first_value_hours: number;
  engagement_depth_score: number;
  support_ticket_rate: number;
}

/**
 * THE SAME ABSENCE SCORED AS EXCELLENT AND AS ZERO, IN ONE FILE.
 *
 * The index was a weighted sum in which every unreported component was
 * substituted, and the substitutions did not agree with each other:
 *
 *   core_workflow_completion_rate ?? 0    an unreported rate scored 0
 *   feature_utilization_breadth   ?? 0    an unreported breadth scored 0
 *   time_to_first_value_hours     ?? 100  100 - 100 = 0, the worst
 *   engagement_depth_score        ?? 0    an unreported score scored 0
 *   support_ticket_rate           ?? 0    100 - 0 = 100, the BEST
 *
 * So a product reporting nothing scored 15/100 — fifteen points of perfect
 * support performance, and zero for everything else. `if (!m) return 0` gave a
 * product with no snapshot at all a flat 0 on "how effectively the product
 * delivers value". And `identifyValueDeliveryStressors` read the same missing
 * breadth as 100, so the same silence was excellent there and worthless here.
 *
 * The index is now a weighted average over the components that were ACTUALLY
 * REPORTED, with the weights renormalised, and null when none were. `coverage`
 * says how much of the full weighting was measured, because an index built from
 * one component of five is not the same claim as one built from all five, and a
 * single number cannot carry that difference.
 *
 * `value_delivery_metrics.value_delivery_index` was already declared nullable.
 * The schema allowed unknown; the producer could not express it.
 */
const VDI_COMPONENTS: ReadonlyArray<{
  key: keyof ValueDeliverySnapshot;
  weight: number;
  score: (value: number) => number;
}> = [
  { key: 'core_workflow_completion_rate', weight: 0.30, score: (v) => v },
  { key: 'feature_utilization_breadth', weight: 0.15, score: (v) => v },
  { key: 'time_to_first_value_hours', weight: 0.20, score: (v) => Math.max(0, 100 - v) },
  { key: 'engagement_depth_score', weight: 0.20, score: (v) => v },
  { key: 'support_ticket_rate', weight: 0.15, score: (v) => Math.max(0, 100 - v * 10) },
];

export interface ValueDeliveryIndex {
  /** 0-100 over the components reported, or null when none were. */
  index: number | null;
  /** The components that went into it. */
  components_reported: string[];
  /** Share of the full weighting that was measured, 0-1. Null when nothing was. */
  coverage: number | null;
}

/** Weighted average over the reported components only. */
export function valueDeliveryIndexOf(
  m: Partial<Record<keyof ValueDeliverySnapshot, number | null | undefined>> | undefined,
): ValueDeliveryIndex {
  if (!m) return { index: null, components_reported: [], coverage: null };

  let weighted = 0;
  let weightUsed = 0;
  const reported: string[] = [];

  for (const c of VDI_COMPONENTS) {
    const raw = m[c.key];
    if (raw === null || raw === undefined) continue;
    weighted += c.score(Number(raw)) * c.weight;
    weightUsed += c.weight;
    reported.push(c.key);
  }

  if (weightUsed === 0) return { index: null, components_reported: [], coverage: null };

  const index = Math.round(Math.min(100, Math.max(0, weighted / weightUsed)));
  return { index, components_reported: reported, coverage: weightUsed };
}

/**
 * Compute the Value Delivery Index from the latest snapshot.
 */
export async function computeValueDeliveryIndex(productId: string): Promise<ValueDeliveryIndex> {
  const result = await query(
    'SELECT * FROM value_delivery_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = result.rows[0] as Record<string, unknown> | undefined;
  return valueDeliveryIndexOf(m as Parameters<typeof valueDeliveryIndexOf>[0]);
}

/**
 * Assess time to first value.
 */
export async function assessTimeToFirstValue(productId: string): Promise<{
  hours: number | null;
  benchmark: string;
  recommendation: string | null;
}> {
  const result = await query(
    'SELECT time_to_first_value_hours FROM value_delivery_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const raw = (result.rows[0] as Record<string, number | null> | undefined)?.time_to_first_value_hours;

  // `?? 0` meant zero hours, and zero hours falls in the first branch below:
  // a product that had never measured time-to-first-value was told its
  // onboarding was "Excellent — users get value within minutes".
  if (raw === null || raw === undefined) {
    return {
      hours: null,
      benchmark: 'Not measured — no time-to-first-value has been reported',
      recommendation: null,
    };
  }
  const hours = Number(raw);

  let benchmark: string;
  let recommendation: string | null = null;

  if (hours <= 0.5) {
    benchmark = 'Excellent — users get value within minutes';
  } else if (hours <= 2) {
    benchmark = 'Good — value delivered within first session';
  } else if (hours <= 24) {
    benchmark = 'Acceptable — value delivered within first day';
  } else if (hours <= 72) {
    benchmark = 'Slow — many users will churn before experiencing value';
    recommendation = 'Simplify onboarding. Consider a guided tutorial or template-based first experience.';
  } else {
    benchmark = 'Critical — time to value is too long for self-serve SaaS';
    recommendation = 'Radically simplify the first-run experience. Pre-populate with sample data. Add quick-start templates.';
  }

  return { hours, benchmark, recommendation };
}

/**
 * Detect declining value delivery trends.
 */
/**
 * Detect declining value delivery trends.
 *
 * THE FILE FIXED THE INDEX AND LEFT THIS FUNCTION SUBSTITUTING ZEROS. The
 * header above describes exactly this defect in `computeValueDeliveryIndex` and
 * says it was repaired; four comparisons here still read every unreported
 * component as 0, and the direction of the lie depends on which side is
 * missing:
 *
 *   latest missing, prior 60   →  0 < 55   →  "core_workflow_completion" is declining
 *   prior missing, latest 60   →  60 < -5  →  nothing is wrong
 *
 * The same silence is a decline in one line and no problem in the next, and the
 * VDI sentence would report "declined from 72 to 0" about a snapshot that
 * reported no index at all.
 *
 * A comparison needs two measurements. Components that have only one are named
 * as unassessable rather than counted either way.
 */
export async function detectValueDecline(productId: string): Promise<{
  declining: boolean | null;
  trend_description: string;
  affected_components: string[];
  unassessable_components: string[];
}> {
  const snapshots = await query(
    'SELECT * FROM value_delivery_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 4',
    [productId]
  );

  if (snapshots.rows.length < 2) {
    // Null, not false: "nothing is declining" and "this cannot be said" are
    // different answers, and one snapshot cannot support the first.
    return {
      declining: null,
      trend_description: 'Insufficient data',
      affected_components: [],
      unassessable_components: [],
    };
  }

  const rows = snapshots.rows as unknown as Array<Record<string, number | null>>;
  const latest = rows[0]!;
  const prior = rows[rows.length - 1]!;

  const affected: string[] = [];
  const unassessable: string[] = [];

  /** Compare a component only when both ends of the comparison exist. */
  const moved = (
    name: string,
    column: string,
    worse: (now: number, before: number) => boolean,
  ): void => {
    const now = latest[column];
    const before = prior[column];
    if (now == null || before == null) { unassessable.push(name); return; }
    if (worse(Number(now), Number(before))) affected.push(name);
  };

  moved('core_workflow_completion', 'core_workflow_completion_rate', (n, b) => n < b - 5);
  moved('engagement_depth', 'engagement_depth_score', (n, b) => n < b - 5);
  moved('support_load', 'support_ticket_rate', (n, b) => n > b + 2);

  const latestVDI = latest.value_delivery_index;
  const priorVDI = prior.value_delivery_index;
  if (latestVDI == null || priorVDI == null) {
    return {
      declining: null,
      trend_description: latestVDI == null && priorVDI == null
        ? 'No value delivery index reported in either snapshot'
        : 'Only one of the two snapshots reported a value delivery index',
      affected_components: affected,
      unassessable_components: [...unassessable, 'value_delivery_index'],
    };
  }

  const declining = Number(latestVDI) < Number(priorVDI) - 5;

  return {
    declining,
    trend_description: declining
      ? `VDI declined from ${priorVDI} to ${latestVDI} (${(Number(priorVDI) - Number(latestVDI)).toFixed(0)} point drop)`
      : `VDI stable at ${latestVDI}`,
    affected_components: affected,
    unassessable_components: unassessable,
  };
}

/**
 * Correlate VDI with churn: identify if low VDI predicts churn.
 */
export async function correlateValueToRetention(productId: string): Promise<{
  correlation_strength: 'strong' | 'moderate' | 'weak' | 'insufficient_data';
  description: string;
}> {
  const vdiResult = await query(
    'SELECT value_delivery_index FROM value_delivery_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 6',
    [productId]
  );
  const churnResult = await query(
    'SELECT churn_rate FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 6',
    [productId]
  );

  if (vdiResult.rows.length < 3 || churnResult.rows.length < 3) {
    return { correlation_strength: 'insufficient_data', description: 'Need more data points to establish correlation.' };
  }

  const vdi = (vdiResult.rows as unknown as Array<Record<string, number>>).map((r) => r.value_delivery_index ?? 0);
  const churn = (churnResult.rows as unknown as Array<Record<string, number>>).map((r) => r.churn_rate ?? 0);

  // Simple correlation: do they move in opposite directions?
  const vdiTrend = vdi[0]! - vdi[vdi.length - 1]!;
  const churnTrend = churn[0]! - churn[churn.length - 1]!;

  if (Math.abs(vdiTrend) < 3 && Math.abs(churnTrend) < 1) {
    return { correlation_strength: 'weak', description: 'Both VDI and churn are relatively stable.' };
  }

  // Inverse relationship: VDI down, churn up (or vice versa)
  if ((vdiTrend < -5 && churnTrend > 1) || (vdiTrend > 5 && churnTrend < -1)) {
    return {
      correlation_strength: 'strong',
      description: `VDI moved ${vdiTrend > 0 ? 'up' : 'down'} ${Math.abs(vdiTrend).toFixed(0)} points while churn moved ${churnTrend > 0 ? 'down' : 'up'} ${Math.abs(churnTrend).toFixed(1)}%. Strong inverse correlation suggests VDI is a leading indicator of churn.`,
    };
  }

  return { correlation_strength: 'moderate', description: 'Some relationship between VDI and churn detected, but not strongly correlated.' };
}

/**
 * Identify value delivery stressors.
 */
export async function identifyValueDeliveryStressors(productId: string): Promise<StressorReportItem[]> {
  const items: StressorReportItem[] = [];
  const vdi = await computeValueDeliveryIndex(productId);
  const decline = await detectValueDecline(productId);
  const ttfv = await assessTimeToFirstValue(productId);

  if (decline.declining) {
    items.push({
      name: 'Value delivery declining',
      signal: decline.trend_description,
      timeframe_days: 30,
      neutralizing_action: `Focus on: ${decline.affected_components.join(', ')}. VDI decline predicts future churn.`,
      // An unknown index is not a low one. Without it this stays 'elevated',
      // which is what a decline on its own warrants.
      severity: vdi.index !== null && vdi.index < 40 ? 'critical' : 'elevated',
      competitive_correlation: null,
    });
  }

  if (ttfv.hours !== null && ttfv.hours > 72) {
    items.push({
      name: 'Slow time to first value',
      signal: `Users take ${ttfv.hours.toFixed(0)} hours to experience value`,
      timeframe_days: 45,
      neutralizing_action: ttfv.recommendation ?? 'Simplify onboarding experience.',
      severity: 'elevated',
      competitive_correlation: null,
    });
  }

  // Check for feature underutilization
  const latest = await query(
    'SELECT feature_utilization_breadth FROM value_delivery_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  // `?? 100` read an unreported breadth as perfect, so this stressor could
  // never fire for a product that had not measured it — and the index above
  // read the same silence as 0. One absence, two opposite readings, one file.
  const breadthRaw = (latest.rows[0] as Record<string, number | null> | undefined)?.feature_utilization_breadth;
  const breadth = breadthRaw === null || breadthRaw === undefined ? null : Number(breadthRaw);
  if (breadth !== null && breadth < 30) {
    items.push({
      name: 'Feature underutilization',
      signal: `Only ${breadth.toFixed(0)}% of features used by average user`,
      timeframe_days: 90,
      neutralizing_action: 'Investigate: are features undiscoverable, unnecessary, or poorly designed? Consider removing unused features.',
      severity: 'watch',
      competitive_correlation: null,
    });
  }

  return items;
}

/**
 * Report value delivery metrics (called via API).
 */
export async function reportValueDeliveryMetrics(
  productId: string,
  ownerId: string,
  metrics: Partial<ValueDeliverySnapshot>
): Promise<void> {
  const today = new Date().toISOString().split('T')[0]!;

  // ONE ROW THAT TOLD THE TRUTH IN FIVE COLUMNS AND A LIE IN THE SIXTH. The
  // INSERT below correctly stores null for every component the caller did not
  // supply — and the index was computed from those same absences coerced to 0
  // and 100. The same function that reads the index now writes it.
  const vdi = valueDeliveryIndexOf(metrics).index;

  await query(
    `INSERT INTO value_delivery_metrics (id, product_id, owner_id, snapshot_date, core_workflow_completion_rate, feature_utilization_breadth, time_to_first_value_hours, outcome_achievement_rate, engagement_depth_score, value_delivery_index, nps_score, support_ticket_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), productId, ownerId, today,
      metrics.core_workflow_completion_rate ?? null,
      metrics.feature_utilization_breadth ?? null,
      metrics.time_to_first_value_hours ?? null,
      null, // outcome_achievement_rate from input
      metrics.engagement_depth_score ?? null,
      vdi,
      null, // nps_score
      metrics.support_ticket_rate ?? null,
    ]
  );
}
