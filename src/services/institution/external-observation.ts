// =============================================================================
// FOUNDRY — Externally observed company reality (migration 127)
//
// The single writer of `external_metric_ingest` observations, and the
// institution's only source of evidence it did not produce itself.
//
// The reading comes from `POST /ingest/:token`: a public, token-authenticated
// endpoint that outside tools already post company metrics to. Nothing new was
// integrated for this. What was missing is that the institution never saw it —
// the intake wrote `metric_snapshots` and stopped.
//
// What this deliberately does NOT do: interpret. It says a named metric moved
// in a named direction between two values that came from outside, which is
// arithmetic on reported numbers. It says nothing about why, and nothing about
// whether anyone handled anything. Turning "support volume fell" into "support
// is being handled" is exactly the inference an expectation exists to test.
// =============================================================================

import { createHash } from 'node:crypto';
import { query } from '../../db/client.js';

/** The metric columns the public intake accepts. Mirrors migration 127. */
export const OBSERVABLE_FIELDS = [
  'new_mrr_cents', 'expansion_mrr_cents', 'contraction_mrr_cents', 'churned_mrr_cents',
  'activation_rate', 'day_30_retention', 'churn_rate', 'mrr_health_ratio',
  'signups_7d', 'active_users', 'support_volume_7d', 'nps_score',
] as const;
export type ObservableField = typeof OBSERVABLE_FIELDS[number];

export type ObservedDirection = 'rose' | 'fell' | 'held';

export function isObservableField(value: string): value is ObservableField {
  return (OBSERVABLE_FIELDS as readonly string[]).includes(value);
}

export function externalObservationEventType(field: string, direction: ObservedDirection): string {
  return `external_metric:${field}:${direction}`;
}

function directionOf(previous: number, observed: number): ObservedDirection {
  if (observed > previous) return 'rose';
  if (observed < previous) return 'fell';
  return 'held';
}

/**
 * Record what an outside system reported, as one bounded observation per field.
 *
 * Identity is derived from the reading itself, so the same post arriving twice —
 * a retry, a duplicated webhook, a replayed request — is the same observation
 * rather than a second piece of evidence.
 *
 * Returns the observations actually recorded (an unchanged metric with no prior
 * reading records nothing: there is no movement to report).
 */
export async function recordExternalMetricObservations(input: {
  productId: string; origin: string;
  readings: Array<{ field: string; observedValue: number }>;
}): Promise<Array<{ id: string; field: string; direction: ObservedDirection }>> {
  const recorded: Array<{ id: string; field: string; direction: ObservedDirection }> = [];
  for (const reading of input.readings) {
    if (!isObservableField(reading.field) || !Number.isFinite(reading.observedValue)) continue;

    // The previous externally reported value for this metric, from an earlier
    // day. Today's row is the one being written, so it is excluded.
    const prior = await query(
      `SELECT ${reading.field} AS value FROM metric_snapshots
        WHERE product_id=? AND ${reading.field} IS NOT NULL
          AND snapshot_date < date('now')
        ORDER BY snapshot_date DESC LIMIT 1`,
      [input.productId],
    );
    if (!prior.rows.length) continue; // nothing to compare against yet
    const previousValue = Number((prior.rows[0] as Record<string, unknown>).value);
    if (!Number.isFinite(previousValue)) continue;

    const direction = directionOf(previousValue, reading.observedValue);
    const eventType = externalObservationEventType(reading.field, direction);
    const id = 'extobs_' + createHash('sha256')
      .update([input.productId, reading.field, String(previousValue), String(reading.observedValue),
        new Date().toISOString().slice(0, 10)].join('\n'))
      .digest('hex').slice(0, 32);

    const seen = await query('SELECT id FROM signal_events WHERE id=?', [id]);
    if (seen.rows.length) continue;

    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES (?,?,'external_metric_ingest',?,'low',?,?)`,
      [id, input.productId, eventType,
        JSON.stringify({
          origin: input.origin, field: reading.field, direction,
          observed_value: reading.observedValue, previous_value: previousValue,
        }),
        `An outside system reported ${reading.field.replaceAll('_', ' ')} ${direction}`],
    );
    recorded.push({ id, field: reading.field, direction });
  }
  return recorded;
}

/**
 * Fields this company has actually received outside readings for.
 *
 * Shadowing may only begin on a channel that has already produced real external
 * evidence. Without this, entering the rung would be a promise that observation
 * will arrive rather than proof that it does.
 */
export async function availableObservationChannels(productId: string): Promise<ObservableField[]> {
  const rows = await query(
    `SELECT DISTINCT json_extract(payload_json,'$.field') AS field FROM signal_events
      WHERE product_id=? AND source='external_metric_ingest'`, [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>)
    .map((r) => String(r.field)).filter(isObservableField);
}
