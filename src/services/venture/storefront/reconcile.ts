// =============================================================================
// FOUNDRY — every channel's sales and refunds, reconciled into one product,
// one version and one profit-and-loss line per stream (F2).
//
// THREE SOURCES, NONE COUNTED TWICE:
//   * the Workshop's own page: Stripe charges, fees and refunds, already in
//     the economic ledger through fulfilments (stripe-economics.ts);
//   * Etsy: receipts and the fee Etsy kept, already in the same ledger through
//     the Etsy sense (etsy-shop.ts);
//   * Gumroad and Lemon Squeezy: merchants of record that deliver the file and
//     collect the tax themselves, so nothing is owed by Foundry and no
//     fulfilment is opened — their sales are recorded as the channel stated
//     them, in `channel_sales` (immutable, one row per sale or refund).
//
// A channel's product is tied to Foundry's canonical product by
// `channel_listings` (the listing the door placed, or the one he made in a
// dashboard and recorded). A sale for a product Foundry did not list is not
// Foundry's and is not recorded. A fee the channel did not state is NOT KNOWN,
// and the line says so; the published schedule's estimate is shown beside it,
// labelled an estimate. Tax a merchant of record collected is never revenue.
// =============================================================================
import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { feeRangeCents } from '../fee-floor.js';
import { CHANNELS, FEE_VENUE, type Channel, type MarketChannel } from './channels.js';

/** One sale or refund, as a channel stated it. */
export interface ChannelSale {
  channel: MarketChannel; kind: 'sale' | 'refund';
  /** The channel's id for the sale (a refund carries its sale's id). */
  providerRef: string;
  /** The channel's id for the product, tying the sale to a listing. */
  productRef: string;
  grossCents: number; feeCents: number | null; taxCents: number; currency: string; occurredAt: string;
}

type Row = Record<string, unknown>;

/** Record a listing he made himself in a channel's dashboard (Lemon Squeezy has no create API). His act. */
export async function recordOwnerListing(input: {
  founderId: string; experimentId: string; channel: MarketChannel; externalRef: string; version: number; priceCents: number; by: string;
}): Promise<{ id: string } | { refused: string }> {
  if (!input.by.startsWith('founder:')) return { refused: 'a listing he made himself is recorded by him' };
  if (!input.externalRef.trim()) return { refused: 'say the product\'s id on the channel, so its sales can be tied to it' };
  const { canonicalListing } = await import('./canonical.js');
  const l = await canonicalListing(input.founderId, input.experimentId);
  if ('refused' in l) return l;
  if (l.version !== input.version) return { refused: `the canonical product is version ${String(l.version)}, not ${String(input.version)}` };
  const id = nanoid();
  await query(
    `INSERT INTO channel_listings (id, founder_id, experiment_id, version, channel, external_ref, price_cents, ai_disclosure, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.experimentId, input.version, input.channel, input.externalRef, input.priceCents,
      'made by the owner in the channel\'s dashboard from the canonical listing, whose description carries the disclosure', l.evidenceMode]);
  return { id };
}

/**
 * RECORD WHAT A CHANNEL SAID, ONCE. A sale is tied to the canonical product
 * through the listing that carries its product id; a sale of anything else is
 * skipped and counted. Idempotent: the same sale read twice is one row.
 */
export async function recordChannelSales(founderId: string, sales: ChannelSale[], evidenceMode: 'real' | 'sandbox' | 'reference'): Promise<{ recorded: number; repeated: number; notOurs: number }> {
  const listings = (await query(
    `SELECT channel, external_ref, experiment_id, version FROM channel_listings WHERE founder_id = ?`, [founderId])).rows as Row[];
  const byRef = new Map(listings.map((r) => [`${String(r.channel)}:${String(r.external_ref)}`, r]));
  let recorded = 0; let repeated = 0; let notOurs = 0;
  for (const s of sales) {
    const l = byRef.get(`${s.channel}:${s.productRef}`);
    if (!l) { notOurs += 1; continue; }
    const r = await query(
      `INSERT INTO channel_sales (id, founder_id, experiment_id, version, channel, kind, provider_ref, gross_cents, fee_cents, tax_cents, currency, occurred_at, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(channel, provider_ref, kind) DO NOTHING`,
      [nanoid(), founderId, String(l.experiment_id), Number(l.version), s.channel, s.kind, s.providerRef, s.grossCents, s.feeCents, s.taxCents,
        s.currency, s.occurredAt, evidenceMode]);
    if (Number(r.rowsAffected ?? 0) > 0) recorded += 1; else repeated += 1;
  }
  return { recorded, repeated, notOurs };
}

export interface ChannelLine {
  channel: Channel; sales: number; refunds: number;
  grossCents: number; refundedCents: number;
  /** What the channel said it kept; null when any sale's fee is unstated. */
  feesCents: number | null;
  /** The published schedule's estimate of the fees, for when the channel did not say. */
  estimatedFeesCents: { low: number; high: number };
  /** Revenue less refunds less stated fees; null while a fee is not known. */
  netCents: number | null;
  because: string;
}

export interface StreamPnl { experimentId: string; channels: ChannelLine[]; totalNetCents: number | null }

/** Every stream's line, per channel, over the last `days` days, from real money only unless asked. */
export async function channelPnl(founderId: string, days = 30, evidenceMode: 'real' | 'sandbox' | 'reference' = 'real'): Promise<StreamPnl[]> {
  const since = `-${String(days)} days`;
  const lines = new Map<string, Map<Channel, ChannelLine>>();
  const line = (exp: string, ch: Channel): ChannelLine => {
    let m = lines.get(exp); if (!m) { m = new Map(); lines.set(exp, m); }
    let l = m.get(ch);
    if (!l) { l = { channel: ch, sales: 0, refunds: 0, grossCents: 0, refundedCents: 0, feesCents: 0, estimatedFeesCents: { low: 0, high: 0 }, netCents: 0, because: '' }; m.set(ch, l); }
    return l;
  };
  // The Workshop and Etsy: the economic ledger, by the provider that wrote it.
  const ledger = (await query(
    `SELECT f.experiment_id AS exp, e.provider, e.kind, e.amount_cents, e.fulfilment_id FROM economic_events e
       JOIN experiment_fulfilments f ON f.id = e.fulfilment_id
      WHERE e.founder_id = ? AND e.evidence_mode = ? AND datetime(e.occurred_at) >= datetime('now', ?)
        AND e.kind IN ('charge','refund','dispute_withdrawal','provider_fee','refund_fee_returned','dispute_fee')`,
    [founderId, evidenceMode, since])).rows as Row[];
  const feeRead = new Map<string, number>();
  for (const r of ledger) {
    const ch: Channel = String(r.provider) === 'etsy' ? 'etsy' : 'workshop';
    const l = line(String(r.exp), ch);
    const cents = Number(r.amount_cents);
    switch (String(r.kind)) {
      case 'charge': {
        l.sales += 1; l.grossCents += cents;
        const est = feeRangeCents(FEE_VENUE[ch], cents);
        l.estimatedFeesCents.low += est.low; l.estimatedFeesCents.high += est.high;
        break;
      }
      case 'refund': case 'dispute_withdrawal': l.refunds += 1; l.refundedCents += cents; break;
      case 'provider_fee': case 'dispute_fee': l.feesCents = (l.feesCents ?? 0) + cents; feeRead.set(`${String(r.exp)}:${ch}`, (feeRead.get(`${String(r.exp)}:${ch}`) ?? 0) + (String(r.kind) === 'provider_fee' ? 1 : 0)); break;
      case 'refund_fee_returned': l.feesCents = (l.feesCents ?? 0) - cents; break;
      default: break;
    }
  }
  for (const [exp, m] of lines) for (const l of m.values()) {
    if ((feeRead.get(`${exp}:${l.channel}`) ?? 0) < l.sales) l.feesCents = null;
  }
  // Gumroad and Lemon Squeezy: what they said, in channel_sales.
  const stated = (await query(
    `SELECT experiment_id AS exp, channel, kind, gross_cents, fee_cents FROM channel_sales
      WHERE founder_id = ? AND evidence_mode = ? AND datetime(occurred_at) >= datetime('now', ?)`,
    [founderId, evidenceMode, since])).rows as Row[];
  for (const r of stated) {
    const ch = String(r.channel) as Channel;
    const l = line(String(r.exp), ch);
    const cents = Number(r.gross_cents);
    if (String(r.kind) === 'sale') {
      l.sales += 1; l.grossCents += cents;
      const est = feeRangeCents(FEE_VENUE[ch], cents);
      l.estimatedFeesCents.low += est.low; l.estimatedFeesCents.high += est.high;
      l.feesCents = r.fee_cents == null || l.feesCents === null ? null : l.feesCents + Number(r.fee_cents);
    } else { l.refunds += 1; l.refundedCents += cents; }
  }
  const out: StreamPnl[] = [];
  for (const [exp, m] of lines) {
    const channels = CHANNELS.filter((c) => m.has(c)).map((c) => {
      const l = m.get(c)!;
      l.netCents = l.feesCents === null ? null : l.grossCents - l.refundedCents - l.feesCents;
      l.because = l.feesCents === null
        ? `not known until the channel says what it kept; its published schedule puts it at $${(l.estimatedFeesCents.low / 100).toFixed(2)}–$${(l.estimatedFeesCents.high / 100).toFixed(2)} (an estimate)`
        : 'what buyers paid, less refunds and the fees the channel stated';
      return l;
    });
    out.push({ experimentId: exp, channels, totalNetCents: channels.some((c) => c.netCents === null) ? null : channels.reduce((s, c) => s + c.netCents!, 0) });
  }
  return out.sort((a, b) => a.experimentId.localeCompare(b.experimentId));
}

// ─── The diversification limit, per channel ──────────────────────────────────
//
// One suspended account must never be the whole business. The limit is the
// share of trailing revenue any one channel may carry before it is an alert.
// AN ASSUMPTION, NAMED AS ONE: 60%, chosen so that with four channels no one
// of them is a majority-and-then-some; the owner may change it.

export const MAX_CHANNEL_SHARE = 0.6;

/** Each channel's share of trailing gross revenue, and whether one is over the limit. */
export async function channelConcentration(founderId: string, days = 90, evidenceMode: 'real' | 'sandbox' | 'reference' = 'real'): Promise<{ shares: Partial<Record<Channel, number>>; over: Channel | null; sentence: string }> {
  const totals = new Map<Channel, number>();
  for (const s of await channelPnl(founderId, days, evidenceMode)) for (const c of s.channels) totals.set(c.channel, (totals.get(c.channel) ?? 0) + c.grossCents - c.refundedCents);
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  if (all <= 0) return { shares: {}, over: null, sentence: `No revenue in the last ${String(days)} days, so no channel carries the business.` };
  const shares = Object.fromEntries([...totals].map(([c, v]) => [c, v / all])) as Partial<Record<Channel, number>>;
  const over = (Object.entries(shares) as Array<[Channel, number]>).find(([, s]) => s > MAX_CHANNEL_SHARE)?.[0] ?? null;
  return { shares, over, sentence: over
    ? `${over} carried ${(shares[over]! * 100).toFixed(0)}% of the last ${String(days)} days' revenue, over the ${String(MAX_CHANNEL_SHARE * 100)}% one channel may carry (an assumption you may change): one suspended account would be most of the business.`
    : `No channel carried more than ${String(MAX_CHANNEL_SHARE * 100)}% of the last ${String(days)} days' revenue.` };
}
