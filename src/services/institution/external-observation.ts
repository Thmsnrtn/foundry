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

// =============================================================================
// TWO CHANNELS, ONE PATH (migration 223)
//
// A reference company exists to be run through this machinery, so it produces
// exactly the observations that decide whether a responsibility may leave
// Shadowing. If those carried the same `source` as a real provider's readings,
// every count that decides what Foundry has earned would silently include
// fiction, and nothing could tell the difference afterwards. So the world's
// readings and the reference world's readings are different channels.
//
// The doc comment on `recordProviderSyncObservations` below argues against
// inventing a new source value, for two specific reasons: the payload guard
// would not fire on it, and the shadow-independence guard would not admit it.
// Migration 223 answers both — one widened guard covering both channels, and a
// sibling independence guard for the reference prefix — which is why this is a
// channel and a provider sync is not.
//
// WRITES NARROW, READS WIDEN. A write must name the channel this company's
// reality entitles it to; a read may union both, because the database
// guarantees a company holds only one. That is what keeps this ONE code path
// rather than two: a rehearsal that travels a different path rehearses nothing.
// =============================================================================

export type CompanyReality = 'real' | 'reference';

/** Every metric observation, of whichever world. Safe to union: see above. */
export function metricObservation(alias = ''): string {
  const c = alias ? `${alias}.` : '';
  return `${c}source IN ('external_metric_ingest', 'reference_metric_ingest')`;
}

/**
 * Which world's readings this company produces.
 *
 * Defaults to real for a company that does not exist, matching the column's own
 * default — a caller passing an unknown id gets refused by the foreign key at
 * the insert, which is a better error than one invented here.
 */
export async function observationChannel(productId: string): Promise<{
  reality: CompanyReality; source: string;
}> {
  const row = (await query('SELECT reality FROM products WHERE id = ?', [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  const reality: CompanyReality = String(row?.reality ?? 'real') === 'reference'
    ? 'reference' : 'real';
  return {
    reality,
    source: reality === 'reference' ? 'reference_metric_ingest' : 'external_metric_ingest',
  };
}

export function externalObservationEventType(
  field: string, direction: ObservedDirection, reality: CompanyReality = 'real',
): string {
  return `${reality === 'reference' ? 'reference' : 'external'}_metric:${field}:${direction}`;
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
  const channel = await observationChannel(input.productId);
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
    const eventType = externalObservationEventType(reading.field, direction, channel.reality);
    const id = 'extobs_' + createHash('sha256')
      .update([input.productId, reading.field, String(previousValue), String(reading.observedValue),
        new Date().toISOString().slice(0, 10)].join('\n'))
      .digest('hex').slice(0, 32);

    const seen = await query('SELECT id FROM signal_events WHERE id=?', [id]);
    if (seen.rows.length) continue;

    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES (?,?,?,?,'low',?,?)`,
      [id, input.productId, channel.source, eventType,
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
/**
 * THE SENSES FOUNDRY ALREADY OWNS, CONNECTED TO THE PART THAT REASONS.
 *
 * Until this, the institution's only external evidence arrived through
 * `POST /ingest/:token` — an endpoint a company has to build a push for. Nine
 * providers were already connected, syncing on a cadence with encrypted
 * credentials, writing `metric_snapshots` and stopping exactly where the public
 * intake used to stop. The reasoning engine and nine sense organs were both
 * built, and wired to different things.
 *
 * WHY THIS IS NOT A NEW KIND OF EVIDENCE, and why no migration was needed. The
 * `source` column answers one question — is this reading independent of
 * Foundry — and migration 127 enforces the three properties that make it so:
 * origin outside, no echo of what it will be compared against, and arrival
 * after the prediction it tests. A provider sync satisfies all three exactly as
 * the intake does; it is if anything a stronger case, because Stripe attests
 * the number rather than the company reporting its own. So the source stays
 * `external_metric_ingest` — the independence CLASS — and the specific
 * provenance goes in `origin`, which the guard already requires to be present
 * and non-empty.
 *
 * Inventing a new source value would have been the mistake available here. The
 * payload guard fires only `WHEN NEW.source='external_metric_ingest'`, so a new
 * one would be unguarded, and the shadow-independence guard admits only that
 * source, so the observation could resolve nothing. It would have produced
 * unchecked rows that call themselves evidence — the precise failure migration
 * 127 exists to prevent.
 *
 * Only the fields the provider says it wrote are read. A sync reports its own
 * `metricsUpdated`, so nothing here guesses which provider supplied which
 * number.
 */
export async function recordProviderSyncObservations(input: {
  productId: string; provider: string; fieldsWritten: string[];
}): Promise<Array<{ id: string; field: string; direction: ObservedDirection }>> {
  // A provider name reaches `origin`, so it is bounded rather than passed on.
  // `integrations.provider` lost its CHECK in migration 081 and is written at
  // connect time, so the column is not the guarantee it looks like.
  if (!/^[a-z0-9_]{1,32}$/.test(input.provider)) return [];

  const fields = input.fieldsWritten.filter(isObservableField);
  if (fields.length === 0) return [];

  // Interpolated because a column name cannot be bound, and safe because every
  // name has been through `isObservableField` — the same closed list migration
  // 127's trigger enforces.
  const today = await query(
    `SELECT ${fields.join(', ')} FROM metric_snapshots
      WHERE product_id = ? AND snapshot_date = date('now') LIMIT 1`,
    [input.productId],
  );
  if (!today.rows.length) return [];

  const row = today.rows[0] as Record<string, unknown>;
  const readings = fields
    .map((field) => ({ field, observedValue: Number(row[field]) }))
    .filter((r) => Number.isFinite(r.observedValue));
  if (readings.length === 0) return [];

  return recordExternalMetricObservations({
    productId: input.productId, origin: `provider_sync:${input.provider}`, readings,
  });
}

export async function availableObservationChannels(productId: string): Promise<ObservableField[]> {
  const rows = await query(
    `SELECT DISTINCT json_extract(payload_json,'$.field') AS field FROM signal_events
      WHERE product_id=? AND ${metricObservation()}`, [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>)
    .map((r) => String(r.field)).filter(isObservableField);
}
