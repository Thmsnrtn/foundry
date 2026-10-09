// =============================================================================
// EVERY CHANNEL IS ONE STOREFRONT (F2, 9 October 2026; PENDING 42, 43).
//
// One canonical product and version, behind one interface, on every channel:
//   * NO CHANNEL OPENS WITHOUT HIM: each refuses, in a sentence he can act on,
//     until his own signed grant AND a key exist; a grant signed by anyone else
//     is refused by the database;
//   * ETSY LISTS NOTHING: its connection is a sense, and listing needs a write
//     scope only he can grant; its sales are already read into the ledger;
//   * LEMON SQUEEZY CANNOT LIST BY API (its docs show no create endpoint), so it
//     refuses to list and reads orders of the product he made and recorded;
//   * GUMROAD LISTS THROUGH THE OUTBOUND DOOR in three graded acts — upload,
//     draft (prepare), enable (public, drawing on his allowance) — so with no
//     allowance the public step is refused by the door, not by this code;
//   * the listing every channel carries holds the version and the AI
//     disclosure; the request bodies match the provider's own definitions;
//   * sales and refunds reconcile into one line per stream and channel, once,
//     with fees "not known" where the channel did not say, tax never revenue,
//     a test-mode order never revenue, and someone else's product not ours.
// The provider answers are FIXTURES (tests/fixtures/channels.ts), labelled so.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';
import { GUMROAD_FIXTURE, LEMONSQUEEZY_FIXTURE } from '../fixtures/channels.js';

const ST = await import('../../src/services/venture/storefront/index.js');
const CH = await import('../../src/services/venture/storefront/channels.js');
const RC = await import('../../src/services/venture/storefront/reconcile.js');
const CN = await import('../../src/services/venture/storefront/canonical.js');
const PF = await import('../../src/services/venture/storefront/price-floor.js');

let EXP = '';
let ASSET = '';
const sent: Array<{ url: string; method: string; body: string }> = [];

async function aPrintableForSale(): Promise<void> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < 9; i++) doc.addPage([612, 792]);
  doc.getForm().createTextField('p1_text_1').addToPage(doc.getPage(0), { x: 72, y: 600, width: 200, height: 18 });
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const { recordMaterial, HAND } = await import('../../src/services/venture/hand.js');
  const printable = { version: 1, sha256, pages: 9, filename: 'the-home-maintenance-log-v1.pdf', topics: [], panel: { outcome: 'ship', because: 'a clear yes', answers: [] }, held: null };
  await recordMaterial({ founderId: OWNER, experimentId: EXP, kind: 'offer_shape', title: 'offer shape', by: HAND, body: JSON.stringify({
    kind: 'printable_pdf', shape: { sells: 'a log of what your house needs and when, to keep by the boiler' },
    price: { amountCents: 900, productName: 'Home Maintenance Log (version 1)' }, spec: { subtitle: 'Every job, every year, on one shelf', pages: 6 }, printable }) });
  await recordMaterial({ founderId: OWNER, experimentId: EXP, kind: 'deliverable', title: 'The Home Maintenance Log', by: HAND, body: JSON.stringify({
    kind: 'printable_pdf', version: 1, title: 'The Home Maintenance Log', filename: printable.filename, pages: 9, bytes: pdf.length, sha256,
    madeAt: '2026-10-09T08:00:00.000Z', topics: [], pdfBase64: pdf.toString('base64') }) });
  // The asset the seeded experiment already has: the door acts for it.
  ASSET = String(((await query(`SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL`, [EXP])).rows[0] as Record<string, unknown>).id);
}

async function placeKey(channel: 'gumroad' | 'lemonsqueezy', secret: Record<string, string>): Promise<void> {
  const { encrypt } = await import('../../src/services/encryption.js');
  await query(`INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by) VALUES (?,?,?,?,?)`,
    [channel, encrypt(JSON.stringify(secret)), `fixture-${channel}-account`, new Date().toISOString(), `founder:${OWNER}`]);
}

beforeAll(async () => {
  EXP = (await seedProductionShape()).experimentId;
  await aPrintableForSale();
  CN.useChannelHttp(async (url, init) => {
    const method = String(init?.method ?? 'GET');
    sent.push({ url, method, body: typeof init?.body === 'string' ? init.body : init?.body ? `<${String((init.body as Uint8Array).length)} bytes>` : '' });
    const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://s3.fixture.example/')) return new Response('', { status: 200, headers: { etag: '"fixture-etag-1"' } });
    if (url.endsWith('/v2/files/presign')) return json(GUMROAD_FIXTURE.presign);
    if (url.endsWith('/v2/files/complete')) return json(GUMROAD_FIXTURE.complete);
    if (url.endsWith('/v2/products') && method === 'POST') return json(GUMROAD_FIXTURE.created);
    if (/\/v2\/products\/[^/]+\/enable$/.test(url)) return json(GUMROAD_FIXTURE.enabled);
    if (url.includes('/v2/sales')) return json(GUMROAD_FIXTURE.sales);
    if (url.startsWith('https://api.lemonsqueezy.com/v1/orders')) return json(LEMONSQUEEZY_FIXTURE.orders);
    return json({ success: false, message: `no fixture for ${method} ${url}` }, 404);
  });
}, 180_000);

describe('no channel opens without him', () => {
  it('each channel refuses to list, and to read, while he has not granted it', async () => {
    for (const ch of CH.MARKET_CHANNELS) {
      const placed = await ST.placeOnChannel(OWNER, EXP, ch);
      expect(placed, ch).toMatchObject({ placed: false, because: expect.stringMatching(/PENDING 43/) });
      expect(await ST.readChannel(OWNER, ch, new Date('2026-10-01')), ch).toMatchObject({ read: false });
    }
    expect(sent).toEqual([]);
  });

  it('a grant signed by anyone but him is refused by the database', async () => {
    expect(await CH.grantChannel(OWNER, 'gumroad', {}, 'the forge wanted reach', 'forge')).toHaveProperty('refused');
    expect(await CH.channelGrant(OWNER, 'gumroad')).toMatchObject({ granted: false });
  });

  it('his grant with no key is still closed, and says to paste the key', async () => {
    await CH.grantChannel(OWNER, 'gumroad', {}, 'sell on Gumroad', `founder:${OWNER}`);
    expect(await ST.placeOnChannel(OWNER, EXP, 'gumroad')).toMatchObject({ placed: false, because: expect.stringMatching(/no API key/) });
  });

  it('Etsy lists nothing even when he opens it: its connection is a sense', async () => {
    await CH.grantChannel(OWNER, 'etsy', { whoMade: 'i_did', taxonomyId: 1 }, 'sell on Etsy', `founder:${OWNER}`);
    expect(await ST.placeOnChannel(OWNER, EXP, 'etsy')).toMatchObject({ placed: false, because: expect.stringMatching(/listings_w.*PENDING 25/) });
    expect(sent).toEqual([]);
  });

  it('Lemon Squeezy cannot list by API, and says where the product is made', async () => {
    await placeKey('lemonsqueezy', { apiKey: 'fixture-ls-key' });
    await CH.grantChannel(OWNER, 'lemonsqueezy', { storeId: '1' }, 'sell on Lemon Squeezy', `founder:${OWNER}`);
    expect(await ST.placeOnChannel(OWNER, EXP, 'lemonsqueezy')).toMatchObject({ placed: false, because: expect.stringMatching(/cannot create a product.*dashboard/) });
  });
});

describe('Gumroad, through the door', () => {
  it('with a key but no floor of his: refused by the floor (PENDING 44), nothing sent', async () => {
    await placeKey('gumroad', { token: 'fixture-gumroad-token' });
    expect(await ST.placeOnChannel(OWNER, EXP, 'gumroad')).toMatchObject({ placed: false, because: expect.stringMatching(/PENDING 44/) });
    expect(sent).toEqual([]);
  });

  it('with his floor: THE DOOR refuses, because the approved test carries no act for listing it (PENDING 47), and nothing is sent', async () => {
    await PF.setPriceFloor(OWNER, { minCents: 500 }, 'nothing under $5', `founder:${OWNER}`);
    const { setAllowance } = await import('../../src/services/institution/standing-intent.js');
    await setAllowance({ productId: ASSET, statement: 'up to $10 to put it on sale', amountCents: 1000, purpose: 'listing' });
    const r = await ST.placeOnChannel(OWNER, EXP, 'gumroad');
    expect(r).toMatchObject({ placed: false, because: expect.stringMatching(/experimental asset.*act its approved experiment carries/) });
    expect(sent).toEqual([]);
    expect((await query(`SELECT COUNT(*) AS n FROM channel_listings`)).rows[0]).toMatchObject({ n: 0 });
  });

  it('every Gumroad act is bound at the door to the capability that grades it, and Etsy\'s stay unbound', async () => {
    const rows = (await query(`SELECT p.tool, c.rung, c.draws_on_allowance, p.maturity FROM capability_providers p JOIN capabilities c ON c.capability_key = p.capability_key WHERE p.provider = 'gumroad' ORDER BY p.tool`)).rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.tool, r.rung, Number(r.draws_on_allowance), r.maturity])).toEqual([
      ['gumroad_create_draft_product', 'prepare', 0, 'declared'],
      ['gumroad_enable_product', 'public', 1, 'declared'],
      ['gumroad_upload_product_file', 'prepare', 0, 'declared'],
    ]);
    const { toolIsRegistered } = await import('../../src/services/outbound/gateway.js');
    for (const t of ['gumroad_upload_product_file', 'gumroad_create_draft_product', 'gumroad_enable_product']) expect(toolIsRegistered(t), t).toBe(true);
  });

  it('the adapter\'s requests are shaped as Gumroad defines them, carrying the version and the disclosure (contract, against fixtures)', async () => {
    const G = await import('../../src/services/venture/storefront/gumroad.js');
    const l = await CN.canonicalListing(OWNER, EXP);
    if ('refused' in l) throw new Error(l.refused);
    sent.length = 0;
    const fileUrl = await G.uploadFile('fixture-gumroad-token', { filename: l.file.filename, pdf: l.file.pdf });
    const ref = await G.createDraft('fixture-gumroad-token', l, fileUrl);
    await G.enable('fixture-gumroad-token', ref);
    expect(ref).toBe('fixture_product_1');
    const presign = JSON.parse(sent.find((s) => s.url.endsWith('/files/presign'))!.body) as Record<string, unknown>;
    expect(presign).toMatchObject({ filename: 'the-home-maintenance-log-v1.pdf', file_size: l.file.pdf.length });
    expect(sent.some((s) => s.url.startsWith('https://s3.fixture.example/') && s.method === 'PUT')).toBe(true);
    expect(JSON.parse(sent.find((s) => s.url.endsWith('/files/complete'))!.body)).toMatchObject({ upload_id: 'fixture-upload-1', parts: [{ part_number: 1, etag: '"fixture-etag-1"' }] });
    const create = JSON.parse(sent.find((s) => s.url.endsWith('/v2/products'))!.body) as Record<string, unknown>;
    expect(create).toMatchObject({ name: 'The Home Maintenance Log', price: 900, draft: true, files: [{ url: GUMROAD_FIXTURE.complete.file_url }] });
    expect(String(create.description)).toMatch(/version 1/);
    expect(String(create.description)).toMatch(/Made with AI: .* \(version 1, 2026-10-09\)/);
    expect(String(create.description)).toMatch(/fillable/);
    expect(sent.find((s) => s.url.endsWith('/products/fixture_product_1/enable'))!.method).toBe('PUT');
    // The token travels only in the Authorization header, never in a body or a URL.
    for (const s of sent) expect(`${s.url} ${s.body}`).not.toContain('fixture-gumroad-token');
  });

  it('Etsy\'s draft is shaped from its OpenAPI, and refuses without his "who made it" and category', async () => {
    const E = await import('../../src/services/venture/storefront/etsy.js');
    const l = await CN.canonicalListing(OWNER, EXP);
    if ('refused' in l) throw new Error(l.refused);
    expect(E.draftListingForm(l, {})).toHaveProperty('refused');
    const form = E.draftListingForm(l, { whoMade: 'i_did', taxonomyId: 2078 }) as URLSearchParams;
    for (const k of ['quantity', 'title', 'description', 'price', 'who_made', 'when_made', 'taxonomy_id']) expect(form.get(k), k).toBeTruthy();
    expect(form.get('type')).toBe('download');
    expect(form.get('price')).toBe('9.00');
  });
});

describe('sales and refunds reconcile, once, into one line per stream and channel', () => {
  it('Gumroad: two sales, a refund, a partial refund; another product is not ours; read twice is recorded once', async () => {
    // He made it on Gumroad himself (the door's listing waits on PENDING 47) and recorded it.
    expect(await RC.recordOwnerListing({ founderId: OWNER, experimentId: EXP, channel: 'gumroad', externalRef: 'fixture_product_1', version: 1, priceCents: 900, by: `founder:${OWNER}` })).toHaveProperty('id');
    const first = await ST.readChannel(OWNER, 'gumroad', new Date('2026-10-01'), 'sandbox');
    expect(first).toMatchObject({ read: true, recorded: 5, notOurs: 1 });
    expect(await ST.readChannel(OWNER, 'gumroad', new Date('2026-10-01'), 'sandbox')).toMatchObject({ read: true, recorded: 0, repeated: 5 });
  });

  it('Lemon Squeezy: only the product he made and recorded; tax and test mode are never revenue', async () => {
    expect(await RC.recordOwnerListing({ founderId: OWNER, experimentId: EXP, channel: 'lemonsqueezy', externalRef: '7001', version: 1, priceCents: 900, by: 'forge' })).toHaveProperty('refused');
    expect(await RC.recordOwnerListing({ founderId: OWNER, experimentId: EXP, channel: 'lemonsqueezy', externalRef: '7001', version: 1, priceCents: 900, by: `founder:${OWNER}` })).toHaveProperty('id');
    expect(await ST.readChannel(OWNER, 'lemonsqueezy', new Date('2026-10-01'), 'sandbox')).toMatchObject({ read: true, recorded: 3 });
  });

  it('the stream\'s line per channel adds up to what the channels said, and says "not known" where a fee was not stated', async () => {
    const [stream] = (await RC.channelPnl(OWNER, 3650, 'sandbox')).filter((s) => s.experimentId === EXP);
    const by = new Map(stream!.channels.map((c) => [c.channel, c]));
    expect(by.get('gumroad')).toMatchObject({ sales: 3, grossCents: 2700, refunds: 2, refundedCents: 900 + 300, feesCents: 420, netCents: 2700 - 1200 - 420 });
    // Lemon Squeezy's order states no fee: not known, with the schedule's estimate beside it; the $1.89 VAT is not revenue.
    expect(by.get('lemonsqueezy')).toMatchObject({ sales: 2, grossCents: 1800, refunds: 1, refundedCents: 900, feesCents: null, netCents: null });
    expect(by.get('lemonsqueezy')!.because).toMatch(/not known.*estimate/);
    expect(by.get('lemonsqueezy')!.estimatedFeesCents).toEqual({ low: 190, high: 244 });
    expect(stream!.totalNetCents).toBeNull();
    // Real money is untouched by any of it.
    expect((await RC.channelPnl(OWNER, 3650, 'real')).filter((s) => s.experimentId === EXP).flatMap((s) => s.channels.filter((c) => c.channel !== 'workshop' && c.channel !== 'etsy'))).toEqual([]);
  });

  it('one channel carrying most of the money is an alert, by the per-channel limit', async () => {
    const c = await RC.channelConcentration(OWNER, 3650, 'sandbox');
    expect(c.shares.gumroad! + c.shares.lemonsqueezy!).toBeCloseTo(1, 5);
    expect(c.over).toBe('gumroad');
    expect(c.sentence).toMatch(/one suspended account/);
  });
});

describe('his acts, through the pages he already reads (no new door)', () => {
  it('Controls asks for the floor and the channels as his decisions; Money sets the floor and shows every channel\'s line', async () => {
    const { ownerApp, owner, asText } = await import('../helpers/world.js');
    const app = await ownerApp();
    const me = owner(app);
    const { yourDecisions } = await import('../../src/services/control/decisions.js');
    const d = Object.fromEntries((await yourDecisions(OWNER, process.env)).map((x) => [x.key, x]));
    expect(d.price_floor!.state).toBe('done');
    expect(d.channels!).toMatchObject({ state: 'done', seen: expect.stringMatching(/Gumroad/) });
    const controls = asText(await me.page('/foundry/controls'));
    expect(controls).toContain('Open the channels Foundry may sell on');
    // Closing a channel from Controls is his act, and it is read back.
    expect((await me.post('/foundry/controls/channels', { channel: 'lemonsqueezy', open: 'no' })).status).toBe(302);
    expect(await CH.channelGrant(OWNER, 'lemonsqueezy')).toMatchObject({ granted: false });
    // The floor from Money, in his words.
    expect((await me.post('/foundry/money/price-floor', { min_dollars: '6', max_fee_percent: '25', why: 'fees under a quarter' })).status).toBe(302);
    expect((await PF.priceFloorOf(OWNER))!.floor).toEqual({ minCents: 600, maxFeeShare: 0.25 });
    const money = asText(await me.page('/foundry/money'));
    expect(money).toContain('Every channel: what each sold, kept and returned');
    expect(money).toMatch(/The Home Maintenance Log ?, version 1: After fees, of \$9\.00: Workshop page: \$8\.43 · Etsy: \$7\.69 · Gumroad: \$7\.03–\$7\.60/);
  });

  it('the hand\'s daily tick reads every channel he opened, and none he closed', async () => {
    const reads = await ST.readOpenChannels(new Date('2026-10-09T12:00:00Z'));
    expect(reads.map((r) => r.channel)).toEqual(['gumroad']);
  });
});

describe('wired, not only built', () => {
  it('the hand\'s daily tick calls readOpenChannels (parsed, so a comment naming it does not count)', async () => {
    const ts = (await import('typescript')).default;
    const { readFileSync } = await import('node:fs');
    const sf = ts.createSourceFile('jobs.ts', readFileSync('src/jobs/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    let calls = 0;
    const v = (n: import('typescript').Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'readOpenChannels') calls += 1;
      ts.forEachChild(n, v);
    };
    v(sf);
    expect(calls).toBe(1);
  });
});

describe('reading across pages, as each API pages', () => {
  it('Lemon Squeezy: every page up to meta.page.lastPage, newest first, stopping at the window (fixture pages)', async () => {
    const LS = await import('../../src/services/venture/storefront/lemonsqueezy.js');
    const all = Array.from({ length: 7 }, (_, i) => ({ type: 'orders', id: String(i + 1), attributes: {
      identifier: `fixture-paged-${String(i + 1)}`, currency: 'USD', subtotal: 900, tax: 0, total: 900, status: 'paid', refunded: false, refunded_amount: 0,
      test_mode: false, created_at: new Date(Date.UTC(2026, 9, 9 - i)).toISOString(), first_order_item: { product_id: 7001 } } }));
    const asked: number[] = [];
    CN.useChannelHttp(async (url) => {
      const page = Number(new URL(url).searchParams.get('page[number]'));
      asked.push(page);
      return new Response(JSON.stringify({ data: all.slice((page - 1) * 3, page * 3), meta: { page: { currentPage: page, lastPage: 3 } } }), { status: 200 });
    });
    expect((await LS.readOrders('k', '1', new Date('2026-09-01'))).map((o) => o.providerRef)).toEqual(all.map((o) => o.attributes.identifier));
    expect(asked).toEqual([1, 2, 3]);
    // The window's edge: orders before it end the read without asking for more pages.
    asked.length = 0;
    expect((await LS.readOrders('k', '1', new Date(Date.UTC(2026, 9, 6)))).length).toBe(4);
    expect(asked).toEqual([1, 2]);
  });
});
