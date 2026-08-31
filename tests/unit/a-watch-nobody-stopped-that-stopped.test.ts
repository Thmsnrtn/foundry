process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  recordCompanyObservations, registerObservationChannel, revokeObservationChannel,
} from '../../src/services/institution/company-observation.js';
import {
  beginExternalMetricShadowing, getDarkenedWatches, getSilentWatches,
} from '../../src/services/institution/external-shadowing.js';
import { recordExternalMetricObservations } from '../../src/services/institution/external-observation.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// A WATCH NOBODY STOPPED, THAT STOPPED.
//
// The darkened card says what ended when the founder disconnected a channel.
// Its twin was missing: a channel nobody revoked that simply goes quiet. The
// consequence is identical — the expectation stays open, so the responsibility
// sits at Shadowing for good and cannot reach Assisting — and the cause is one
// the founder did not choose and had nothing pointing at it.
//
// "For good" is literal rather than eventual. Neither founder-facing door
// supplies an expectation window, so nothing expires and there is no later
// moment at which this resolves itself.
//
// A date, not a verdict. Foundry does not know this company's reporting cadence
// and will not decide how quiet is too quiet on the owner's behalf.
// =============================================================================

const OWNER = 'sil_owner';
const CHANNEL = 'classes_taught';

let app: Hono;

/** A company whose responsibility is Understood and whose channel has spoken. */
async function company(id: string): Promise<string> {
  const resp = `${id}_resp`;
  await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Fold Street Dance',?)`, [id, OWNER]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'repository','development_need_observed','low','{}','seed')`, [`${id}_sig`, id]);
  await query(`INSERT INTO institutional_responsibilities
      (id,product_id,title,capability,state,discovery_evidence_ref)
    VALUES (?,?,'Every timetabled class has a teacher','operations','visible',?)`,
  [resp, id, `signal_event:${id}_sig`]);
  await moveResponsibilityTo(resp, 'understood', { productId: id });
  await registerObservationChannel({
    productId: id, founderId: OWNER, channelKey: CHANNEL, label: 'Classes taught', unit: 'classes' });
  // Shadowing may only begin on a channel that has already produced real
  // outside evidence, so a watch with no reading behind it cannot exist.
  await recordCompanyObservations({ productId: id, origin: 'rota_job', readings: [{ channelKey: CHANNEL, observedValue: 40 }] });
  await recordCompanyObservations({ productId: id, origin: 'rota_job', readings: [{ channelKey: CHANNEL, observedValue: 44 }] });
  // The channel spoke BEFORE the founder started watching, which is the only
  // order production can reach: shadowing may not begin on a silent channel.
  // Timestamps here are one-second resolution, so without this every reading in
  // the fixture shares the expectation's second and is correctly treated as
  // possibly-later — the ambiguity the query refuses to call silence.
  await query(`UPDATE signal_events SET created_at=datetime('now','-1 hour')
    WHERE product_id=? AND source='external_metric_ingest'`, [id]);
  await beginExternalMetricShadowing({
    productId: id, responsibilityId: resp, founderId: OWNER, field: CHANNEL, direction: 'rose' });
  return resp;
}

const letter = async (): Promise<string> => (await app.request('/letter')).text();

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'sil_c','o@example.com')`, [OWNER]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'o@example.com', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

describe('a watch nobody stopped, that stopped', () => {
  it('says when the channel last spoke, and does not say whether that is a problem', async () => {
    await company('sil_a');
    const [silent] = await getSilentWatches('sil_a');
    expect(silent).toBeTruthy();
    expect(silent.title).toBe('Every timetabled class has a teacher');
    // The founder's own words for it, with the unit, exactly as the form that
    // offered the watch labelled it. The label rule is stated once and shared,
    // so the two surfaces cannot name the same channel differently.
    expect(silent.channelLabel).toBe('Classes taught (classes)');
    expect(silent.lastReadingAt).toBeTruthy();
    expect(silent.watchingSince).toBeTruthy();
  });

  it('stops saying it the moment a reading arrives', async () => {
    await company('sil_b');
    expect(await getSilentWatches('sil_b')).toHaveLength(1);

    await recordCompanyObservations({
      productId: 'sil_b', origin: 'rota_job', readings: [{ channelKey: CHANNEL, observedValue: 51 }] });

    // The channel is speaking. Whatever else may be true, silence is not.
    expect(await getSilentWatches('sil_b')).toEqual([]);
  });

  it('leaves a channel the founder disconnected to the card that is about that', async () => {
    await company('sil_c');
    expect(await revokeObservationChannel({ productId: 'sil_c', founderId: OWNER, channelKey: CHANNEL })).toBe(true);

    // Two different facts about why a watch is not moving, and the founder is
    // owed the one that is true. Naming a disconnection as silence would hide
    // their own decision from them.
    expect(await getSilentWatches('sil_c')).toEqual([]);
    expect((await getDarkenedWatches('sil_c')).map((w) => w.channelLabel)).toEqual(['Classes taught']);
  });

  it('reaches the founder, on the page beside the card for the other cause', async () => {
    await company('sil_d');
    const page = await letter();
    expect(page).toContain('I am watching, and nothing is coming in');
    expect(page).toContain('Every timetabled class has a teacher');
    expect(page).toContain('Classes taught');
    expect(page).toContain('I am not going to guess whether that is a problem');
    // The founder did not disconnect anything, and is not told they did.
    expect(page).not.toContain('I have stopped watching');
  });

  it('sees a watch opened on a built-in metric, which it once could not', async () => {
    // THE HALF THIS CARD WAS BLIND TO. It was written by joining
    // `company_observation_channels`, copying the darkened query beside it —
    // but that join is right THERE for a reason that does not carry: only a
    // declared channel can be revoked, so only a declared channel can go dark.
    // Any channel can go quiet, and the watch form offers built-in metrics and
    // declared channels alike. For every company that posts the standard
    // metrics and declares nothing of its own, this list was structurally
    // empty and read as "no watch of mine has gone quiet".
    const id = 'sil_builtin';
    const resp = `${id}_resp`;
    await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Standard Metrics Co',?)`, [id, OWNER]);
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES (?,?,'repository','development_need_observed','low','{}','seed')`, [`${id}_sig`, id]);
    await query(`INSERT INTO institutional_responsibilities
        (id,product_id,title,capability,state,discovery_evidence_ref)
      VALUES (?,?,'Answer the people who write in','operations','visible',?)`,
    [resp, id, `signal_event:${id}_sig`]);
    await moveResponsibilityTo(resp, 'understood', { productId: id });

    // No declared channel at all — the built-in vocabulary, arriving the only
    // way it can: `/ingest/:token` calls `recordExternalMetricObservations`,
    // which compares against a snapshot from an earlier day.
    await query(`INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d)
      VALUES (?,?,date('now','-2 days'),30)`, [`${id}_snap`, id]);
    await recordExternalMetricObservations({
      productId: id, origin: 'metrics', readings: [{ field: 'support_volume_7d', observedValue: 24 }] });
    await query(`UPDATE signal_events SET created_at=datetime('now','-1 hour')
      WHERE product_id=? AND source='external_metric_ingest'`, [id]);
    await beginExternalMetricShadowing({
      productId: id, responsibilityId: resp, founderId: OWNER, field: 'support_volume_7d', direction: 'fell' });

    const [silent] = await getSilentWatches(id);
    expect(silent, 'a watch on a built-in metric can go quiet like any other').toBeTruthy();
    expect(silent.channelKey).toBe('support_volume_7d');
    expect(silent.channelLabel).toBe('how much support comes in');
    expect(silent.lastReadingAt).toBeTruthy();

    // And it stops the moment that channel speaks again.
    await recordExternalMetricObservations({
      productId: id, origin: 'metrics', readings: [{ field: 'support_volume_7d', observedValue: 31 }] });
    expect(await getSilentWatches(id)).toEqual([]);
  });

  it('says nothing at all about a company whose watch is being answered', async () => {
    await company('sil_e');
    await recordCompanyObservations({
      productId: 'sil_e', origin: 'rota_job', readings: [{ channelKey: CHANNEL, observedValue: 60 }] });
    expect(await getSilentWatches('sil_e')).toEqual([]);
  });
});
