// =============================================================================
// FOUNDRY — Etsy, behind the storefront interface (F2).
//
// TWO HALVES, AND ONLY ONE MAY ACT.
//
// READING is already built and running: Foundry's Etsy sense (senses/readers/
// etsy-shop.ts) reads receipts and the fee Etsy kept into the economic ledger,
// through the `transactions_r` scope he granted (PENDING 25). The storefront
// reads Etsy's sales FROM THAT LEDGER, so nothing is read twice or counted
// twice.
//
// LISTING is shaped here and cannot act. Etsy's OpenAPI (3.0.0, read 9 October
// 2026 at https://www.etsy.com/openapi/generated/oas/3.0.0.json):
//   createDraftListing  POST  /v3/application/shops/{shop_id}/listings
//     form fields, required: quantity, title, description, price, who_made,
//     when_made, taxonomy_id; type ∈ physical|download|both. oauth2 listings_w.
//   uploadListingFile   POST  …/listings/{listing_id}/files  (multipart: file, name, rank)
//   updateListing       PATCH …/listings/{listing_id}  state ∈ active|inactive
// There is no AI-disclosure field; the disclosure is in the description.
// `who_made` and `taxonomy_id` are his answers (his grant carries them): Foundry
// does not decide what Etsy's creativity standards require of an AI-written
// file, and does not guess Etsy's category tree.
//
// SENSES ARE NOT HANDS: the three capabilities (draft, file, activate) are
// declared with no tool (migration 339) and the constitution's scope table
// holds no listings_w. This file builds the requests a hand would send, so the
// day he grants the write scope the code is judged against the spec rather
// than written in a hurry; `channelOpen` refuses before anything is sent.
// =============================================================================
import type { CanonicalListing } from './canonical.js';
import type { ChannelGrant } from './channels.js';
import type { ChannelSale } from './reconcile.js';
import { query } from '../../../db/client.js';

export const ETSY_API = 'https://openapi.etsy.com/v3/application';
export const WHEN_MADE = '2020_2026';

/** The createDraftListing form, from the spec's required fields. Refuses without his who_made and taxonomy. */
export function draftListingForm(l: Pick<CanonicalListing, 'title' | 'description' | 'priceCents'>, grant: ChannelGrant): URLSearchParams | { refused: string } {
  if (!grant.whoMade) return { refused: 'Etsy requires "who made it", and that answer for an AI-written file is yours to give' };
  if (!grant.taxonomyId) return { refused: 'Etsy requires a category (taxonomy_id), and which one is yours to choose' };
  return new URLSearchParams({
    quantity: '999', title: l.title.slice(0, 140), description: l.description,
    price: (l.priceCents / 100).toFixed(2), who_made: grant.whoMade, when_made: WHEN_MADE,
    taxonomy_id: String(grant.taxonomyId), type: 'download', is_supply: 'false',
  });
}

/** Etsy's sales as the storefront sees them: read from the ledger the Etsy sense already writes. */
export async function etsySalesFromLedger(founderId: string, since: Date): Promise<Array<ChannelSale & { experimentId: string }>> {
  const rows = (await query(
    `SELECT e.kind, e.provider_ref, e.amount_cents, e.currency, e.occurred_at, f.experiment_id,
            (SELECT g.amount_cents FROM economic_events g WHERE g.fulfilment_id = e.fulfilment_id AND g.kind = 'provider_fee' AND g.evidence_mode = e.evidence_mode LIMIT 1) AS fee
       FROM economic_events e JOIN experiment_fulfilments f ON f.id = e.fulfilment_id
      WHERE e.founder_id = ? AND e.provider = 'etsy' AND e.kind IN ('charge','refund') AND datetime(e.occurred_at) >= datetime(?)`,
    [founderId, since.toISOString()])).rows as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    channel: 'etsy' as const, kind: String(r.kind) === 'charge' ? 'sale' as const : 'refund' as const,
    providerRef: String(r.provider_ref), productRef: '', grossCents: Number(r.amount_cents),
    feeCents: String(r.kind) === 'charge' && r.fee != null ? Number(r.fee) : null, taxCents: 0,
    currency: String(r.currency), occurredAt: String(r.occurred_at), experimentId: String(r.experiment_id),
  }));
}
