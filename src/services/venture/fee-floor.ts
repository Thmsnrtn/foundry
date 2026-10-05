// =============================================================================
// FOUNDRY — no price is mostly fees (Roadmap 2027 R29).
//
// A price the provider takes a fifth or more of, before anything else is
// counted, leaves too little to read a contribution from: the test would
// measure the card network, not what the thing is worth. So every price a
// test would charge is read against its venue's PUBLISHED rate card, and
// refused where the least a buyer could pay loses a fifth to the fee.
//
// THIS IS AN ESTIMATE AND IS CALLED ONE. The fee actually taken is read from
// the provider after a sale (stripe-economics.ts, the Etsy statement) and is
// the only fee the ledger records. The card here decides only what may be
// asked, and errs toward the higher published rate (US cards, standard plan;
// no international or currency-conversion surcharge is assumed away, and none
// is added).
// =============================================================================

export type FeeVenue = 'stripe' | 'etsy';

export const FEE_CARDS = {
  stripe: { name: 'Stripe', percentBp: 290, fixedCents: 30, perListingCents: 0, source: 'https://stripe.com/pricing', readOn: '2026-10-05' },
  // Etsy: $0.20 to list, 6.5% transaction fee, and Etsy Payments processing
  // of 3% + $0.25 in the US. Offsite Ads (15%) applies only to a sale an ad
  // brought and is not assumed.
  etsy: { name: 'Etsy', percentBp: 650 + 300, fixedCents: 25, perListingCents: 20, source: 'https://www.etsy.com/legal/fees/', readOn: '2026-10-05' },
} as const satisfies Record<FeeVenue, { name: string; percentBp: number; fixedCents: number; perListingCents: number; source: string; readOn: string }>;

/** The most of a price a provider's fee may take before the price is refused. */
export const MOST_A_FEE_MAY_TAKE = 0.2;

/** The published fee on one sale of `amountCents`, rounded up to the cent. Zero for nothing paid. */
export function estimatedFeeCents(venue: FeeVenue, amountCents: number): number {
  if (amountCents <= 0) return 0;
  const c = FEE_CARDS[venue];
  return Math.ceil((amountCents * c.percentBp) / 10_000) + c.fixedCents + c.perListingCents;
}

/** The least a buyer could pay: the floor of a chosen amount, else the price. */
export function lowestPayableCents(price: { amountCents: number; chosen?: { minimumCents: number } | null }): number {
  return price.chosen ? price.chosen.minimumCents : price.amountCents;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Why this price is refused, in a sentence, or null when the fee leaves enough. */
export function priceIsMostlyFees(p: { venue: FeeVenue; amountCents: number; chosen?: { minimumCents: number } | null }): string | null {
  const least = lowestPayableCents(p);
  if (least <= 0) return null;
  const fee = estimatedFeeCents(p.venue, least);
  if (fee < least * MOST_A_FEE_MAY_TAKE) return null;
  const which = p.chosen ? 'at the least a buyer could pay, ' : '';
  return `${which}${FEE_CARDS[p.venue].name}'s published fee would take about ${dollars(fee)} of ${dollars(least)}, a fifth or more, which leaves too little to learn what it is worth`;
}
