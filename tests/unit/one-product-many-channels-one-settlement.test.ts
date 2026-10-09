// =============================================================================
// ONE PRODUCT, MANY CHANNELS, ONE SETTLEMENT (F3; residue of F2).
//
// An experiment has ONE live exposure (migration 278, an implementation rule,
// not a constitutional one), and its purpose is honest attribution: the sealed
// prediction settles on what happened where it was sealed. That is kept. A
// product whose exposure is the Workshop page can also be on Gumroad, Lemon
// Squeezy and Etsy, and those sales now reach:
//   * the per-stream line and cost to serve (channel_sales, read by both);
//   * the lessons the forge reads, as "sold elsewhere, not settled on";
// and never the settlement, which still counts only the exposure's events.
// Etsy, which was the missing reader: a listing he recorded for a product
// whose exposure is elsewhere is read through the Etsy sense's own reader,
// filtered to that listing, into channel_sales; a listing that IS the test's
// own exposure is never recorded there too (it reaches the ledger already).
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const reads: Array<string | null | undefined> = [];
vi.mock('../../src/services/senses/readers/etsy-shop.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // A FIXTURE of the Etsy sense's own reader: two paid receipts for the listing asked about.
  readTheShop: async (input: { onlyListingId?: string | null }) => {
    reads.push(input.onlyListingId);
    return { shop: { shopId: '1', shopName: 'fixture', url: null, onVacation: false }, listings: [], saidListings: 0, saidOrders: 2, discarded: 0,
      listingsComplete: true, listingFiles: null, listingState: null, complete: true,
      orders: [
        { orderRef: `r1_${String(input.onlyListingId)}`, paidAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), grossCents: 900, feeCents: 112, currency: 'USD', whollyThisListing: true },
        { orderRef: `r2_${String(input.onlyListingId)}`, paidAt: new Date(Date.now() - 86_400_000).toISOString(), grossCents: 900, feeCents: 112, currency: 'USD', whollyThisListing: true },
      ] };
  },
}));

const { query } = await import('../../src/db/client.js');
const { OWNER, seedProductionShape } = await import('../helpers/world.js');
const RC = await import('../../src/services/venture/storefront/reconcile.js');
let EXP = '';
let PRODUCT = '';

beforeAll(async () => {
  EXP = (await seedProductionShape()).experimentId;
  PRODUCT = String(((await query('SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL', [EXP])).rows[0] as Record<string, unknown>).id);
  // Its one exposure is an Etsy listing (111); he also listed the same product as 222 on Etsy and on Gumroad.
  await query(`INSERT INTO experiment_exposures (id, founder_id, experiment_id, product_id, provider, exposure_ref, evidence_mode, placed_by)
    VALUES ('expo_e', ?, ?, ?, 'etsy', 'https://www.etsy.com/listing/111', 'real', 'the owner')`, [OWNER, EXP, PRODUCT]);
  for (const [id, ch, ref] of [['cl1', 'etsy', '111'], ['cl2', 'etsy', '222'], ['cl3', 'gumroad', 'g_1']]) {
    await query(`INSERT INTO channel_listings (id, founder_id, experiment_id, version, channel, external_ref, price_cents, ai_disclosure, evidence_mode)
      VALUES (?,?,?,1,?,?,900,'in the description','real')`, [id, OWNER, EXP, ch, ref]);
  }
}, 180_000);

describe('Etsy as one channel of a multi-channel product', () => {
  it('no shop connected: nothing is read, and it says so', async () => {
    const { readEtsyChannelListings } = await import('../../src/services/venture/storefront/etsy.js');
    expect(await readEtsyChannelListings(OWNER)).toMatchObject({ read: 0, recorded: 0, skipped: [expect.stringMatching(/no Etsy shop is connected/)] });
  });

  it('the other Etsy listing is read into channel_sales once; the exposure\'s own listing is never read there', async () => {
    await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, connected_at) VALUES ('cs_etsy', ?, 'revenue', 'etsy', 'real', 'what the shop sells', datetime('now'))`, [PRODUCT]);
    const { readEtsyChannelListings } = await import('../../src/services/venture/storefront/etsy.js');
    const r = await readEtsyChannelListings(OWNER);
    expect(r).toMatchObject({ read: 1, recorded: 2 });
    expect(reads).toEqual(['222']);
    expect(r.skipped.join(' ')).toMatch(/111: it is the test's own exposure/);
    expect((await readEtsyChannelListings(OWNER)).recorded).toBe(0);
  });

  it('a sale stated for the exposure\'s own listing is refused by the reconciliation too (never counted twice)', async () => {
    const r = await RC.recordChannelSales(OWNER, [{ channel: 'etsy', kind: 'sale', providerRef: 'r9', productRef: '111', grossCents: 900, feeCents: 100, taxCents: 0, currency: 'usd', occurredAt: new Date().toISOString() }], 'real');
    expect(r).toMatchObject({ recorded: 0, repeated: 1 });
  });
});

describe('the sales elsewhere are evidence beside the settlement, never in it', () => {
  it('the line, cost to serve and the forge\'s lessons see them; the settlement\'s purchase count does not', async () => {
    await RC.recordChannelSales(OWNER, [{ channel: 'gumroad', kind: 'sale', providerRef: 'g_s1', productRef: 'g_1', grossCents: 900, feeCents: 140, taxCents: 0, currency: 'usd', occurredAt: new Date().toISOString() }], 'real');
    const line = (await RC.channelPnl(OWNER, 30, 'real')).find((s) => s.experimentId === EXP)!;
    expect(line.channels.map((c) => [c.channel, c.sales])).toEqual([['etsy', 2], ['gumroad', 1]]);
    const { costToServe } = await import('../../src/services/economy/projection.js');
    expect((await costToServe(OWNER, 30)).streams.find((s) => s.experimentId === EXP)!.revenue.cents).toBe(2700);
    const { lessonsFor } = await import('../../src/services/venture/forge.js');
    const lesson = (await lessonsFor(OWNER)).find((l) => l.experimentId === EXP)!;
    expect(lesson.soldElsewhere).toEqual([
      { channel: 'etsy', sales: 2, refunds: 0, grossCents: 1800, refundedCents: 0 },
      { channel: 'gumroad', sales: 1, refunds: 0, grossCents: 900, refundedCents: 0 },
    ]);
    const { PURCHASES_SQL } = await import('../../src/services/founder/what-happened.js');
    const p = (await query(`SELECT ${PURCHASES_SQL} AS n FROM venture_experiments e WHERE e.id = ?`, [EXP])).rows[0] as Record<string, unknown>;
    expect(Number(p.n), 'the settlement counts only its exposure\'s events').toBe(0);
  });
});
