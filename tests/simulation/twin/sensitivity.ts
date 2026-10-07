// =============================================================================
// WHICH UNKNOWN MATTERS MOST — a one-at-a-time sweep over the twin.
//
// For each parameter, every seed's world is replayed with that parameter
// pinned at its 10th and then its 90th percentile, every other parameter left
// at the seed's own draw. The swing between the two, averaged over seeds, is
// how much that one unknown moves the result. Ranked, it says where a real
// measurement would buy the most certainty.
//
// OPEN LOOP, AND SAID SO. A replay holds the institution's own timeline fixed
// — which products were live on which days, and what reached the owner — and
// re-runs only the market and the minutes model over it. That is what makes
// a sweep of every parameter affordable; what it cannot show is the
// institution reacting to the market (a sale that changes the next design, a
// refund that holds a test). `confirmClosedLoop` re-runs the real institution
// for the top parameter so the two can be compared.
// =============================================================================
import { estimatedFeeCents } from '../../../src/services/venture/fee-floor.js';
import { Market } from './market.js';
import { PARAMS, drawParams, type ParamName } from './params.js';
import type { WorldResult } from './world-run.js';

export interface Replayed { netCents: number; sales: number; ownerMinutesPerWeek: number }

/** One world, replayed with some parameters pinned at quantiles. */
export function replay(base: WorldResult, pinned: Partial<Record<ParamName, number>>): Replayed {
  const p = drawParams(base.seed, pinned);
  const market = new Market(base.seed, p);
  let gross = 0; let fees = 0; let refunds = 0; let sales = 0;
  const priceOf = new Map(base.listings.map((l) => [l.key, l.priceCents]));
  for (let d = 1; d <= base.days; d++) {
    const live = base.listings.filter((l) => l.liveFrom <= d && d <= l.liveTo);
    const md = market.day(d, live);
    for (const e of md.events) {
      if (e.kind === 'purchase') { gross += e.listing.priceCents; fees += estimatedFeeCents('stripe', e.listing.priceCents); sales += 1; market.afterSale(d, e, live); }
      // The closed loop proves every requested refund is made (invariant refunds-honoured); the replay takes that as given.
      if (e.kind === 'refund-request') refunds += priceOf.get(e.listingKey) ?? 0;
    }
  }
  // THE MINUTES: what reached him in the real run, re-priced; buyer mail re-counted from the replayed market.
  const mailShare = base.market.mails > 0 ? (base.needsYouSeen.mail ?? 0) / base.market.mails : 1;
  let minutes = 0;
  for (const r of base.timeline) {
    const fresh = r.newItems.filter((k) => !k.startsWith('mail:')).length;
    minutes += p['minutes.weeklyRead'] / 7 + fresh * p['minutes.perNewItem'] + Math.max(0, r.needsYou - r.newItems.length) * p['minutes.perWaitingItemPerDay'];
  }
  minutes += market.totals.mails * Math.min(1, mailShare) * p['minutes.perBuyerMail'];
  return { netCents: gross - fees - refunds, sales, ownerMinutesPerWeek: minutes / (base.days / 7) };
}

export interface Sensitivity {
  param: ParamName; source: string; lowValue: number; highValue: number;
  /** Mean over seeds of (metric at p90 − metric at p10). */
  netSwingCents: number; minutesSwing: number;
}

export function oneAtATime(worlds: WorldResult[]): Sensitivity[] {
  const out: Sensitivity[] = [];
  for (const param of Object.keys(PARAMS) as ParamName[]) {
    let net = 0; let minutes = 0;
    for (const w of worlds) {
      const lo = replay(w, { [param]: 0.1 }); const hi = replay(w, { [param]: 0.9 });
      net += hi.netCents - lo.netCents; minutes += hi.ownerMinutesPerWeek - lo.ownerMinutesPerWeek;
    }
    const n = Math.max(1, worlds.length);
    const lowValue = drawParams(0, { [param]: 0.1 })[param]; const highValue = drawParams(0, { [param]: 0.9 })[param];
    out.push({ param, source: PARAMS[param].source.kind, lowValue, highValue, netSwingCents: net / n, minutesSwing: minutes / n });
  }
  return out;
}

/** The parameters ranked by how much they move one metric, largest first. */
export const rankBy = (s: Sensitivity[], metric: 'netSwingCents' | 'minutesSwing'): Sensitivity[] =>
  [...s].sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric]) || a.param.localeCompare(b.param));
