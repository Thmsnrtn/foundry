// =============================================================================
// FOUNDRY — company-defined observation channels (migration 135)
//
// Independent observation is what lets a responsibility enter Shadowing. Until
// now it was admissible only for twelve hard-coded SaaS metrics, each backed by
// a column in `metric_snapshots`. So an unfamiliar company could be Visible and
// Understood and then stop: no reading it could produce was admissible, and
// Shadowing — and therefore Assisting — was unreachable. That is a
// business-specific branch inside the constitution.
//
// A company declares a quantity it actually tracks, in its own words. From
// there the kernel treats it as an OPAQUE NAMED QUANTITY. It knows readings
// arrived and whether the latest one rose, fell, or held; it does not know what
// the quantity means, and nothing here tries to interpret it. Direction over
// time is business-independent — "boats serviced" and "churn rate" are the same
// shape to an institution asking only whether reality moved the way someone
// said it would.
//
// DELIBERATELY THE SAME SHAPE AS THE BUILT-IN PATH. Observations are written as
// the same `external_metric_ingest` signals with the same `external_metric:*`
// event types, so shadow entry, comparison, and resolution work on them without
// modification. A parallel mechanism would have been a second truth for one
// fact, and the whole point is that the institution should not be able to tell
// these apart.
//
// WHAT A CHANNEL IS NOT. It is not a responsibility, not authority, not consent,
// and not proof that a number is correct. A company saying it tracks something,
// and an outside system reporting a value, are both evidence about the company —
// nothing more.
// =============================================================================

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { recordReconstructionClaim } from './reconstruction.js';
import {
  OBSERVABLE_FIELDS, externalObservationEventType, isObservableField,
  type ObservedDirection,
} from './external-observation.js';

export interface CompanyObservationChannel {
  id: string; channelKey: string; label: string; unit: string | null; revoked: boolean;
}

/** Shape rule, mirrored by the guard in migration 135. */
export function isWellFormedChannelKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{2,39}$/.test(key) && !(OBSERVABLE_FIELDS as readonly string[]).includes(key);
}

/**
 * The company declares a quantity it tracks.
 *
 * An ordinary founder assertion: recorded as canonical evidence and a bounded
 * claim, so the channel has provenance rather than being a configuration row
 * nobody can account for. It is the founder's own words — Foundry does not
 * paraphrase the company back to itself, and it does not infer channels from
 * prose.
 */
export async function registerObservationChannel(input: {
  productId: string; founderId: string; channelKey: string; label: string; unit?: string;
}): Promise<CompanyObservationChannel | null> {
  // Not normalised. The key becomes part of an event type and is matched
  // against stored evidence, so silently transforming it would mean the channel
  // the founder declared is not the one recorded. Refuse instead.
  const channelKey = input.channelKey.trim();
  const label = input.label.trim();
  const unit = input.unit?.trim() || null;
  if (!isWellFormedChannelKey(channelKey) || !label || label.length > 80) return null;
  if (unit !== null && unit.length > 24) return null;

  const owned = await query('SELECT 1 FROM products WHERE id=? AND owner_id=?',
    [input.productId, input.founderId]);
  if (!owned.rows.length) return null;

  const existing = await query(
    'SELECT id,channel_key,label,unit,revoked_at FROM company_observation_channels WHERE product_id=? AND channel_key=?',
    [input.productId, channelKey],
  );
  if (existing.rows.length) return project(existing.rows[0] as Record<string, unknown>);

  const signalId = nanoid();
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_assertion_structured','founder_declared_observation_channel','low',?,?)`,
    [signalId, input.productId,
      JSON.stringify({ founder_id: input.founderId, channel_key: channelKey, label, unit }),
      `The company said it tracks "${label}"`],
  );

  const id = `obch_${nanoid()}`;
  await query(
    `INSERT INTO company_observation_channels (id,product_id,channel_key,label,unit,evidence_signal_id)
     VALUES (?,?,?,?,?,?)`,
    [id, input.productId, channelKey, label, unit, signalId],
  );

  await recordReconstructionClaim({
    productId: input.productId, subject: 'company', predicate: 'observation_channel',
    value: { channelKey, label, unit },
    epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
    derivationMethod: 'authenticated founder channel declaration', observedAt: new Date(),
  });

  return { id, channelKey, label, unit, revoked: false };
}

function project(row: Record<string, unknown>): CompanyObservationChannel {
  return {
    id: String(row.id), channelKey: String(row.channel_key), label: String(row.label),
    unit: row.unit == null ? null : String(row.unit), revoked: row.revoked_at != null,
  };
}

export async function getObservationChannels(productId: string): Promise<CompanyObservationChannel[]> {
  const rows = await query(
    `SELECT id,channel_key,label,unit,revoked_at FROM company_observation_channels
      WHERE product_id=? ORDER BY created_at`, [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map(project);
}

export async function revokeObservationChannel(input: {
  productId: string; channelKey: string; founderId: string;
}): Promise<boolean> {
  const result = await query(
    `UPDATE company_observation_channels SET revoked_at=datetime('now')
      WHERE product_id=? AND channel_key=? AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM products p WHERE p.id=product_id AND p.owner_id=?)`,
    [input.productId, input.channelKey, input.founderId],
  );
  return Number(result.rowsAffected ?? 0) > 0;
}

/**
 * Whether this company may currently have observations admitted for a field.
 *
 * Built-in metrics stay admissible for every company, because they are a source
 * adapter rather than a company statement. A company-defined channel is
 * admissible only while it is declared and not revoked.
 */
export async function isAdmissibleObservationField(
  productId: string, field: string,
): Promise<boolean> {
  if (isObservableField(field)) return true;
  const row = await query(
    `SELECT 1 FROM company_observation_channels
      WHERE product_id=? AND channel_key=? AND revoked_at IS NULL`,
    [productId, field],
  );
  return row.rows.length > 0;
}

function directionOf(previous: number, observed: number): ObservedDirection {
  if (observed > previous) return 'rose';
  if (observed < previous) return 'fell';
  return 'held';
}

/**
 * Record what an outside system reported for company-defined channels.
 *
 * The previous value comes from this channel's own most recent observation, so
 * a company needs no metrics table and no column per quantity. Identity is
 * derived from the reading, so a retry or a replayed webhook converges on the
 * same observation instead of manufacturing a second piece of evidence.
 *
 * A first reading records nothing: with nothing to compare against there is no
 * movement to report, and inventing a direction from a single point would be
 * stating a fact nobody observed.
 */
export async function recordCompanyObservations(input: {
  productId: string; origin: string;
  readings: Array<{ channelKey: string; observedValue: number }>;
}): Promise<Array<{ id: string; channelKey: string; direction: ObservedDirection }>> {
  const recorded: Array<{ id: string; channelKey: string; direction: ObservedDirection }> = [];

  for (const reading of input.readings) {
    const channelKey = String(reading.channelKey ?? '').trim();
    if (!Number.isFinite(reading.observedValue)) continue;
    // Built-ins are handled by the metric path; this admits only declared,
    // unrevoked company channels.
    if (isObservableField(channelKey)) continue;
    if (!await isAdmissibleObservationField(input.productId, channelKey)) continue;

    // The most recent value seen on this channel, whether it was a movement
    // observation or the baseline that started it. No metrics table and no
    // column per quantity.
    const prior = await query(
      `SELECT json_extract(payload_json,'$.observed_value') AS value FROM signal_events
        WHERE product_id=? AND source IN ('external_metric_ingest','company_observation_baseline')
          AND json_extract(payload_json,'$.field')=?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      [input.productId, channelKey],
    );

    if (!prior.rows.length) {
      // Seed the channel with the value itself, so the next reading has
      // something honest to compare against. It is recorded as a reading with
      // no direction claim rather than as movement.
      await seedFirstReading(input.productId, input.origin, channelKey, reading.observedValue);
      continue;
    }
    const previousValue = Number((prior.rows[0] as Record<string, unknown>).value);
    if (!Number.isFinite(previousValue)) continue;

    const direction = directionOf(previousValue, reading.observedValue);
    const eventType = externalObservationEventType(channelKey, direction);
    // Identity is the READING — this company, this channel, this value, today —
    // and deliberately NOT the previous value. Including the prior made a
    // replayed webhook chain: the first post moved 9→14 and recorded a rise,
    // and the identical post behind it moved 14→14 and recorded a hold, so one
    // delivered-twice payload became two contradicting observations and
    // resolved the founder's expectation as deviated. A retry must converge on
    // the observation already recorded.
    const id = 'coobs_' + createHash('sha256')
      .update([input.productId, channelKey, String(reading.observedValue),
        new Date().toISOString().slice(0, 10)].join('\n'))
      .digest('hex').slice(0, 32);

    const seen = await query('SELECT id FROM signal_events WHERE id=?', [id]);
    if (seen.rows.length) continue;

    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES (?,?,'external_metric_ingest',?,'low',?,?)`,
      [id, input.productId, eventType,
        JSON.stringify({
          origin: input.origin, field: channelKey, direction,
          observed_value: reading.observedValue, previous_value: previousValue,
        }),
        `An outside system reported ${channelKey.replaceAll('_', ' ')} ${direction}`],
    );
    recorded.push({ id, channelKey, direction });
  }
  return recorded;
}

/**
 * The first reading on a channel.
 *
 * Recorded under its own source, because it is NOT an observation of movement
 * and must not be counted as one: migration 127's guard requires a direction and
 * a previous value, and rightly so — there is no honest direction to state from
 * a single point. It is a baseline, and Shadowing may not begin on it, only on
 * real movement that followed.
 */
async function seedFirstReading(
  productId: string, origin: string, channelKey: string, observedValue: number,
): Promise<void> {
  const id = 'coobs_' + createHash('sha256')
    .update([productId, channelKey, 'first', String(observedValue),
      new Date().toISOString().slice(0, 10)].join('\n'))
    .digest('hex').slice(0, 32);
  const seen = await query('SELECT id FROM signal_events WHERE id=?', [id]);
  if (seen.rows.length) return;
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'company_observation_baseline',?,'low',?,?)`,
    [id, productId, `company_observation_baseline:${channelKey}`,
      JSON.stringify({ origin, field: channelKey, observed_value: observedValue }),
      `An outside system reported ${channelKey.replaceAll('_', ' ')} for the first time`],
  );
}
