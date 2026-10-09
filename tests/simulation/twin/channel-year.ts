// =============================================================================
// A YEAR ON EVERY CHANNEL — the market twin, one market per channel, carried
// through Foundry's REAL storefront code (F2, 9 October 2026).
//
// THE MODEL, stated so it can be argued with. Every number is a parameter in
// params.ts with its source (most are assumptions, and say so):
//   * the catalogue is the panel's capable products (judges.ts), one per theme,
//     each listed on all four channels from day one — a counterfactual pilot
//     in which the owner has opened every channel and set a floor;
//   * each channel is the twin's own Market (market.ts) with that channel's
//     reach: the Workshop page at the search impressions the twin already
//     draws, after the index lag; Etsy at `channel.etsyReach` times that,
//     after `channel.marketplaceLagDays`; Gumroad's Discover at
//     `channel.gumroadReach`; Lemon Squeezy with no marketplace at all;
//   * a Workshop buyer in the EU or the UK (`channel.euBuyerShare`) is sent to
//     the merchant of record by the routing rule, and buys there;
//   * what each channel KEEPS is its own published schedule (fee-floor.ts):
//     Gumroad 10% + 50¢ direct and 30% on a sale Discover brought; Lemon
//     Squeezy states no fee on the order (so the line must say "not known").
//
// WHAT RUNS FOR REAL: Gumroad's and Lemon Squeezy's sales are served by a fake
// of each API (the shapes of tests/fixtures/channels.ts, paged), read by the
// real adapters, recorded by the real reconciliation and read back by the real
// per-stream line. The Workshop's and Etsy's sales are written to the
// economic ledger the way their intakes write them (those intakes are proved
// end to end elsewhere: a-printable-reaches-a-buyer, the Etsy reader's tests),
// then read by the same real line, in a database thrown away after.
// =============================================================================
import { Market, type Listing, type MarketEvent } from './market.js';
import { drawParams, type Drawn } from './params.js';
import { Rng } from './rng.js';
import { panelProducts } from '../panel/judges.js';
import type { ThemeKey } from './segments.js';

export type Ch = 'workshop' | 'etsy' | 'gumroad' | 'lemonsqueezy';
export const CHS: readonly Ch[] = ['workshop', 'etsy', 'gumroad', 'lemonsqueezy'];

export interface TruthSale { ch: Ch; product: string; day: number; ref: string; cents: number; feeCents: number | null; refunded: boolean; why: string }
export interface ChannelYear {
  seed: number; days: number; params: Drawn;
  sales: TruthSale[];
  /** Search or marketplace visits per channel, and listing-days after that channel's lag. */
  visits: Record<Ch, number>; listingDaysAfterLag: Record<Ch, number>;
}

const FEES = {
  workshop: (c: number) => Math.ceil(c * 0.029) + 30,
  etsy: (c: number) => Math.ceil(c * 0.095) + 25 + 20,
  gumroadDirect: (c: number) => Math.ceil(c * 0.10) + 50,
  gumroadDiscover: (c: number) => Math.ceil(c * 0.30),
};

/** Run the market side of one seed's year: pure, no database. */
export function marketYear(seed: number, days: number): ChannelYear {
  const p = drawParams(seed);
  const catalogue = panelProducts().filter((x) => x.kind === 'capable');
  const listing = (x: (typeof catalogue)[number]): Listing => ({ key: x.key, experimentId: 'twin', title: x.title, priceCents: x.priceDollars * 100,
    liveSince: 0, theme: x.theme as ThemeKey, quality: 0.75, defects: [] });
  const live = catalogue.map(listing);
  const markets: Record<Exclude<Ch, 'lemonsqueezy'>, Market> = {
    workshop: new Market(seed, p),
    etsy: new Market(seed + 10_000, { ...p, 'market.impressionsPerDay': p['market.impressionsPerDay'] * p['channel.etsyReach'], 'market.indexLagDays': p['channel.marketplaceLagDays'] }),
    gumroad: new Market(seed + 20_000, { ...p, 'market.impressionsPerDay': p['market.impressionsPerDay'] * p['channel.gumroadReach'], 'market.indexLagDays': p['channel.marketplaceLagDays'] }),
  };
  const lag: Record<Ch, number> = { workshop: p['market.indexLagDays'], etsy: p['channel.marketplaceLagDays'], gumroad: p['channel.marketplaceLagDays'], lemonsqueezy: Infinity };
  const visits: Record<Ch, number> = { workshop: 0, etsy: 0, gumroad: 0, lemonsqueezy: 0 };
  const listingDaysAfterLag: Record<Ch, number> = { workshop: 0, etsy: 0, gumroad: 0, lemonsqueezy: 0 };
  const sales: TruthSale[] = [];
  const pendingRefund = new Map<string, TruthSale>();
  let n = 0;
  for (let day = 1; day <= days; day++) {
    for (const ch of ['workshop', 'etsy', 'gumroad'] as const) {
      const m = markets[ch];
      const d = m.day(day, live);
      visits[ch] += d.visits;
      if (day >= lag[ch]) listingDaysAfterLag[ch] += live.length;
      for (const e of d.events) {
        if (e.kind === 'purchase') {
          const r = new Rng('chan', seed, ch, day, ++n);
          // THE ROUTING RULE: a Workshop buyer in the EU or the UK buys from the merchant of record.
          const to: Ch = ch === 'workshop' && r.chance(p['channel.euBuyerShare']) ? 'lemonsqueezy' : ch;
          const cents = e.listing.priceCents;
          const fee = to === 'workshop' ? FEES.workshop(cents) : to === 'etsy' ? FEES.etsy(cents)
            : to === 'gumroad' ? (e.why === 'search' ? FEES.gumroadDiscover(cents) : FEES.gumroadDirect(cents)) : null;
          const s: TruthSale = { ch: to, product: e.listing.key, day, ref: `tw${String(seed)}_${to}_${String(n)}`, cents, feeCents: fee, refunded: false, why: e.why };
          sales.push(s);
          pendingRefund.set(`${ch}:${String(e.buyer)}:${e.listing.key}`, s);
          m.afterSale(day, e as Extract<MarketEvent, { kind: 'purchase' }>, live);
        } else if (e.kind === 'refund-request') {
          const s = pendingRefund.get(`${ch}:${String(e.buyer)}:${e.listingKey}`);
          if (s) s.refunded = true;
        }
      }
    }
  }
  return { seed, days, params: p, sales, visits, listingDaysAfterLag };
}

/** What the twin knows each channel took and returned: the truth the real line must reconcile to. */
export function truthByChannel(y: ChannelYear): Record<Ch, { sales: number; gross: number; refunds: number; refunded: number; fees: number | null }> {
  const out = Object.fromEntries(CHS.map((c) => [c, { sales: 0, gross: 0, refunds: 0, refunded: 0, fees: 0 as number | null }])) as Record<Ch, { sales: number; gross: number; refunds: number; refunded: number; fees: number | null }>;
  for (const s of y.sales) {
    const t = out[s.ch];
    t.sales += 1; t.gross += s.cents;
    t.fees = s.feeCents === null || t.fees === null ? null : t.fees + s.feeCents;
    if (s.refunded) { t.refunds += 1; t.refunded += s.cents; }
  }
  return out;
}
