// =============================================================================
// THE MARKET TWIN — who finds a listing, who buys, and what happens after.
//
// THE MODEL, stated so it can be argued with (every number it uses is a
// parameter in params.ts, drawn per seed, with its source):
//
//   1. A LISTING is a live offer of the institution's: a page the Workshop
//      serves with an active payment link. The twin reads its title, price
//      and theme from what the institution actually published, and its
//      hidden quality from what the brain meant it to be.
//
//   2. DISCOVERY. Search sends nothing until `market.indexLagDays` after the
//      listing went live. After that, each day:
//        impressions ~ Poisson(impressionsPerDay × themeDemand × season)
//        visits      ~ Binomial(impressions, clickThrough × attractiveness)
//      where attractiveness compares the listing with `competitorsPerTheme`
//      competing listings (price, reviews, quality) and is clamped to
//      [0.2, 3]. Word of mouth adds visits after sales.
//
//   3. CONVERSION. Each visitor belongs to a segment that has the theme
//      (segments.ts), drawn by the segment's share. They buy only if the
//      price is within their willingness to pay (the panel's stated top price
//      × `market.wtpScale`, ±25%), and then with probability
//        baseConversion × fit × quality factor × (noReviewPenalty if no reviews)
//      where a visible defect (a page count the listing gets wrong, an
//      over-claim) cuts the quality factor.
//
//   4. AFTER A SALE. Each buyer, independently: asks for a refund within a
//      week (refundRate + refundPerDefect × defects + a penalty for low
//      quality); writes to the Workshop (buyerEmailRate); leaves a review
//      (reviewRate, rating from quality); buys another of the Workshop's files
//      later (repeatRate); and brings word-of-mouth visits (womVisitsPerSale).
//
// The twin never touches the institution's rows. It reports EVENTS; the
// harness carries each through the real door a buyer would use (the Stripe
// webhook, the signed refund link, the Workshop's mail intake).
// =============================================================================
import { Rng } from './rng.js';
import { THEMES, seasonOf, segmentsFor, themeDemand, themeOf, type ThemeKey } from './segments.js';
import type { Drawn } from './params.js';

export interface Listing {
  /** Stable across runs: the title the institution published. */
  key: string;
  experimentId: string;
  title: string;
  priceCents: number;
  /** The first simulated day the twin saw it live. */
  liveSince: number;
  theme: ThemeKey | null;
  quality: number;
  defects: string[];
}

export type MarketEvent =
  | { kind: 'purchase'; listing: Listing; buyer: number; why: 'search' | 'word-of-mouth' | 'repeat' }
  | { kind: 'refund-request'; buyer: number; listingKey: string }
  | { kind: 'buyer-mail'; buyer: number; listingKey: string; text: string };

interface ListingState { sales: number; reviews: number[]; wom: number }
/** A review shows on the listing some days after the sale; it is the twin's own state, not an event for the institution. */
type Due = MarketEvent | { kind: 'review'; listingKey: string; rating: number };
interface Pending { day: number; event: Due }

export interface MarketDay { impressions: number; visits: number; events: MarketEvent[] }

export class Market {
  private readonly listings = new Map<string, ListingState>();
  private pending: Pending[] = [];
  private buyers = 0;
  readonly totals = { impressions: 0, visits: 0, purchases: 0, refundRequests: 0, mails: 0, reviews: 0, repeat: 0 };

  constructor(private readonly seed: number, private readonly p: Drawn) {}

  private stateOf(key: string): ListingState {
    let s = this.listings.get(key);
    if (!s) { s = { sales: 0, reviews: [], wom: 0 }; this.listings.set(key, s); }
    return s;
  }

  /** How a listing compares with the competition its buyers also see (1 = the average competitor). */
  attractiveness(l: Listing): number {
    const s = this.stateOf(l.key);
    const comp = this.p['market.competitorPrice'];
    const priceFactor = Math.min(1.6, Math.max(0.4, comp / Math.max(1, l.priceCents / 100)));
    const qualityFactor = (0.3 + l.quality) / (0.3 + this.p['market.competitorQuality']);
    const reviewFactor = s.reviews.length === 0 ? this.p['market.noReviewPenalty'] : Math.min(1.5, 0.8 + 0.1 * s.reviews.length) * (s.reviews.reduce((a, b) => a + b, 0) / s.reviews.length / 4.2);
    // Many competitors spread the same clicks thinner.
    const crowd = Math.sqrt(10 / Math.max(1, this.p['market.competitorsPerTheme']));
    return Math.min(3, Math.max(0.2, priceFactor * qualityFactor * reviewFactor * crowd));
  }

  private convert(l: Listing, r: Rng, why: 'search' | 'word-of-mouth'): MarketEvent | null {
    if (!l.theme) return null;
    const segs = segmentsFor(l.theme);
    let u = r.next(); let seg = segs[0]!.segment;
    for (const x of segs) { if (u < x.share) { seg = x.segment; break; } u -= x.share; }
    const wtp = seg.wtpDollars * this.p['market.wtpScale'] * (0.75 + 0.5 * r.next());
    if (l.priceCents / 100 > wtp) return null;
    const s = this.stateOf(l.key);
    const defectCut = Math.pow(0.7, l.defects.length);
    const qualityCut = 0.4 + 0.8 * l.quality;
    const trust = s.reviews.length === 0 ? this.p['market.noReviewPenalty'] : 1;
    const pBuy = Math.min(0.9, this.p['market.baseConversion'] * defectCut * qualityCut * trust * (why === 'word-of-mouth' ? 3 : 1));
    if (!r.chance(pBuy)) return null;
    return { kind: 'purchase', listing: l, buyer: ++this.buyers, why };
  }

  /** What happens to a buyer after a purchase, decided now and delivered on later days. */
  afterSale(day: number, e: Extract<MarketEvent, { kind: 'purchase' }>, live: Listing[]): void {
    const l = e.listing;
    const r = new Rng('after', this.seed, l.key, e.buyer);
    const s = this.stateOf(l.key);
    s.sales += 1;
    this.totals.purchases += 1;
    const pRefund = Math.min(0.9, this.p['outcome.refundRate'] + this.p['outcome.refundPerDefect'] * l.defects.length + 0.15 * Math.max(0, 0.5 - l.quality));
    if (r.chance(pRefund)) this.pending.push({ day: day + r.int(1, 7), event: { kind: 'refund-request', buyer: e.buyer, listingKey: l.key } });
    if (r.chance(this.p['outcome.buyerEmailRate'])) {
      const text = r.pick([
        'Hello, I bought the file yesterday. Can I print it on A4 paper as well as letter?',
        'Thanks, this is useful. Is there a version I can type into?',
        'I paid but cannot find the download link. Could you send it again?',
        'Is there a version for someone looking after a parent?',
      ]);
      this.pending.push({ day: day + r.int(1, 5), event: { kind: 'buyer-mail', buyer: e.buyer, listingKey: l.key, text } });
    }
    if (r.chance(this.p['outcome.reviewRate'])) {
      const rating = Math.max(1, Math.min(5, Math.round(1.5 + 3.5 * l.quality + r.normal() * 0.6)));
      // A review only shows on the listing some days later.
      this.pending.push({ day: day + r.int(3, 20), event: { kind: 'review', listingKey: l.key, rating } });
    }
    s.wom += this.p['outcome.womVisitsPerSale'] * (0.5 + l.quality);
    if (r.chance(this.p['outcome.repeatRate'])) {
      const other = live.filter((x) => x.key !== l.key && x.theme !== null);
      if (other.length) {
        const pick = other[Math.floor(r.next() * other.length)]!;
        this.pending.push({ day: day + r.int(5, 40), event: { kind: 'purchase', listing: pick, buyer: e.buyer, why: 'repeat' } });
      }
    }
  }

  /** One day of the market over the listings live today. */
  day(day: number, live: Listing[]): MarketDay {
    const out: MarketDay = { impressions: 0, visits: 0, events: [] };
    // What was decided earlier and falls due today. A review is applied here, not reported.
    const due = this.pending.filter((x) => x.day <= day);
    this.pending = this.pending.filter((x) => x.day > day);
    for (const { event } of due) {
      if (event.kind === 'review') { this.stateOf(event.listingKey).reviews.push(event.rating); this.totals.reviews += 1; continue; }
      if (event.kind === 'purchase') {
        const still = live.find((x) => x.key === event.listing.key);
        if (!still) continue;
        this.totals.repeat += 1;
        out.events.push({ ...event, listing: still });
        continue;
      }
      if (event.kind === 'refund-request') this.totals.refundRequests += 1;
      if (event.kind === 'buyer-mail') this.totals.mails += 1;
      out.events.push(event);
    }
    for (const l of [...live].sort((a, b) => a.key.localeCompare(b.key))) {
      const r = new Rng('day', this.seed, day, l.key);
      const s = this.stateOf(l.key);
      let visits = 0;
      if (l.theme && day - l.liveSince >= this.p['market.indexLagDays']) {
        const lambda = this.p['market.impressionsPerDay'] * themeDemand(l.theme) * seasonOf(l.theme, day + 280, this.p['market.seasonAmplitude']);
        const impressions = r.poisson(lambda);
        out.impressions += impressions;
        visits = r.binomial(impressions, Math.min(0.5, this.p['market.clickThrough'] * this.attractiveness(l)));
      }
      const womVisits = Math.floor(s.wom); s.wom -= womVisits;
      for (let i = 0; i < visits + womVisits; i++) {
        const e = this.convert(l, r, i < visits ? 'search' : 'word-of-mouth');
        if (e) out.events.push(e);
      }
      out.visits += visits + womVisits;
    }
    this.totals.impressions += out.impressions;
    this.totals.visits += out.visits;
    return out;
  }
}

/** The theme of a published title, by the twin's words; null when it serves none of them. */
export const listingTheme = (title: string): ThemeKey | null => themeOf(title) ?? themeOf(Object.values(THEMES).find((t) => title.toLowerCase().includes(t.name))?.name ?? '');
