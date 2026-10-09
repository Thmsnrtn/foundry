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

export type FeeVenue = 'stripe' | 'etsy' | 'gumroad' | 'lemonsqueezy';

/** A surcharge a published schedule names that may or may not apply to one sale. */
export interface MaybeFee { percentBp: number; fixedCents: number; when: string }

export interface FeeCard {
  name: string; percentBp: number; fixedCents: number; perListingCents: number;
  /** Surcharges the schedule names that depend on the buyer or on what the schedule leaves unsaid: the range's top. */
  maybe: readonly MaybeFee[];
  /** True when the channel is the merchant of record: it collects and pays sales tax and VAT itself. */
  merchantOfRecord: boolean;
  source: string; readOn: string;
}

export const FEE_CARDS = {
  stripe: { name: 'Stripe', percentBp: 290, fixedCents: 30, perListingCents: 0, maybe: [], merchantOfRecord: false,
    source: 'https://stripe.com/pricing', readOn: '2026-10-05' },
  // Etsy: $0.20 to list, 6.5% transaction fee, and Etsy Payments processing
  // of 3% + $0.25 in the US. Offsite Ads (15%) applies only to a sale an ad
  // brought and is not assumed.
  etsy: { name: 'Etsy', percentBp: 650 + 300, fixedCents: 25, perListingCents: 20, maybe: [], merchantOfRecord: false,
    source: 'https://www.etsy.com/legal/fees/', readOn: '2026-10-05' },
  // Gumroad (F2): its pricing page, read 9 October 2026, says 10% + 50¢ on a
  // sale through the profile or a direct link (30% on a sale Discover brought,
  // processing included), and that Gumroad handles sales tax and VAT as
  // merchant of record from 1 January 2025. Whether card processing of
  // 2.9% + 30¢ is ALSO taken on a direct sale is said by secondary sources and
  // not by that page, so it is a surcharge that may apply: the range's top.
  gumroad: { name: 'Gumroad', percentBp: 1000, fixedCents: 50, perListingCents: 0, merchantOfRecord: true,
    maybe: [{ percentBp: 290, fixedCents: 30, when: 'if card processing is taken on top of the 10% + 50¢ (Gumroad\'s pricing page does not say)' }],
    source: 'https://gumroad.com/pricing', readOn: '2026-10-09' },
  // Lemon Squeezy (F2): its fees page, read 9 October 2026: 5% + 50¢ on the
  // order, +1.5% for a buyer outside the US, +1.5% for PayPal (+0.5% on a
  // subscription payment, which a one-time file is not). Merchant of record.
  lemonsqueezy: { name: 'Lemon Squeezy', percentBp: 500, fixedCents: 50, perListingCents: 0, merchantOfRecord: true,
    maybe: [{ percentBp: 150, fixedCents: 0, when: 'for a buyer outside the US' }, { percentBp: 150, fixedCents: 0, when: 'for a PayPal payment' }],
    source: 'https://docs.lemonsqueezy.com/help/getting-started/fees', readOn: '2026-10-09' },
} as const satisfies Record<FeeVenue, FeeCard>;

/**
 * STRIPE TAX on the Workshop's own page (F2): 0.5% a transaction for payment
 * links and Checkout, charged only where Foundry is registered to collect.
 */
export const STRIPE_TAX = { percentBp: 50, source: 'https://stripe.com/tax/pricing', readOn: '2026-10-09' } as const;

/** The most of a price a provider's fee may take before the price is refused. */
export const MOST_A_FEE_MAY_TAKE = 0.2;

/**
 * The published fee on one sale of `amountCents`, rounded up to the cent, at
 * the TOP of its range (every surcharge the schedule names that might apply).
 * Zero for nothing paid. What may be asked is decided on the higher figure.
 */
export function estimatedFeeCents(venue: FeeVenue, amountCents: number): number {
  return feeRangeCents(venue, amountCents).high;
}

/** The published fee on one sale: the base schedule (low) and with every named surcharge (high). */
export function feeRangeCents(venue: FeeVenue, amountCents: number): { low: number; high: number } {
  if (amountCents <= 0) return { low: 0, high: 0 };
  const c: FeeCard = FEE_CARDS[venue];
  const low = Math.ceil((amountCents * c.percentBp) / 10_000) + c.fixedCents + c.perListingCents;
  const extraBp = c.maybe.reduce((n, m) => n + m.percentBp, 0);
  const extraFixed = c.maybe.reduce((n, m) => n + m.fixedCents, 0);
  const high = Math.ceil((amountCents * (c.percentBp + extraBp)) / 10_000) + c.fixedCents + extraFixed + c.perListingCents;
  return { low, high };
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
