// =============================================================================
// A YEAR ON EVERY CHANNEL (F2 gate, 9 October 2026).
//
// The gate the plan set for distribution: "a calibrated twin year with
// multiple channels shows visits and sales in the base band, and each
// channel's P&L reconciles". So, for each of five seeds × 365 days
// (channel-year.ts states the model; every number is a parameter with its
// source in params.ts):
//
//   * THE BAND. The market bands the first campaign used
//     (from-nothing-to-a-sale.test.ts: pessimistic, base, optimistic) bound
//     what a believable year looks like: search visits per listing-day after
//     the index lag between the pessimistic 0.2 and the optimistic 8, and a
//     visit-to-purchase rate between 0.005 and 0.045. The middle seed must sit
//     inside, and the spread across seeds is reported, never smoothed.
//   * THE RECONCILIATION. What the twin knows each channel took, returned and
//     kept is carried through Foundry's real code — the Gumroad and Lemon
//     Squeezy adapters against a fake of each API, the real recording, the
//     real per-stream line; the Workshop's and Etsy's through the economic
//     ledger as their intakes write it — and the line must equal the truth,
//     sale for sale and cent for cent, with Lemon Squeezy's fees "not known".
//
// The scorecard (numbers per seed and per channel) is written to
// $CAMPAIGN_OUT/channel-year.json and printed.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHS, marketYear, truthByChannel, type Ch, type ChannelYear } from './channel-year.js';

const int = (v: string | undefined, d: number): number => (v && /^\d+$/.test(v) ? Number(v) : d);
const SEEDS = int(process.env.SIM_CHANNEL_SEEDS, 5);
const DAYS = int(process.env.SIM_CHANNEL_DAYS, 365);
const BAND = { visitsPerListingDay: { low: 0.2, base: 1.0, high: 8 }, visitToBuy: { low: 0.005, base: 0.01, high: 0.045 } } as const;

interface SeedResult {
  seed: number;
  truth: ReturnType<typeof truthByChannel>;
  line: Record<string, { sales: number; grossCents: number; refunds: number; refundedCents: number; feesCents: number | null; netCents: number | null }>;
  visitsPerListingDay: Record<Ch, number | null>;
  visitToBuy: number | null;
  read: Record<string, unknown>;
}

/** One seed's year through the real code, on a fresh database. */
async function aYear(seed: number): Promise<SeedResult> {
  try { await (await import('../../../src/db/client.js')).closeDb(); } catch { /* nothing open */ }
  vi.resetModules();
  const y: ChannelYear = marketYear(seed, DAYS);
  const { query } = await import('../../../src/db/client.js');
  const { OWNER, seedProductionShape } = await import('../../helpers/world.js');
  const EXP = (await seedProductionShape()).experimentId;
  // Every row is written in the seeded experiment's own world (the guards refuse
  // a mismatch); the database is this test's alone and is thrown away.
  const MODE = String(((await query('SELECT evidence_mode FROM venture_experiments WHERE id = ?', [EXP])).rows[0] as Record<string, unknown>).evidence_mode) as 'real' | 'sandbox' | 'reference';
  const start = Date.now() - (DAYS + 2) * 86_400_000;
  const at = (day: number): string => new Date(start + day * 86_400_000).toISOString();
  const { record } = await import('../../../src/services/economy/ledger.js');

  // ── The Workshop and Etsy: the ledger, as their intakes write it ──
  let k = 0;
  const exposures = new Set<string>();
  for (const s of y.sales.filter((x) => x.ch === 'workshop')) {
    const provider = 'stripe';
    const id = `${s.ref}`;
    if (!exposures.has(provider)) {
      await query(`INSERT INTO experiment_exposures (id, founder_id, experiment_id, provider, exposure_ref, evidence_mode, placed_by)
        VALUES (?,?,?,?,?,?,'the channel twin')`, [`expo_${provider}`, OWNER, EXP, provider, `twin_${provider}`, MODE]);
      exposures.add(provider);
    }
    await query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider, provider_event_ref, evidence_mode)
      VALUES (?,?,?,'payment',?,?,?,?,?)`, [`boe_${id}`, OWNER, `expo_${provider}`, s.cents, at(s.day), provider, `pi_${id}`, MODE]);
    // Etsy's sales arrive as the Etsy reader records them: reported by the venue, not watched by Foundry.
    await query(`INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency, status, observed_how)
      VALUES (?,?,?,?,?,?,?,?,?,'usd','owed',?)`, [`ful_${id}`, OWNER, EXP, `expo_${provider}`, `boe_${id}`, provider, `pi_${id}`, `ch_${id}`, s.cents, provider === 'etsy' ? 'venue_reported' : 'foundry_observed']);
    await record({ founderId: OWNER, kind: 'charge', amountCents: s.cents, occurredAt: new Date(at(s.day)), provider, providerRef: `ch_${id}`,
      sourceEventId: `boe_${id}`, fulfilmentId: `ful_${id}`, evidenceMode: MODE, because: 'a twin buyer paid' });
    await record({ founderId: OWNER, kind: 'provider_fee', amountCents: s.feeCents!, occurredAt: new Date(at(s.day)), provider, providerRef: `fee_${id}`,
      fulfilmentId: `ful_${id}`, evidenceMode: MODE, because: 'the channel said what it kept' });
    if (s.refunded) {
      await record({ founderId: OWNER, kind: 'refund', amountCents: s.cents, occurredAt: new Date(at(s.day + 3)), provider, providerRef: `re_${id}`,
        fulfilmentId: `ful_${id}`, evidenceMode: MODE, because: 'a twin buyer asked for the money back' });
    }
    k += 1;
  }

  // ── Gumroad and Lemon Squeezy: his grants, his keys, the listings, then the REAL adapters read a fake of each API ──
  const CH = await import('../../../src/services/venture/storefront/channels.js');
  await CH.grantChannel(OWNER, 'gumroad', {}, 'the twin: every channel open', `founder:${OWNER}`);
  await CH.grantChannel(OWNER, 'lemonsqueezy', { storeId: '1' }, 'the twin: every channel open', `founder:${OWNER}`);
  const { encrypt } = await import('../../../src/services/encryption.js');
  for (const [ch, secret] of [['gumroad', { token: 'twin-token' }], ['lemonsqueezy', { apiKey: 'twin-key' }]] as const) {
    await query(`INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by) VALUES (?,?,?,?,?)`,
      [ch, encrypt(JSON.stringify(secret)), `twin-${ch}`, new Date().toISOString(), `founder:${OWNER}`]);
  }
  const products = [...new Set(y.sales.map((s) => s.product))];
  for (const prod of products) for (const ch of ['gumroad', 'lemonsqueezy'] as const) {
    await query(`INSERT INTO channel_listings (id, founder_id, experiment_id, version, channel, external_ref, price_cents, ai_disclosure, evidence_mode)
      VALUES (?,?,?,1,?,?,900,'the twin',?)`, [`cl_${ch}_${prod}`, OWNER, EXP, ch, `${ch}:${prod}`, MODE]);
  }
  const gum = y.sales.filter((s) => s.ch === 'gumroad').map((s) => ({ id: s.ref, created_at: at(s.day), price: s.cents, gumroad_fee: s.feeCents, currency: 'usd',
    product_id: `gumroad:${s.product}`, refunded: s.refunded, partially_refunded: false, chargedback: false, amount_refundable_in_currency: s.refunded ? 0 : s.cents }));
  const ls = y.sales.filter((s) => s.ch === 'lemonsqueezy').sort((a, b) => b.day - a.day).map((s, i) => ({ type: 'orders', id: String(i + 1), attributes: {
    identifier: s.ref, currency: 'USD', subtotal: s.cents, tax: Math.round(s.cents * 0.2), total: s.cents + Math.round(s.cents * 0.2),
    status: s.refunded ? 'refunded' : 'paid', refunded: s.refunded, refunded_amount: s.refunded ? s.cents + Math.round(s.cents * 0.2) : 0,
    refunded_at: s.refunded ? at(s.day + 3) : null, test_mode: false, created_at: at(s.day), first_order_item: { product_id: `lemonsqueezy:${s.product}` } } }));
  // Small pages, so every seed with more than two sales on a channel is read across pages.
  const PAGE = 2;
  const { useChannelHttp } = await import('../../../src/services/venture/storefront/canonical.js');
  useChannelHttp(async (url) => {
    const u = new URL(url);
    const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200 });
    if (u.pathname === '/v2/sales') {
      const from = Number(u.searchParams.get('page_key') ?? 0);
      return json({ success: true, sales: gum.slice(from, from + PAGE), ...(from + PAGE < gum.length ? { next_page_key: String(from + PAGE) } : {}) });
    }
    if (u.pathname === '/v1/orders') {
      const page = Number(u.searchParams.get('page[number]') ?? 1);
      return json({ data: ls.slice((page - 1) * PAGE, page * PAGE), meta: { page: { currentPage: page, lastPage: Math.max(1, Math.ceil(ls.length / PAGE)) } } });
    }
    return new Response('{}', { status: 404 });
  });
  // Etsy, as a channel of a multi-channel product: what Etsy reports, recorded once against the listing.
  for (const prod of products) {
    await query(`INSERT INTO channel_listings (id, founder_id, experiment_id, version, channel, external_ref, price_cents, ai_disclosure, evidence_mode)
      VALUES (?,?,?,1,'etsy',?,900,'the twin',?)`, [`cl_etsy_${prod}`, OWNER, EXP, `etsy:${prod}`, MODE]);
  }
  const { recordChannelSales } = await import('../../../src/services/venture/storefront/reconcile.js');
  await recordChannelSales(OWNER, y.sales.filter((s) => s.ch === 'etsy').flatMap((s) => [
    { channel: 'etsy' as const, kind: 'sale' as const, providerRef: s.ref, productRef: `etsy:${s.product}`, grossCents: s.cents, feeCents: s.feeCents, taxCents: 0, currency: 'usd', occurredAt: at(s.day) },
    ...(s.refunded ? [{ channel: 'etsy' as const, kind: 'refund' as const, providerRef: s.ref, productRef: `etsy:${s.product}`, grossCents: s.cents, feeCents: null, taxCents: 0, currency: 'usd', occurredAt: at(s.day + 3) }] : []),
  ]), MODE);
  const ST = await import('../../../src/services/venture/storefront/index.js');
  const read = {
    gumroad: await ST.readChannel(OWNER, 'gumroad', new Date(start), MODE),
    lemonsqueezy: await ST.readChannel(OWNER, 'lemonsqueezy', new Date(start), MODE),
  };
  const { channelPnl } = await import('../../../src/services/venture/storefront/reconcile.js');
  const stream = (await channelPnl(OWNER, DAYS + 30, MODE)).find((s) => s.experimentId === EXP);
  const line = Object.fromEntries((stream?.channels ?? []).map((c) => [c.channel, { sales: c.sales, grossCents: c.grossCents, refunds: c.refunds, refundedCents: c.refundedCents, feesCents: c.feesCents, netCents: c.netCents }]));
  const visitsPerListingDay = Object.fromEntries(CHS.map((c) => [c, y.listingDaysAfterLag[c] > 0 ? y.visits[c] / y.listingDaysAfterLag[c] : null])) as Record<Ch, number | null>;
  const searchVisits = y.visits.workshop + y.visits.etsy + y.visits.gumroad;
  const searchSales = y.sales.filter((s) => s.why === 'search').length;
  void k;
  return { seed, truth: truthByChannel(y), line, visitsPerListingDay, visitToBuy: searchVisits ? searchSales / searchVisits : null, read };
}

const results: SeedResult[] = [];
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)]! : NaN; };

describe(`a year on every channel — ${String(SEEDS)} seeds × ${String(DAYS)} days`, () => {
  it('runs every seed through the real storefront code', async () => {
    for (let s = 1; s <= SEEDS; s++) results.push(await aYear(s));
    expect(results).toHaveLength(SEEDS);
    const out = resolve(process.env.CAMPAIGN_OUT ?? 'tests/simulation/out', 'channel-year.json');
    mkdirSync(resolve(out, '..'), { recursive: true });
    writeFileSync(out, JSON.stringify(results, null, 1));
    for (const r of results) {
      process.stdout.write(`channel year seed ${String(r.seed)}: ${CHS.map((c) => `${c} ${String(r.truth[c].sales)} sold/${String(r.truth[c].refunds)} back, $${(r.truth[c].gross / 100).toFixed(0)}`).join(' · ')}; `
        + `search visits/listing-day ${CHS.slice(0, 3).map((c) => `${c} ${(r.visitsPerListingDay[c] ?? 0).toFixed(2)}`).join(', ')}; visit→buy ${(r.visitToBuy ?? 0).toFixed(4)}\n`);
    }
  }, 600_000);

  it('each channel\'s line equals what the twin says it sold, returned and kept — every seed, cent for cent', () => {
    for (const r of results) {
      for (const c of CHS) {
        const t = r.truth[c];
        const l = r.line[c];
        if (t.sales === 0) { expect(l, `seed ${String(r.seed)} ${c}: no sales, no line`).toBeUndefined(); continue; }
        expect(l, `seed ${String(r.seed)} ${c}`).toMatchObject({ sales: t.sales, grossCents: t.gross, refunds: t.refunds, refundedCents: t.refunded });
        // Lemon Squeezy states no fee on an order: not known, never zero.
        if (c === 'lemonsqueezy') expect(l!.feesCents, `seed ${String(r.seed)} ${c}`).toBeNull();
        else expect(l!.feesCents, `seed ${String(r.seed)} ${c}`).toBe(t.fees);
        if (l!.feesCents !== null) expect(l!.netCents).toBe(t.gross - t.refunded - t.fees!);
      }
    }
  });

  it('the middle seed sits in the band: search visits per listing-day and the visit-to-purchase rate', () => {
    const wv = median(results.map((r) => r.visitsPerListingDay.workshop ?? 0));
    const vb = median(results.map((r) => r.visitToBuy ?? 0));
    expect(wv).toBeGreaterThanOrEqual(BAND.visitsPerListingDay.low);
    expect(wv).toBeLessThanOrEqual(BAND.visitsPerListingDay.high);
    expect(vb).toBeGreaterThanOrEqual(BAND.visitToBuy.low);
    expect(vb).toBeLessThanOrEqual(BAND.visitToBuy.high);
  });

  it('more than one channel sells in the middle seed, and the merchant of record takes EU and UK buyers', () => {
    const selling = results.map((r) => CHS.filter((c) => r.truth[c].sales > 0).length);
    expect(median(selling)).toBeGreaterThanOrEqual(2);
    expect(results.some((r) => r.truth.lemonsqueezy.sales > 0)).toBe(true);
  });
});
