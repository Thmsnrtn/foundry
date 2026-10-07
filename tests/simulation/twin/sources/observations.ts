// =============================================================================
// WHAT THE TWIN MAY LEAN ON — every number here was observed by somebody, and
// says by whom. Anything the twin needs that is not here is an ASSUMPTION and
// is labelled as one where it is used (params.ts); nothing below is invented.
//
// THREE SOURCES, AND WHAT EACH IS WORTH:
//
//   CALIBRATION — one seller's self-report of selling PDFs (Travis Nicholson,
//     "I've made $40,000+ selling PDFs", Medium, 2026-10-04), transcribed in
//     the playbook calibration notes (sim2/playbook-calibration.md). A seller
//     WITH an audience who also sells the playbook: survivorship and incentive
//     bias, so it is an OPTIMISTIC anchor, never a median.
//
//   BUYER PANEL — five buyer personas, each played by a model, reading one
//     real listing ("The Handover File", $12) and the 22-page file the
//     playbook bench made (sim2/buyer-panel/p1…p5, 6 October 2026). Five
//     opinions from one model family about one product: a direction, not a
//     distribution. It is the only buyer voice the twin has.
//
//   CASSETTE — what the real public sources answered the eyes on 6 October
//     2026, reduced to counts by `digest-cassette.mts` (cassette-digest.json).
// =============================================================================
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CALIBRATION = {
  cite: 'sim2/playbook-calibration.md (Travis Nicholson, Medium, 2026-10-04; self-reported, optimistic)',
  year1: { revenueDollars: 14_755.63, productPageViews: 56_069 },
  year2: { revenueDollars: 27_415.34, productPageViews: 145_000 },
  basePriceDollars: 5,
  bundlePriceDollars: { low: 15, high: 20 },
  productsTried: 20,
  /** "only a handful made a meaningful share of revenue" — a power law, stated in words, not numbers. */
  handfulMadeMostRevenue: true,
  /** Revenue per product-page view: year 1 and year 2. */
  revenuePerView: { year1: 14_755.63 / 56_069, year2: 27_415.34 / 145_000 },
  /** The notes' own reading of the implied funnel for an author with an audience. */
  viewToPurchase: { low: 0.04, high: 0.05 },
  /** The notes' pessimistic band for a new seller with no audience. */
  newSellerConversion: { low: 0.005, high: 0.015 },
} as const;

/** Each persona's answers about one $12 listing, as written in its own file. */
export interface PanelVoice {
  tag: string;
  who: string;
  gutAt12: 'buy' | 'maybe' | 'no';
  maxPriceDollars: number;
  wouldRefund: boolean;
  wouldRecommend: boolean;
  /** Whether a free sample first made them more likely to buy. */
  magnetHelps: boolean;
  /** The comparison price the persona named for what it would buy instead, when it named one. */
  comparedWithDollars: number | null;
  topObjection: string;
}

export const BUYER_PANEL: { cite: string; listingPriceDollars: number; voices: readonly PanelVoice[] } = {
  cite: 'sim2/buyer-panel/p1-p5 (5 model-played personas, one listing, 2026-10-06)',
  listingPriceDollars: 12,
  voices: [
    { tag: 'p1-grieving', who: 'an adult child who has just sorted out a parent\'s affairs', gutAt12: 'maybe', maxPriceDollars: 15, wouldRefund: false, wouldRecommend: true, magnetHelps: true, comparedWithDollars: 14.99, topObjection: 'no reviews, and an unknown seller' },
    { tag: 'p2-planner-mom', who: 'a parent of young children who buys planner printables', gutAt12: 'maybe', maxPriceDollars: 9, wouldRefund: false, wouldRecommend: true, magnetHelps: true, comparedWithDollars: 6, topObjection: 'not fillable; similar printables are $4-8' },
    { tag: 'p3-caregiver', who: 'a caregiver for an elderly parent, technically minded', gutAt12: 'maybe', maxPriceDollars: 9, wouldRefund: false, wouldRecommend: true, magnetHelps: true, comparedWithDollars: null, topObjection: 'the free sample already covers most of the need' },
    { tag: 'p4-retiree', who: 'a retiree who keeps paper files', gutAt12: 'maybe', maxPriceDollars: 12, wouldRefund: false, wouldRecommend: true, magnetHelps: true, comparedWithDollars: 15, topObjection: 'no reviews; wary of a stranger\'s download' },
    { tag: 'p5-skeptic', who: 'a young renter who could make a template himself', gutAt12: 'no', maxPriceDollars: 4.5, wouldRefund: false, wouldRecommend: true, magnetHelps: true, comparedWithDollars: 0, topObjection: 'it is a template; the free sheet is enough' },
  ],
};

export interface CassetteDigest {
  what: string;
  recordedOn: string[];
  keys: number;
  byHost: Record<string, { queries: number; returned: number[]; total: Array<number | null>; painSaid: number[] }>;
}

export const CASSETTE_DIGEST: CassetteDigest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'cassette-digest.json'), 'utf8')) as CassetteDigest;

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
export const quantileOf = (xs: number[], q: number): number => {
  const s = sorted(xs);
  if (s.length === 0) return 0;
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i]!;
};

/** Items a discussion search returned per query, as the archive answered (Hacker News). */
export function cassetteHitsPerQuery(): { min: number; median: number; max: number; n: number } {
  const r = CASSETTE_DIGEST.byHost['hn.algolia.com']?.returned ?? [];
  return { min: quantileOf(r, 0), median: quantileOf(r, 0.5), max: quantileOf(r, 1), n: r.length };
}

/** Of the items a pain-phrased discussion search returned, the share that said a chore in words. */
export function cassettePainShare(): { low: number; median: number; high: number; n: number } {
  const h = CASSETTE_DIGEST.byHost['hn.algolia.com'];
  const shares = (h?.returned ?? []).map((r, i) => (r > 0 ? (h!.painSaid[i] ?? 0) / r : null)).filter((x): x is number => x !== null);
  return { low: quantileOf(shares, 0.1), median: quantileOf(shares, 0.5), high: quantileOf(shares, 0.9), n: shares.length };
}
