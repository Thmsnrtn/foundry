// =============================================================================
// THE TWIN'S PARAMETERS — every one a distribution, every one with a source.
//
// A parameter is never a point. Each seed draws ONE value of each from its
// distribution (`drawParams`), so a Monte Carlo over seeds is also a sweep
// over what we do not know, and the spread of an outcome across seeds is the
// honest width of the prediction.
//
// THE SOURCE IS PART OF THE PARAMETER. One of:
//   'cassette'     — counted from what the real public sources answered (sources/cassette-digest.json);
//   'calibration'  — the playbook calibration notes (one optimistic seller's self-report);
//   'buyer-panel'  — the five model-played buyer personas (one listing, one model family);
//   'assumption'   — NOBODY OBSERVED THIS. A guess, named as a guess, with the reasoning for its range.
// Where an observation only anchors part of a range, the source says what it
// anchors and the rest is still called an assumption. The registry test fails
// for any parameter whose source is missing or whose citation is empty.
// =============================================================================
import { BUYER_PANEL, CALIBRATION, cassetteHitsPerQuery, cassettePainShare } from './sources/observations.js';
import { Rng } from './rng.js';

export type Dist =
  | { kind: 'uniform'; min: number; max: number }
  | { kind: 'triangular'; min: number; mode: number; max: number }
  /** Uniform on the log scale: for rates spanning orders of magnitude. */
  | { kind: 'logUniform'; min: number; max: number };

export type SourceKind = 'cassette' | 'calibration' | 'buyer-panel' | 'assumption';
export interface Source { kind: SourceKind; cite: string }

export interface Param { what: string; unit: string; dist: Dist; source: Source }

/** The inverse CDF: the value at quantile q of the distribution. Used to draw and to sweep. */
export function quantile(d: Dist, q: number): number {
  const p = Math.min(1, Math.max(0, q));
  switch (d.kind) {
    case 'uniform': return d.min + (d.max - d.min) * p;
    case 'logUniform': return Math.exp(Math.log(d.min) + (Math.log(d.max) - Math.log(d.min)) * p);
    case 'triangular': {
      const { min, mode, max } = d;
      if (max === min) return min;
      const f = (mode - min) / (max - min);
      return p < f ? min + Math.sqrt(p * (max - min) * (mode - min)) : max - Math.sqrt((1 - p) * (max - min) * (max - mode));
    }
  }
}

const hits = cassetteHitsPerQuery();
const pain = cassettePainShare();
const panelMax = BUYER_PANEL.voices.map((v) => v.maxPriceDollars).sort((a, b) => a - b);
const refusedRefund = BUYER_PANEL.voices.filter((v) => v.wouldRefund).length;

export const PARAMS = {
  // ── What the eyes see: the public world ───────────────────────────────────
  'eyes.hitsPerQuery': {
    what: 'items a discussion search returns for one query', unit: 'items',
    dist: { kind: 'triangular', min: hits.min, mode: hits.median, max: hits.max },
    source: { kind: 'cassette', cite: `Hacker News answers recorded 2026-10-06: min ${String(hits.min)}, median ${String(hits.median)}, max ${String(hits.max)} over ${String(hits.n)} queries` },
  },
  'eyes.painShare': {
    what: 'share of returned discussion items in which somebody describes a chore a printable could serve', unit: 'share',
    dist: { kind: 'triangular', min: Math.max(0.02, pain.low), mode: Math.max(0.05, pain.median * 0.5), max: Math.max(0.1, pain.high * 0.6) },
    source: { kind: 'cassette', cite: `pain-phrased share of Hacker News items per query (p10 ${pain.low.toFixed(2)}, median ${pain.median.toFixed(2)}, p90 ${pain.high.toFixed(2)}, n=${String(pain.n)}); scaled DOWN by half to ~60% (assumption) because the eyes searched pain phrases, so a match on the phrase overstates a chore a file could serve` },
  },
  // ── Discovery: search impressions, visits, conversion ─────────────────────
  'market.indexLagDays': {
    what: 'days between a page being announced and search sending it anybody', unit: 'days',
    dist: { kind: 'triangular', min: 5, mode: 14, max: 35 },
    source: { kind: 'assumption', cite: 'a new domain with no links; from-nothing-to-a-sale used 7/14/21 as its bands, themselves assumptions' },
  },
  'market.impressionsPerDay': {
    what: 'search impressions a live listing gets per day at full demand for its theme', unit: 'impressions/day',
    dist: { kind: 'logUniform', min: 4, max: 120 },
    source: { kind: 'assumption', cite: 'no impression data exists; bounded so that visits sit under the calibration seller\'s ~15 views/day/product (56,069 views over ~10 products in a year), which had an audience Foundry lacks' },
  },
  'market.clickThrough': {
    what: 'share of impressions that become a visit for a listing as attractive as the average competitor', unit: 'share',
    dist: { kind: 'triangular', min: 0.01, mode: 0.03, max: 0.08 },
    source: { kind: 'assumption', cite: 'no click data for Foundry pages; a typical organic result range, named as a guess' },
  },
  'market.baseConversion': {
    what: 'visit-to-purchase rate for a sound product, priced within the visitor\'s willingness to pay', unit: 'share',
    dist: { kind: 'triangular', min: CALIBRATION.newSellerConversion.low, mode: CALIBRATION.newSellerConversion.high, max: CALIBRATION.viewToPurchase.high },
    source: { kind: 'calibration', cite: `the notes' new-seller band ${String(CALIBRATION.newSellerConversion.low)}-${String(CALIBRATION.newSellerConversion.high)} as the bulk, the audience seller's ${String(CALIBRATION.viewToPurchase.high)} as the optimistic tail` },
  },
  'market.wtpScale': {
    what: 'multiplier on the buyer panel\'s stated top prices (people say more than they pay, or less)', unit: 'x',
    dist: { kind: 'triangular', min: 0.6, mode: 0.85, max: 1.15 },
    source: { kind: 'buyer-panel', cite: `top prices stated by the five personas at a $${String(BUYER_PANEL.listingPriceDollars)} listing: ${panelMax.map((x) => `$${String(x)}`).join(', ')}; the scale around them is an assumption (stated intent usually exceeds behaviour)` },
  },
  'market.noReviewPenalty': {
    what: 'conversion multiplier for a listing with no reviews', unit: 'x',
    dist: { kind: 'triangular', min: 0.4, mode: 0.65, max: 0.9 },
    source: { kind: 'buyer-panel', cite: '"no reviews / unknown seller" was the first objection of 2 of 5 personas and named by 3; its size is an assumption' },
  },
  'market.seasonAmplitude': {
    what: 'peak-to-mean swing of demand across the year for a seasonal theme', unit: 'share',
    dist: { kind: 'uniform', min: 0, max: 0.5 },
    source: { kind: 'assumption', cite: 'organisers peak in January and September; no Foundry data' },
  },
  'market.competitorsPerTheme': {
    what: 'competing listings a buyer of one theme also sees', unit: 'listings',
    dist: { kind: 'triangular', min: 3, mode: 10, max: 30 },
    source: { kind: 'assumption', cite: 'marketplaces carry many near-identical printables; count not observed' },
  },
  'market.competitorPrice': {
    what: 'typical competitor price for a printable', unit: 'dollars',
    dist: { kind: 'triangular', min: 4, mode: 8, max: 15 },
    source: { kind: 'buyer-panel', cite: 'personas compared with "$4-8" Etsy printables (p2), a "$14.99" rated competitor (p1) and a $15 office-supply binder (p4)' },
  },
  'market.competitorQuality': {
    what: 'mean quality of competing listings on the twin\'s 0-1 scale', unit: 'score',
    dist: { kind: 'uniform', min: 0.45, max: 0.8 },
    source: { kind: 'assumption', cite: 'no measurement of competitor quality exists' },
  },
  // ── Every channel (F2, 9 October 2026) ────────────────────────────────────
  'channel.etsyReach': {
    what: 'impressions a listing gets in Etsy\'s own search, relative to the Workshop page\'s search impressions', unit: 'x',
    dist: { kind: 'logUniform', min: 1, max: 6 },
    source: { kind: 'assumption', cite: 'a marketplace brings buyers already searching for printables, which a new domain does not; no Etsy impression data for Foundry exists, and the calibration seller\'s ~15 views/day/product bounds the top' },
  },
  'channel.marketplaceLagDays': {
    what: 'days before a marketplace\'s own search shows a new listing', unit: 'days',
    dist: { kind: 'triangular', min: 1, mode: 3, max: 10 },
    source: { kind: 'assumption', cite: 'marketplace search indexes its own listings within days, not the weeks a new domain waits; not observed' },
  },
  'channel.gumroadReach': {
    what: 'impressions Gumroad\'s Discover gives a new seller\'s listing, relative to the Workshop page\'s search impressions', unit: 'x',
    dist: { kind: 'logUniform', min: 0.05, max: 0.6 },
    source: { kind: 'assumption', cite: 'Discover recommends products with a sales history (Gumroad charges 30% on a sale it brings, gumroad.com/pricing read 2026-10-09); a new seller has none; not observed' },
  },
  'channel.euBuyerShare': {
    what: 'share of the Workshop page\'s buyers who are in the EU or the UK, routed to a merchant of record', unit: 'share',
    dist: { kind: 'triangular', min: 0.03, mode: 0.12, max: 0.3 },
    source: { kind: 'assumption', cite: 'an English-language page found by search; no buyer country has been recorded (the Workshop carries no tracking)' },
  },
  // ── After a sale ──────────────────────────────────────────────────────────
  'outcome.refundRate': {
    what: 'share of buyers of a sound product who ask for their money back', unit: 'share',
    dist: { kind: 'triangular', min: 0, mode: 0.03, max: 0.1 },
    source: { kind: 'buyer-panel', cite: `${String(refusedRefund)} of ${String(BUYER_PANEL.voices.length)} personas said they would ask for a refund; the non-zero range is an assumption (five voices cannot show a rate)` },
  },
  'outcome.refundPerDefect': {
    what: 'extra refund probability per visible defect (wrong page count, over-claim, broken promise)', unit: 'share',
    dist: { kind: 'triangular', min: 0.03, mode: 0.08, max: 0.2 },
    source: { kind: 'buyer-panel', cite: 'mismatched page counts and seller notes on the listing made 2 of 5 personas "doubt the counting"; the size is an assumption' },
  },
  'outcome.reviewRate': {
    what: 'share of buyers who leave a review', unit: 'share',
    dist: { kind: 'triangular', min: 0.01, mode: 0.04, max: 0.1 },
    source: { kind: 'assumption', cite: 'not observed; the Workshop page shows no reviews today, so in the twin a review only changes later buyers\' trust' },
  },
  'outcome.repeatRate': {
    what: 'share of buyers who later buy another of the Workshop\'s files', unit: 'share',
    dist: { kind: 'triangular', min: 0, mode: 0.05, max: 0.15 },
    source: { kind: 'calibration', cite: 'bundles became the seller\'s best sellers (repeat and related purchase exists); the rate is an assumption' },
  },
  'outcome.womVisitsPerSale': {
    what: 'visits a sale brings later by word of mouth', unit: 'visits',
    dist: { kind: 'triangular', min: 0, mode: 0.3, max: 1.5 },
    source: { kind: 'buyer-panel', cite: `${String(BUYER_PANEL.voices.filter((v) => v.wouldRecommend).length)} of 5 personas would recommend it to someone; how many visits that brings is an assumption` },
  },
  'outcome.buyerEmailRate': {
    what: 'share of buyers who write to the Workshop (a question or a complaint)', unit: 'share',
    dist: { kind: 'triangular', min: 0.01, mode: 0.05, max: 0.15 },
    source: { kind: 'assumption', cite: 'not observed' },
  },
  // ── The owner's minutes (a documented model, not a measurement) ───────────
  'minutes.perNewItem': {
    what: 'owner minutes to read and decide one new needs-you item', unit: 'minutes',
    dist: { kind: 'triangular', min: 1.5, mode: 4, max: 10 },
    source: { kind: 'assumption', cite: 'every item answers six questions before asking for a yes (needs-you/queue.ts); reading them is a guess' },
  },
  'minutes.perWaitingItemPerDay': {
    what: 'owner minutes per day an unanswered item costs him by being seen again', unit: 'minutes',
    dist: { kind: 'triangular', min: 0, mode: 0.25, max: 1 },
    source: { kind: 'assumption', cite: 'a glance at a list he already read' },
  },
  'minutes.perBuyerMail': {
    what: 'owner minutes to answer one buyer email only he can answer', unit: 'minutes',
    dist: { kind: 'triangular', min: 2, mode: 5, max: 12 },
    source: { kind: 'assumption', cite: 'not observed' },
  },
  'minutes.weeklyRead': {
    what: 'owner minutes a week reading the Brief when nothing needs him', unit: 'minutes/week',
    dist: { kind: 'triangular', min: 2, mode: 5, max: 15 },
    source: { kind: 'assumption', cite: 'the institution\'s target is that he reads, not works; a guess at reading time' },
  },
} as const satisfies Record<string, Param>;

export type ParamName = keyof typeof PARAMS;
export type Drawn = Record<ParamName, number>;

/** One seed's world: each parameter drawn once from its distribution, or pinned by an override quantile. */
export function drawParams(seed: number, pinned: Partial<Record<ParamName, number>> = {}): Drawn {
  const out = {} as Drawn;
  for (const name of Object.keys(PARAMS) as ParamName[]) {
    const q = pinned[name] ?? new Rng('param', seed, name).next();
    out[name] = quantile(PARAMS[name].dist, q);
  }
  return out;
}

/** The value at the middle of every distribution: the twin's base case. */
export function medianParams(): Drawn {
  const out = {} as Drawn;
  for (const name of Object.keys(PARAMS) as ParamName[]) out[name] = quantile(PARAMS[name].dist, 0.5);
  return out;
}
