// =============================================================================
// HOW FAR THE WORLD HAS ANSWERED: CE0–CE6, READ FROM ROWS, NEVER RAISED.
//
// RIVER.md keeps commercial evidence apart from implementation proof, and
// until now the commercial ladder existed only as prose graded by hand. The
// owner's handoff of 28 September asks for it on every asset. The reader
// climbs only on real rows from somebody the provider could not match to the
// owner, and stops at CE4: repeat and sustained contribution are judgements no
// row makes.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'ce@example.com';

import { nanoid } from 'nanoid';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveListing, recordListing, recordVenueOrder, seedProof2 } from '../../src/services/venture/proof-2.js';
import { recordBusinessOutcome, registerInternalCounterparty } from '../../src/services/venture/outcome.js';
import { commercialMaturityOf, commercialMaturitySentence } from '../../src/services/venture/commercial-maturity.js';

const OWNER = 'ce_owner';
let X = '';
let EXPOSURE = '';
const rung = async () => (await commercialMaturityOf(X)).rung;
const order = (ref: string) => recordVenueOrder({ founderId: OWNER, experimentId: X,
  order: { orderRef: ref, paidAt: new Date(Date.now() - 3600_000).toISOString(), grossCents: 1400, feeCents: 158 } });
const fulfilmentOf = (ref: string) => `SELECT id FROM experiment_fulfilments WHERE payment_ref = '${ref}'`;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_ce', 'ce@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/7766554433/workbook' });
  EXPOSURE = String(((await query('SELECT id FROM experiment_exposures WHERE experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
});

describe('the ladder, climbed only by real rows', () => {
  it('a test nobody can find is CE0, and says so', async () => {
    const m = await commercialMaturityOf('no_such_test');
    expect(m.rung).toBe('CE0');
  });

  it('a real, direct observation behind its claim is CE1, and no more', async () => {
    const m = await commercialMaturityOf(X);
    expect(m.rung).toBe('CE1');
    expect(commercialMaturitySentence(m)).toMatch(/^Commercial evidence: CE1 — a direct observation/);
  });

  it('the owner buying his own listing raises nothing', async () => {
    await registerInternalCounterparty({ founderId: OWNER, provider: 'etsy', reference: 'order:5100000001', relation: 'owner', by: `founder:${OWNER}` });
    await order('5100000001');
    expect(await rung()).toBe('CE1');
  });

  it('somebody unmatched beginning to pay is CE2', async () => {
    await recordBusinessOutcome({ exposureId: EXPOSURE, kind: 'checkout_started', amountCents: null, currency: 'usd',
      observedAt: new Date(Date.now() - 7200_000), provider: 'etsy', providerRef: 'cart:5100000002', payerReference: 'order:5100000002', arrivedVia: 'etsy' });
    expect(await rung()).toBe('CE2');
  });

  it('a payment that stays paid, not yet delivered, is CE3', async () => {
    const paid = await recordBusinessOutcome({ exposureId: EXPOSURE, kind: 'payment', amountCents: 1400, currency: 'usd',
      observedAt: new Date(Date.now() - 5400_000), provider: 'etsy', providerRef: '5100000003', payerReference: 'order:5100000003', arrivedVia: 'etsy' });
    if ('refused' in paid) throw new Error(paid.refused);
    await query(`INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, amount_cents, currency, observed_how)
      VALUES (?,?,?,?,?,'etsy','5100000003',1400,'usd','venue_reported')`, [nanoid(), OWNER, X, EXPOSURE, paid.id]);
    const m = await commercialMaturityOf(X);
    expect(m.rung).toBe('CE3');
    expect(m.next).toMatch(/delivered/);
  });

  it('paid and made available by the venue is CE4, and says the download was not seen', async () => {
    await order('5100000004');
    const m = await commercialMaturityOf(X);
    expect(m.rung).toBe('CE4');
    expect(m.because).toMatch(/download itself is not observed/);
    expect(m.next).toMatch(/CE5 and CE6 .* not read from any row/);
  });
});

describe('what takes a rung away', () => {
  it('an open dispute on the only delivered sale is not money still paid', async () => {
    await query(`UPDATE experiment_fulfilments SET disputed_at = datetime('now') WHERE id = (${fulfilmentOf('5100000004')})`);
    expect(await rung()).toBe('CE3');
  });

  it('a refund of the paid one leaves only the commitment', async () => {
    await query(`UPDATE experiment_fulfilments SET status = 'refunded', refund_ref = 're_1' WHERE id = (${fulfilmentOf('5100000003')})`);
    expect(await rung()).toBe('CE2');
  });

  it('a dispute the buyer lost is money still paid again', async () => {
    await query(`UPDATE experiment_fulfilments SET dispute_outcome = 'won' WHERE id = (${fulfilmentOf('5100000004')})`);
    expect(await rung()).toBe('CE4');
  });
});

describe('which delivery the sentence describes', () => {
  it('names the delivery that earned the rung, not the owner\'s own earlier one', async () => {
    // The owner's own Etsy order (5100000001) was delivered first. Refund the only
    // unmatched Etsy delivery, and let an unmatched buyer pay and receive by mail.
    await query(`UPDATE experiment_fulfilments SET status = 'refunded', refund_ref = 're_2' WHERE id = (${fulfilmentOf('5100000004')})`);
    const paid = await recordBusinessOutcome({ exposureId: EXPOSURE, kind: 'payment', amountCents: 1400, currency: 'usd',
      observedAt: new Date(Date.now() - 1800_000), provider: 'stripe', providerRef: 'pi_ce_1', payerReference: 'buyer-ce@example.com', arrivedVia: 'payment_link' });
    if ('refused' in paid) throw new Error(paid.refused);
    const f = nanoid();
    await query(`INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, amount_cents, currency)
      VALUES (?,?,?,?,?,'stripe','pi_ce_1',1400,'usd')`, [f, OWNER, X, EXPOSURE, paid.id]);
    await query(`UPDATE experiment_fulfilments SET status = 'delivered' WHERE id = ?`, [f]);
    const m = await commercialMaturityOf(X);
    expect(m.rung).toBe('CE4');
    expect(m.because).toMatch(/provider confirmed delivery/);
  });
});

describe('where the owner reads it', () => {
  it('on the test\'s own page, and in the operating contract\'s first answer, in the same words', async () => {
    const sentence = commercialMaturitySentence(await commercialMaturityOf(X));
    const { Hono } = await import('hono');
    const { experimentRoutes } = await import('../../src/routes/dashboard/experiments-place.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'ce@example.com' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
    app.route('/', experimentRoutes);
    const page = await (await app.request(`https://f.test/foundry/experiments/${X}`)).text();
    expect(page).toContain('id="commercial"');
    expect(page.replace(/&mdash;/g, '—')).toContain(sentence.replace(/"/g, '&quot;').slice(0, 60));

    const { operatingContractOf } = await import('../../src/services/venture/operating-contract.js');
    const product = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
    const contract = await operatingContractOf(product, OWNER);
    expect(contract?.answers[0]?.answer).toContain(sentence);
  });
});
