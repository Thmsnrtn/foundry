// =============================================================================
// THE SECOND REAL EXPERIMENT IS A LISTING THE OWNER PLACES HIMSELF.
//
//   seed → Approve (the general control; seals the design, sets the allowance,
//   records that Foundry writes to nobody and publishes nothing) → the owner
//   opens the shop and lists it (his acts, outside) → he pastes the address
//   (the exposure) → he enters the venue's readings → an order from the
//   statement → the sealed rule settles it → a refund is a reason to stop.
//
// Nothing is sent, spent, published or contacted by Foundry anywhere below.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.RESEND_API_KEY = 're_test_key';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import {
  PROOF2_ALLOWANCE_CENTS, PROOF2_PLAN, PROOF2_TITLE, recordListing, recordVenueOrder, recordVenueRefund, seedProof2, settleListings,
} from '../../src/services/venture/proof-2.js';
import { HOW_TO_MD, LISTING_MD, OWNER_ACTS_MD, PRIVACY_POLICY_MD, WORKBOOK_BYTES, WORKBOOK_SHA256 } from '../../src/services/venture/proof-2-content.js';
import { runHand } from '../../src/services/venture/hand.js';
import { getExperimentView } from '../../src/services/founder/experiment-view.js';
import { exposureOf } from '../../src/services/venture/outcome.js';
import { designOf, readStopConditions } from '../../src/services/venture/probe-design.js';

const OWNER = 'l_owner'; const OTHER = 'l_other'; const FOUNDRY = 'l_foundry';
// The venue's facts are dated by the wall clock: the window opens when the
// address is pasted (now), and an outcome more than fifteen minutes ahead of
// the clock is refused by trigger. So the venue's events are dated a few
// minutes after the listing, inside that grace, and settlement reads later.
const NOW = new Date();
const iso = (minutesAhead: number) => new Date(Date.now() + minutesAhead * 60_000).toISOString();
const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString().slice(0, 10);
const { fetch: fetchStub, state } = providerStubs();
let app: Hono;
let currentFounder: Record<string, unknown> = { id: OWNER, email: 'thomas@example.com', preferences: {} };
let X = '';
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text() }; };
const post = (path: string, fields: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const redirectedTo = (r: Response) => r.headers.get('location') ?? '';

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?),(?,?,?,?)`,
    [OWNER, 'l_clk', 'thomas@example.com', 'Thomas Norton', OTHER, 'l_clk2', 'other@example.com', 'Other']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'rehearsal')`, [FOUNDRY]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, currentFounder as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('the seed carries the files it says it does', () => {
  it('embeds river/proof-2/*.md verbatim and names the workbook by digest', () => {
    expect(LISTING_MD).toBe(readFileSync('river/proof-2/listing.md', 'utf8'));
    expect(HOW_TO_MD).toBe(readFileSync('river/proof-2/how-to.md', 'utf8'));
    expect(PRIVACY_POLICY_MD).toBe(readFileSync('river/proof-2/privacy-policy.md', 'utf8'));
    expect(OWNER_ACTS_MD).toBe(readFileSync('river/proof-2/owner-acts.md', 'utf8'));
    const wb = readFileSync('river/proof-2/bid-decision-workbook.xlsx');
    expect(createHash('sha256').update(wb).digest('hex')).toBe(WORKBOOK_SHA256);
    expect(wb.length).toBe(WORKBOOK_BYTES);
    expect(PROOF2_PLAN.price).toMatchObject({ amountCents: 1400, currency: 'USD' });
    expect(LISTING_MD).toMatch(/AI/);
  });
  it('migration 318 widened the stop vocabulary once and put the triggers back', async () => {
    expect((await query(`SELECT kind FROM probe_stop_kinds WHERE kind = 'refunds'`)).rows).toHaveLength(1);
    await expect(query(`INSERT INTO probe_stop_kinds (kind, what_it_is, counts, counted_one, counted_many, sort_order) VALUES ('x','x','x','x','x',9)`)).rejects.toThrow(/constitutional/);
  });
});

describe('the owner\'s part is one approval, then his own acts outside', () => {
  it('act 0 (Foundry): the design and the workbook exist as venture rows; nothing is sent, spent, published or permitted', async () => {
    const seeded = await seedProof2(OWNER);
    X = seeded.experimentId;
    expect(seeded.alreadyExisted).toBe(false);
    expect(await seedProof2(OWNER)).toMatchObject({ experimentId: X, alreadyExisted: true });
    const e = (await query('SELECT decision, settles_when, needs_workshop, cost_cents FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(e).toMatchObject({ decision: null, needs_workshop: 0, cost_cents: PROOF2_ALLOWANCE_CENTS });
    expect(JSON.parse(String(e.settles_when))).toMatchObject({ event: 'payment', at_least: 1, within_days: 30 });
    expect((await query('SELECT COUNT(*) AS n FROM market_observations WHERE claim_id = (SELECT claim_id FROM venture_experiments WHERE id = ?)', [X])).rows[0]).toMatchObject({ n: 7 });
    const design = (await designOf(X))!;
    expect(design.sealedAt).toBeNull();
    expect((await readStopConditions(X)).map((s) => s.kind)).toEqual(expect.arrayContaining(['complaints', 'refunds', 'unfulfillable']));
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.state).toBe('ready');
    expect(v.steps.map((s) => `${s.key}:${s.status}`)).toEqual(['allow:todo', 'listing:todo', 'readings:todo', 'placing:foundry']);
    expect(v.offer.deliverable.title).toBe(PROOF2_TITLE);
    expect(await getExperimentView(OTHER, X, NOW)).toBeNull();
    expect(await runHand({ now: NOW })).toEqual([]);
    expect(await settleListings({ now: NOW })).toEqual([]);
    expect(state.sends).toHaveLength(0);
    const p = await page(`/foundry/experiments/${X}`);
    expect(p.status).toBe(200);
    expect(p.text).toContain('a listing you place yourself');
    expect(p.text).toContain(`/foundry/experiments/${X}/allow`);
    expect(p.text).toContain('Open the Etsy shop');
    expect(p.text).not.toContain('Email sending');
  });

  it('act 1 (owner): Approve seals the design, sets the allowance and records that Foundry contacts nobody and publishes nothing; another founder is refused', async () => {
    currentFounder = { id: OTHER, email: 'other@example.com', preferences: {} };
    expect((await post(`/foundry/experiments/${X}/allow`)).status).toBe(403);
    currentFounder = { id: OWNER, email: 'thomas@example.com', preferences: {} };
    expect(redirectedTo(await post(`/foundry/experiments/${X}/allow`))).toContain('done=approved');
    const e = (await query('SELECT decision, decided_by FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(e).toMatchObject({ decision: 'approved', decided_by: `founder:${OWNER}` });
    expect((await designOf(X))!.sealedAt).not.toBeNull();
    const asset = (await query('SELECT id, standing FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(asset.standing).toBe('experimental');
    expect((await query('SELECT amount_cents FROM owner_allowances WHERE product_id = ? AND withdrawn_at IS NULL', [String(asset.id)])).rows[0]).toMatchObject({ amount_cents: PROOF2_ALLOWANCE_CENTS });
    const b = (await query(`SELECT subject, mode FROM owner_boundaries WHERE product_id = ? AND lifted_at IS NULL ORDER BY subject`, [String(asset.id)])).rows;
    expect(b).toEqual(expect.arrayContaining([expect.objectContaining({ subject: 'contact_people', mode: 'never' }), expect.objectContaining({ subject: 'publish', mode: 'never' })]));
    expect((await query('SELECT COUNT(*) AS n FROM proposed_acts WHERE experiment_id = ?', [X])).rows[0]).toMatchObject({ n: 0 });
    expect(redirectedTo(await post(`/foundry/experiments/${X}/allow`))).toContain('error=already');
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.state).toBe('running');
    expect(v.blocking).toEqual(['open the shop and list it', 'paste the listing address']);
    expect(await runHand({ now: NOW })).toEqual([]);
    expect(state.sends).toHaveLength(0);
    expect((await page('/foundry')).text).toContain(`/foundry/experiments/${X}#listing`);
  });

  it('act 2 (owner): the listing address is the exposure; it must be on the venue', async () => {
    await expect(recordListing({ founderId: OWNER, experimentId: X, url: 'https://example.com/listing/1' })).rejects.toThrow(/Etsy/);
    expect(redirectedTo(await post(`/foundry/experiments/${X}/listing`, { url: 'https://www.etsy.com/listing/123456/bid-decision-workbook' }))).toContain('done=listed');
    const x = (await exposureOf(X))!;
    expect(x).toMatchObject({ provider: 'etsy', exposureRef: 'https://www.etsy.com/listing/123456/bid-decision-workbook', withdrawnAt: null });
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.stateLabel).toBe('Listed');
    expect(v.offer.paymentLinkUrl).toBe('https://www.etsy.com/listing/123456/bid-decision-workbook');
    expect(v.steps.map((s) => `${s.key}:${s.status}`)).toEqual(['allow:done', 'listing:done', 'readings:todo', 'placing:foundry']);
    const s = await settleListings({ now: NOW });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ experimentId: X, settled: null });
    expect(s[0].because).toMatch(/0 of 1 payment so far/);
    expect((await page(`/foundry/experiments/${X}`)).text).toContain('What the venue reports');
  });

  it('act 3 (owner): a reading with no order is recorded from absence; an order is the venue\'s fact and the ledger\'s', async () => {
    expect(redirectedTo(await post(`/foundry/experiments/${X}/reading`, { date: yesterday, impressions: '140', views: '9', visits: '7', favourites: '1', orders: '0', sources: 'Etsy search 6, Etsy app & other pages 3', queries: 'bid tracker (position 18)' }))).toContain('done=reading');
    const obs = (await query(`SELECT saw, from_absence, source_type FROM market_observations WHERE source = ?`, [`etsy:stats:${yesterday}`])).rows[0] as Record<string, unknown>;
    expect(obs).toMatchObject({ from_absence: 1, source_type: 'marketplace' });
    expect(String(obs.saw)).toContain('140 impressions, 9 views');
    expect(redirectedTo(await post(`/foundry/experiments/${X}/order`, { order_ref: '3456789012', paid_at: iso(3), gross_cents: '1400', fee_cents: '178' }))).toContain('done=order');
    const x = (await exposureOf(X))!;
    const events = (await query(`SELECT kind, counterparty, amount_cents FROM business_outcome_events WHERE exposure_id = ? ORDER BY kind`, [x.id])).rows;
    expect(events).toEqual([expect.objectContaining({ kind: 'delivery' }), expect.objectContaining({ kind: 'payment', counterparty: 'unmatched_external', amount_cents: 1400 })]);
    expect((await query(`SELECT status, provider, payment_ref FROM experiment_fulfilments WHERE experiment_id = ?`, [X])).rows[0]).toMatchObject({ status: 'delivered', provider: 'etsy', payment_ref: '3456789012' });
    const ledger = (await query(`SELECT kind, amount_cents, claim_quality FROM economic_events WHERE provider = 'etsy' ORDER BY kind`)).rows;
    expect(ledger).toEqual([expect.objectContaining({ kind: 'charge', amount_cents: 1400, claim_quality: 'measured' }), expect.objectContaining({ kind: 'provider_fee', amount_cents: 178 })]);
    // The same order twice is one order.
    const again = await recordVenueOrder({ founderId: OWNER, experimentId: X, order: { orderRef: '3456789012', paidAt: iso(3), grossCents: 1400, feeCents: 178 } });
    expect(again.duplicate).toBe(true);
    expect((await query(`SELECT COUNT(*) AS n FROM economic_events WHERE provider = 'etsy'`)).rows[0]).toMatchObject({ n: 2 });
    expect(state.sends).toHaveLength(0);
  });

  it('a refund is the venue\'s fact, the ledger\'s row, and a reason to stop at two', async () => {
    await expect(recordVenueRefund({ founderId: OWNER, experimentId: X, orderRef: 'nope', refundedAt: iso(2), amountCents: 1400 })).rejects.toThrow(/no_such_order/);
    const one = await recordVenueRefund({ founderId: OWNER, experimentId: X, orderRef: '3456789012', refundedAt: iso(2), amountCents: 1400 });
    expect(one.stop).toBe(false);
    expect((await query(`SELECT status FROM experiment_fulfilments WHERE payment_ref = '3456789012'`)).rows[0]).toMatchObject({ status: 'refunded' });
    expect((await query(`SELECT COUNT(*) AS n FROM economic_events WHERE provider = 'etsy' AND kind = 'refund'`)).rows[0]).toMatchObject({ n: 1 });
    await recordVenueOrder({ founderId: OWNER, experimentId: X, order: { orderRef: '3456789013', paidAt: iso(1), grossCents: 1400, feeCents: null } });
    expect(redirectedTo(await post(`/foundry/experiments/${X}/refund`, { order_ref: '3456789013', refunded_at: iso(0), amount_cents: '1400' }))).toContain('done=refund');
    const stops = await readStopConditions(X);
    expect(stops.find((s) => s.kind === 'refunds')).toMatchObject({ met: true });
  });

  it('the sealed rule settles it as predicted from the recorded payments; refunded money never earns the asset', async () => {
    // The grade is refused in the same second as the prediction; a real
    // settlement is days later, so the clock is allowed one second here.
    await new Promise((r) => setTimeout(r, 1100));
    const s = await settleListings({ now: new Date(Date.now() + 10 * 60_000) });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ experimentId: X, settled: 'as_predicted', earned: false });
    expect((await query('SELECT verdict FROM venture_experiments WHERE id = ?', [X])).rows[0]).toMatchObject({ verdict: 'as_predicted' });
    expect((await query('SELECT standing FROM products WHERE from_experiment_id = ?', [X])).rows[0]).toMatchObject({ standing: 'experimental' });
    expect((await exposureOf(X))!.withdrawnAt).not.toBeNull();
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.state).toBe('completed');
    expect(await settleListings({ now: NOW })).toEqual([]);
    expect(state.sends).toHaveLength(0);
  });
});
