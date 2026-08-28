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
    expect(silent.channelLabel).toBe('Classes taught');
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

  it('says nothing at all about a company whose watch is being answered', async () => {
    await company('sil_e');
    await recordCompanyObservations({
      productId: 'sil_e', origin: 'rota_job', readings: [{ channelKey: CHANNEL, observedValue: 60 }] });
    expect(await getSilentWatches('sil_e')).toEqual([]);
  });
});
