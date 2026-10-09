// =============================================================================
// FQ AND F2, AUDITED BY A SESSION THAT DID NOT BUILD THEM (F3, 9 October 2026).
//
// Each F2 claim was treated as a hypothesis and attacked with a mutation of
// the auditor's own. What held is recorded in IMPLEMENTATION_STATE.md; what
// did not is pinned here, each found red before its fix:
//
//   * THE EU LINE COULD NEVER APPEAR. The routing rule reads the buyer-facing
//     address of a merchant-of-record listing (`channel_listings.url`), and no
//     production path wrote that column: the door's placement and the owner's
//     own record both left it NULL. Only tests that built `elsewhere` by hand
//     ever saw the line.
//   * THE LISTING SAID "FILL IN ON SCREEN" OF A FILE WITH NO FIELDS: the
//     canonical description promised it whatever the bytes said.
//   * THE SITEMAP ADVERTISED A PAGE THE SITE HAD TAKEN DOWN: a product with a
//     guide but nowhere to buy it (a withdrawn link, or an operating asset with
//     no venue) had its guide replaced by a noindex notice, while the sitemap
//     and the indexed set still listed it. One predicate now decides both.
//   * A LATE REFUND OR CHARGEBACK WAS NEVER READ: the daily read asked each
//     channel for 35 days of sales, so a sale refunded on day 40 (a chargeback
//     can come 120 days later) kept its money in the line for ever.
//   * A MONTH WAS FROZEN THE MORNING IT ENDED: a channel that could not be read
//     that morning left the month short for good. A month is now recorded once
//     its late reports are in.
//   * TWO PER-STREAM LINES DISAGREED: `costToServe` read only the economic
//     ledger, so a product selling only on Gumroad showed no revenue there
//     while the channel line showed its sales. It now reads the channel line.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';
import type { PublicExperiment, PublicWorkshopFacts } from '../../src/services/public-workshop/projection.js';

const CN = await import('../../src/services/venture/storefront/canonical.js');
const CH = await import('../../src/services/venture/storefront/channels.js');
const RC = await import('../../src/services/venture/storefront/reconcile.js');
const ST = await import('../../src/services/venture/storefront/index.js');

let EXP = '';
let MODE: 'real' | 'sandbox' | 'reference' = 'real';

async function aPrintableForSale(fillable: boolean): Promise<void> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < 9; i++) doc.addPage([612, 792]);
  if (fillable) doc.getForm().createTextField('p1_text_1').addToPage(doc.getPage(0), { x: 72, y: 600, width: 200, height: 18 });
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const { recordMaterial, HAND } = await import('../../src/services/venture/hand.js');
  await query(`UPDATE experiment_materials SET superseded_at = datetime('now') WHERE experiment_id = ? AND kind IN ('offer_shape','deliverable') AND superseded_at IS NULL`, [EXP]);
  const printable = { version: 1, sha256, pages: 9, filename: 'the-home-maintenance-log-v1.pdf', topics: [], panel: { outcome: 'ship', because: 'a clear yes', answers: [] }, held: null };
  await recordMaterial({ founderId: OWNER, experimentId: EXP, kind: 'offer_shape', title: 'offer shape', by: HAND, body: JSON.stringify({
    kind: 'printable_pdf', shape: { sells: 'a log of what your house needs and when' },
    price: { amountCents: 900, productName: 'Home Maintenance Log (version 1)' }, spec: { subtitle: 'Every job, every year', pages: 6 }, printable }) });
  await recordMaterial({ founderId: OWNER, experimentId: EXP, kind: 'deliverable', title: 'The Home Maintenance Log', by: HAND, body: JSON.stringify({
    kind: 'printable_pdf', version: 1, title: 'The Home Maintenance Log', filename: printable.filename, pages: 9, bytes: pdf.length, sha256,
    madeAt: '2026-10-09T08:00:00.000Z', topics: [], pdfBase64: pdf.toString('base64') }) });
}

beforeAll(async () => {
  EXP = (await seedProductionShape()).experimentId;
  MODE = String(((await query('SELECT evidence_mode FROM venture_experiments WHERE id = ?', [EXP])).rows[0] as Record<string, unknown>).evidence_mode) as typeof MODE;
}, 180_000);

describe('the EU line is reachable from what production writes', () => {
  it('a listing he records carries the address a buyer reaches it at, on the channel\'s own host only', async () => {
    await aPrintableForSale(true);
    expect(await RC.recordOwnerListing({ founderId: OWNER, experimentId: EXP, channel: 'lemonsqueezy', externalRef: '7001', version: 1, priceCents: 900,
      url: 'https://evil.example/buy', by: `founder:${OWNER}` })).toMatchObject({ refused: expect.stringMatching(/Lemon Squeezy/) });
    expect(await RC.recordOwnerListing({ founderId: OWNER, experimentId: EXP, channel: 'lemonsqueezy', externalRef: '7001', version: 1, priceCents: 900,
      url: 'http://apex.lemonsqueezy.com/buy/abc', by: `founder:${OWNER}` })).toHaveProperty('refused');
    expect(await RC.recordOwnerListing({ founderId: OWNER, experimentId: EXP, channel: 'lemonsqueezy', externalRef: '7001', version: 1, priceCents: 900,
      url: 'https://apex.lemonsqueezy.com/buy/abc', by: `founder:${OWNER}` })).toHaveProperty('id');
    const row = (await query(`SELECT url FROM channel_listings WHERE experiment_id = ? AND channel = 'lemonsqueezy'`, [EXP])).rows[0] as Record<string, unknown>;
    expect(row.url).toBe('https://apex.lemonsqueezy.com/buy/abc');
  });

  it('the door\'s Gumroad listing keeps the short address Gumroad answers with', async () => {
    const G = await import('../../src/services/venture/storefront/gumroad.js');
    CN.useChannelHttp(async () => new Response(JSON.stringify({ success: true, product: { id: 'fixture_product_9', short_url: 'https://apex.gumroad.com/l/home-log' } }), { status: 200 }));
    try {
      expect(await G.createDraft('fixture-token', { title: 'T', description: 'D', priceCents: 900, file: { filename: 'f.pdf' } as never }, 'https://files.gumroad.example/f.pdf'))
        .toEqual({ id: 'fixture_product_9', url: 'https://apex.gumroad.com/l/home-log' });
    } finally { CN.useChannelHttp(null); }
  });

  it('the projection reads the recorded address into the product\'s other places, once he has the channel open', async () => {
    const { buyerFacingListings } = await import('../../src/services/venture/storefront/reconcile.js');
    expect(await buyerFacingListings(EXP, 1)).toEqual([]);
    expect(await CH.grantChannel(OWNER, 'lemonsqueezy', { storeId: '1' }, 'open for the audit', `founder:${OWNER}`)).toHaveProperty('id');
    expect(await buyerFacingListings(EXP, 1)).toEqual([{ channel: 'lemonsqueezy', venueName: 'Lemon Squeezy', url: 'https://apex.lemonsqueezy.com/buy/abc', merchantOfRecord: true }]);
  });
});

describe('the listing says what the file is, and nothing it is not', () => {
  it('a file with no fields is not offered as one to fill in on screen', async () => {
    await aPrintableForSale(false);
    const l = await CN.canonicalListing(OWNER, EXP);
    if ('refused' in l) throw new Error(l.refused);
    expect(l.file.fillable).toBe(false);
    expect(l.description).not.toMatch(/fill in on screen|fillable/i);
    await aPrintableForSale(true);
    const f = await CN.canonicalListing(OWNER, EXP);
    if ('refused' in f) throw new Error(f.refused);
    expect(f.description).toMatch(/fillable/);
    expect(f.description).toMatch(/fill in on screen/);
  });
});

describe('a page taken down is not advertised', () => {
  const facts = { name: 'Apex Micro', legalOperator: 'A. Operator', origin: 'https://apexmicro.ai', tagline: 'a small digital workshop', statement: 'Small useful files.', about: 'A small workshop.', contactEmail: 'hello@apexmicro.ai', region: 'Tennessee', postalAddress: null, replyRouteProven: false } as unknown as PublicWorkshopFacts;
  const guide = { version: 1, outline: [{ heading: 'Every job, by season', lede: 'What a house asks for.' }],
    freePage: { heading: 'Every job, by season', lede: 'What a house asks for.', html: '<ul class="check"><li>Clean the gutters</li></ul>' } };
  const x = {
    number: 7, slug: 'home-log', path: '/experiments/home-log', listed: true,
    title: 'The Home Maintenance Log', summary: 'A log of what your house needs and when.', who: 'Homeowners', what: 'A 9-page PDF',
    limits: 'Not a survey of your house.', sources: 'Common maintenance schedules.', selection: '', note: '', sample: null, tool: null,
    status: 'testing', statusLabel: 'Open', statusLine: 'Open now', outcome: null, whereToGetIt: null, shape: 'product_page',
    clarification: null, price: { amountCents: 900, currency: 'usd', label: '$9, one time' }, freeToRead: null, recurring: false,
    payUrl: null, openedOn: '2026-10-09', closedOn: null, updatedOn: '2026-10-09',
    supersedes: null, successor: null, graduatedTo: null, guide, elsewhere: [],
  } as unknown as PublicExperiment;
  for (const [what, state] of [['a testing product whose link came down', { status: 'testing', payUrl: null }], ['an operating asset with no venue', { status: 'operating', payUrl: null }]] as const) {
    it(`${what}: no guide or free page in the sitemap, the indexed set or the site`, async () => {
      const S = await import('../../src/services/public-workshop/site.js');
      const reg = [{ ...x, ...state }] as PublicExperiment[];
      const site = S.renderSite(facts, reg);
      expect(site.has('/experiments/home-log/guide')).toBe(false);
      expect(S.renderSitemap(facts, reg)).not.toContain('/guide');
      expect(S.renderSitemap(facts, reg)).not.toContain('/free');
      expect([...S.indexedPaths(reg)].filter((p) => p.endsWith('/guide') || p.endsWith('/free'))).toEqual([]);
    });
  }
  it('every found page the indexed set names is a page the site publishes, in every state', async () => {
    const S = await import('../../src/services/public-workshop/site.js');
    for (const status of ['testing', 'operating', 'closed', 'graduated']) for (const payUrl of [null, 'https://buy.stripe.com/x']) for (const where of [null, 'https://www.etsy.com/listing/1']) {
      const reg = [{ ...x, status, payUrl, whereToGetIt: where }] as unknown as PublicExperiment[];
      const site = S.renderSite(facts, reg);
      for (const p of S.indexedPaths(reg)) if (/\/(guide|free)$/.test(p)) expect(site.has(p), `${status} ${String(payUrl)} ${String(where)}: ${p}`).toBe(true);
    }
  });
});

describe('a refund that comes late is still read', () => {
  it('a Gumroad sale refunded weeks later (a chargeback) is read by the daily pass and leaves the line', async () => {
    await CH.grantChannel(OWNER, 'gumroad', {}, 'open for the audit', `founder:${OWNER}`);
    const { encrypt } = await import('../../src/services/encryption.js');
    await query(`INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by) VALUES (?,?,?,?,?)`,
      ['gumroad', encrypt(JSON.stringify({ token: 'fixture' })), 'fixture-gumroad', new Date().toISOString(), `founder:${OWNER}`]);
    await RC.recordOwnerListing({ founderId: OWNER, experimentId: EXP, channel: 'gumroad', externalRef: 'fixture_late', version: 1, priceCents: 900, by: `founder:${OWNER}` });
    const now = new Date();
    const sold = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    // A fixture of Gumroad's sales index that honours `after`, as its controller does.
    CN.useChannelHttp(async (url) => {
      const after = new URL(url).searchParams.get('after') ?? '1970-01-01';
      const sales = [{ id: 'fixture_late_sale', created_at: sold, price: 900, gumroad_fee: 140, currency: 'usd', product_id: 'fixture_late',
        refunded: false, partially_refunded: false, chargedback: true, amount_refundable_in_currency: 0 }].filter((s) => s.created_at.slice(0, 10) >= after);
      return new Response(JSON.stringify({ success: true, sales }), { status: 200 });
    });
    try {
      const reads = await ST.readOpenChannels(now);
      expect(reads.find((r) => r.channel === 'gumroad')?.result).toMatchObject({ read: true });
      const rows = (await query(`SELECT kind, occurred_at FROM channel_sales WHERE provider_ref = 'fixture_late_sale' ORDER BY kind`, [])).rows as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.kind)).toEqual(['refund', 'sale']);
      // Gumroad's sale record carries no refund date: the refund is dated when Foundry first learned of it, not back-dated to the sale.
      expect(Date.parse(String(rows[0]!.occurred_at))).toBeGreaterThan(now.getTime() - 86_400_000);
    } finally { CN.useChannelHttp(null); }
  });
});

describe('a month is recorded once its late reports are in', () => {
  it('the morning after a month ends is too soon; three days on it is recorded', async () => {
    const SZ = await import('../../src/services/venture/storefront/seasonality.js');
    expect(SZ.monthToRecord(new Date('2026-10-01T06:00:00Z'))).toBe('2026-08');
    expect(SZ.monthToRecord(new Date('2026-10-03T06:00:00Z'))).toBe('2026-08');
    expect(SZ.monthToRecord(new Date('2026-10-04T06:00:00Z'))).toBe('2026-09');
    expect(SZ.monthToRecord(new Date('2027-01-05T06:00:00Z'))).toBe('2026-12');
  });
});

describe('one per-stream line, read by both the channel view and cost to serve', () => {
  it('a product that sold only on Gumroad has that revenue in its cost to serve', async () => {
    // A real sale on Gumroad, as the channel stated it (the reading above used `real`).
    const { costToServe } = await import('../../src/services/economy/projection.js');
    await query(`INSERT INTO channel_sales (id, founder_id, experiment_id, version, channel, kind, provider_ref, gross_cents, fee_cents, tax_cents, currency, occurred_at, evidence_mode)
      VALUES ('cs_audit_1', ?, ?, 1, 'gumroad', 'sale', 'fixture_real_sale', 1500, 200, 0, 'usd', datetime('now','-2 days'), 'real')`, [OWNER, EXP]);
    const line = (await RC.channelPnl(OWNER, 30, 'real')).find((s) => s.experimentId === EXP)!;
    const cts = (await costToServe(OWNER, 30)).streams.find((s) => s.experimentId === EXP)!;
    expect(cts, 'the stream is in cost to serve').toBeTruthy();
    const gross = line.channels.reduce((s, c) => s + c.grossCents - c.refundedCents, 0);
    // The late refund above (900, learned today) sits in the window beside this 1500 sale.
    expect(line.channels.find((c) => c.channel === 'gumroad')).toMatchObject({ sales: 1, grossCents: 1500, refundedCents: 900 });
    expect(gross).toBe(600);
    expect(cts.revenue.cents).toBe(gross);
  });
});
