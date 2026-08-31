process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordProviderSyncObservations } from '../../src/services/institution/external-observation.js';

// =============================================================================
// NINE SENSES WIRED TO ANOTHER BRAIN.
//
// The institution's only external evidence arrived through `POST /ingest/:token`
// — an endpoint a company has to build a push for. Nine providers were already
// connected, syncing on a cadence with encrypted credentials, writing
// `metric_snapshots` and stopping exactly where the public intake stopped
// before migration 127. The reasoning engine and nine sense organs were both
// built and wired to different things, so `assisting` was reachable only by a
// company willing to do integration work Foundry had already done.
//
// The source stays `external_metric_ingest` because that column answers one
// question — is this reading independent of Foundry — and a provider sync meets
// migration 127's three properties exactly as the intake does. Inventing a new
// source was the mistake available here: the payload guard fires only WHEN
// source='external_metric_ingest', so a new value would be unguarded, and the
// shadow-independence guard admits only that source, so the row could resolve
// nothing. Unchecked rows calling themselves evidence is what 127 exists to
// prevent.
// =============================================================================

const P = 'p_bridge';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('f_b','c_b','b@example.com')");
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme','f_b','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM signal_events');
  await query('DELETE FROM metric_snapshots');
});

/** Yesterday's reading and today's, the shape a cadence sync leaves behind. */
async function twoDays(field: string, before: number, now: number): Promise<void> {
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${field})
     VALUES ('ms_prev', ?, date('now','-1 day'), ?)`, [P, before]);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${field})
     VALUES ('ms_today', ?, date('now'), ?)`, [P, now]);
}

describe('a provider sync becomes evidence the institution can use', () => {
  it('records the movement, naming the provider that reported it', async () => {
    await twoDays('active_users', 100, 140);

    const out = await recordProviderSyncObservations({
      productId: P, provider: 'stripe', fieldsWritten: ['active_users'] });

    expect(out.map((o) => o.field)).toEqual(['active_users']);
    expect(out[0].direction).toBe('rose');

    const row = (await query(
      'SELECT source, event_type, payload_json FROM signal_events WHERE id = ?', [out[0].id]
    )).rows[0] as Record<string, unknown>;

    // The independence class the shadow guard admits. A different value here
    // would be a row no expectation could ever be resolved by.
    expect(String(row.source)).toBe('external_metric_ingest');
    expect(String(row.event_type)).toBe('external_metric:active_users:rose');
    const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
    expect(payload.origin, 'the specific provenance, distinct from a company self-report')
      .toBe('provider_sync:stripe');
    expect(payload.previous_value).toBe(100);
    expect(payload.observed_value).toBe(140);
  });

  it('records only the fields the provider says it wrote', async () => {
    await twoDays('active_users', 100, 140);
    // `mrr_cents` is a real Stripe column and NOT an observable field; the
    // provider reports it in metricsUpdated and it must not become evidence.
    const out = await recordProviderSyncObservations({
      productId: P, provider: 'stripe', fieldsWritten: ['mrr_cents', 'active_users'] });
    expect(out.map((o) => o.field)).toEqual(['active_users']);
  });

  it('says nothing when there is nothing to compare against', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, active_users)
       VALUES ('ms_only', ?, date('now'), 140)`, [P]);
    const out = await recordProviderSyncObservations({
      productId: P, provider: 'stripe', fieldsWritten: ['active_users'] });
    expect(out, 'a first reading is not a movement').toEqual([]);
  });

  it('refuses a provider name that is not one', async () => {
    await twoDays('active_users', 100, 140);
    // `integrations.provider` lost its CHECK in migration 081 and is written at
    // connect time, so this value is not guaranteed by the column.
    for (const bad of ['', 'stripe; drop', '../../etc', 'x'.repeat(40)]) {
      expect(await recordProviderSyncObservations({
        productId: P, provider: bad, fieldsWritten: ['active_users'] })).toEqual([]);
    }
    expect((await query('SELECT count(*) c FROM signal_events')).rows[0]).toEqual({ c: 0 });
  });

  it('does not record the same movement twice across repeated syncs', async () => {
    await twoDays('active_users', 100, 140);
    const first = await recordProviderSyncObservations({
      productId: P, provider: 'posthog', fieldsWritten: ['active_users'] });
    const second = await recordProviderSyncObservations({
      productId: P, provider: 'posthog', fieldsWritten: ['active_users'] });
    expect(first).toHaveLength(1);
    expect(second, 'a cadence sync runs hourly; the movement happened once').toEqual([]);
  });
});

describe('the guard still governs the path it now shares', () => {
  it('refuses an unguarded payload written under this source', async () => {
    // The whole reason the source value is reused rather than invented: this
    // trigger fires WHEN source='external_metric_ingest', so every reading that
    // arrives this way is checked. A new source would have skipped it.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('bad_1',?,'external_metric_ingest','external_metric:active_users:rose','low',?,'x')`,
      [P, JSON.stringify({ origin: 'provider_sync:stripe', field: 'active_users',
        direction: 'rose', observed_value: 140 })], // previous_value missing
    )).rejects.toThrow(/payload_invalid/);
  });

  it('refuses an observation that names what it will be compared against', async () => {
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('bad_2',?,'external_metric_ingest','external_metric:active_users:rose','low',?,'x')`,
      [P, JSON.stringify({ origin: 'provider_sync:stripe', field: 'active_users',
        direction: 'rose', observed_value: 140, previous_value: 100,
        expectation_id: 'x_1' })],
    )).rejects.toThrow(/circular_grounding/);
  });

  it('is actually called by the sync path, not merely available to it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const sync = stripComments(readFileSync(
      resolve(import.meta.dirname, '../../src/services/integrations/sync.ts'), 'utf8'));
    expect(sync, 'the bridge is unreachable if the sync does not call it')
      .toContain('recordProviderSyncObservations');
    // It must run on the success path — after the provider switch, not inside
    // a branch that only some providers take.
    const call = sync.indexOf('recordProviderSyncObservations');
    const failed = sync.indexOf('async function markSyncFailed');
    expect(call).toBeGreaterThan(-1);
    expect(call, 'the call must sit in runIntegrationSync, before the helpers')
      .toBeLessThan(failed);
  });
});
