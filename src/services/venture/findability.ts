// =============================================================================
// FOUNDRY — whether buyers can find the shop, as the owner said it
//
// Etsy can hide a whole shop from its own search — Developer Mode, which the
// owner found on ApexMicro on 25 September 2026, or vacation — and nothing
// Foundry reads says so. The connection answers which shop, what is listed and
// what was paid. It has never answered whether a buyer could find any of it.
//
// A listing test in a hidden shop closes its window with nobody buying, and
// that silence is about the shop rather than the market. So the fact is asked
// of the one person who can see it, and read in two places:
//
//   `qualificationOf`        — no listing test is ready until he has said
//                              buyers can find the shop, and it stops being
//                              ready when he says they cannot.
//   `invalidateByObservation` — a silent window that overlaps anything he said
//                              was hidden did not measure, and is not a verdict.
//
// AND WHAT ETSY SAYS, WHERE IT SAYS ANYTHING. Etsy tells an app one visibility
// fact: whether the shop is on vacation. That is read on every venue read and
// kept here as Etsy's (`venue_visibility_readings`, migration 354). A vacation
// Etsy reports refuses readiness and voids an overlapping window whatever he
// last said. Developer Mode is not reported to apps, so his word stays the
// only witness of it, and a reading of "open" never overrides his "hidden".
//
// WHAT THIS IS NOT. It is his statement, recorded as his, and it is only ever
// used to REFUSE a conclusion — never to reach one. "Findable" does not make a
// silence meaningful on its own say-so: it removes one reason a silence could
// be empty, and every other instrument still has to agree.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export interface Findability {
  findable: boolean;
  /** When he said it, `YYYY-MM-DD HH:MM:SS`, UTC. */
  saidAt: string;
  /**
   * Whether whoever said it owns the company NOW. A statement is its author's,
   * and a company that has changed hands has not heard from its new owner —
   * the same rule the shop's recognition follows with `identity_confirmed_by`.
   */
  byTheOwner: boolean;
}

/**
 * HE SAYS WHETHER BUYERS CAN FIND THE SHOP. Only the company's owner, only as
 * himself: `saidBy` must be `founder:<id>` and that founder must own the
 * product. A caller cannot declare a shop findable on anybody's behalf.
 */
export async function sayWhetherFindable(input: {
  productId: string; provider: string; findable: boolean; saidBy: string;
}): Promise<{ id: string } | { refused: string }> {
  const m = /^founder:(.+)$/.exec(input.saidBy);
  if (!m) return { refused: 'only the owner can say whether buyers can find the shop' };
  const founderId = m[1];
  const owned = (await query(
    `SELECT owner_id FROM products WHERE id = ? AND deleted_at IS NULL`, [input.productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!owned) return { refused: 'there is no such company' };
  if (String(owned.owner_id) !== founderId) {
    return { refused: 'only the owner of this company can say whether buyers can find its shop' };
  }
  const id = nanoid();
  await query(
    `INSERT INTO venue_findability (id, founder_id, product_id, provider, findable, said_by)
     VALUES (?,?,?,?,?,?)`,
    [id, founderId, input.productId, input.provider.toLowerCase(), input.findable ? 1 : 0, input.saidBy]);
  return { id };
}

export interface VenueVisibility {
  onVacation: boolean;
  /** When the venue was read saying so, `YYYY-MM-DD HH:MM:SS`, UTC. */
  observedAt: string;
}

/**
 * KEEP WHAT THE VENUE SAID ABOUT VACATION, AS THE VENUE'S. Only a change is a
 * new row: the same state read again is not a new fact.
 */
export async function noteVenueVisibility(productId: string, provider: string, onVacation: boolean): Promise<void> {
  const p = provider.toLowerCase();
  const last = await venueSaysOnVacation(productId, p);
  if (last && last.onVacation === onVacation) return;
  await query(
    `INSERT INTO venue_visibility_readings (id, product_id, provider, on_vacation) VALUES (?,?,?,?)`,
    [nanoid(), productId, p, onVacation ? 1 : 0]);
}

/** What the venue last said about vacation, or null when it has never said. */
export async function venueSaysOnVacation(productId: string, provider: string): Promise<VenueVisibility | null> {
  const r = (await query(
    `SELECT on_vacation, observed_at FROM venue_visibility_readings
      WHERE product_id = ? AND provider = ?
      ORDER BY datetime(observed_at) DESC, rowid DESC LIMIT 1`,
    [productId, provider.toLowerCase()])).rows[0] as Record<string, unknown> | undefined;
  return r ? { onVacation: Number(r.on_vacation) === 1, observedAt: String(r.observed_at) } : null;
}

/** What he said most recently, or null when he has never been asked. */
export async function findabilityOf(productId: string, provider: string): Promise<Findability | null> {
  const r = (await query(
    `SELECT f.findable, f.said_at, f.said_by, 'founder:' || p.owner_id AS the_owner
       FROM venue_findability f JOIN products p ON p.id = f.product_id
      WHERE f.product_id = ? AND f.provider = ?
      ORDER BY datetime(f.said_at) DESC, f.rowid DESC LIMIT 1`,
    [productId, provider.toLowerCase()])).rows[0] as Record<string, unknown> | undefined;
  return r ? { findable: Number(r.findable) === 1, saidAt: String(r.said_at),
    byTheOwner: String(r.said_by) === String(r.the_owner) } : null;
}

/**
 * WAS THE SHOP HIDDEN AT ANY POINT IN THIS WINDOW, BY HIS OWN ACCOUNT?
 *
 * Read from what he said: the statement in force when the window opened, and
 * every statement made while it was open. Any of those saying "hidden" makes
 * the window's silence about the shop. Nothing said at all is NOT hidden — an
 * absence of record is not a record of failure, the same rule the instrument
 * applies to a day nobody watched — which is why readiness asks before a test
 * starts rather than this guessing after it ends.
 *
 * Returns the sentence to give him, or null.
 */
export async function shopHiddenDuring(experimentId: string, from: Date, to: Date): Promise<string | null> {
  const { offerShapePlanOf } = await import('./hand.js');
  const plan = await offerShapePlanOf(experimentId);
  if (!plan?.listing) return null;
  const product = (await query(
    `SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!product) return null;
  const productId = String(product.id);
  const provider = plan.listing.venue.toLowerCase();

  const inForce = (await query(
    `SELECT findable, said_at FROM venue_findability
      WHERE product_id = ? AND provider = ? AND datetime(said_at) <= datetime(?)
      ORDER BY datetime(said_at) DESC, rowid DESC LIMIT 1`,
    [productId, provider, from.toISOString()])).rows as unknown as Array<Record<string, unknown>>;
  const during = (await query(
    `SELECT findable, said_at FROM venue_findability
      WHERE product_id = ? AND provider = ?
        AND datetime(said_at) > datetime(?) AND datetime(said_at) <= datetime(?)
      ORDER BY datetime(said_at), rowid`,
    [productId, provider, from.toISOString(), to.toISOString()])).rows as unknown as Array<Record<string, unknown>>;
  const hidden = [...inForce, ...during].filter((r) => Number(r.findable) === 0);

  // What the venue itself reported over the same window, read the same way.
  const vacationInForce = (await query(
    `SELECT on_vacation, observed_at FROM venue_visibility_readings
      WHERE product_id = ? AND provider = ? AND datetime(observed_at) <= datetime(?)
      ORDER BY datetime(observed_at) DESC, rowid DESC LIMIT 1`,
    [productId, provider, from.toISOString()])).rows as unknown as Array<Record<string, unknown>>;
  const vacationDuring = (await query(
    `SELECT on_vacation, observed_at FROM venue_visibility_readings
      WHERE product_id = ? AND provider = ?
        AND datetime(observed_at) > datetime(?) AND datetime(observed_at) <= datetime(?)
      ORDER BY datetime(observed_at), rowid`,
    [productId, provider, from.toISOString(), to.toISOString()])).rows as unknown as Array<Record<string, unknown>>;
  const away = [...vacationInForce, ...vacationDuring].filter((r) => Number(r.on_vacation) === 1);

  // AND WHETHER WHAT THE VENUE SHOWED WAS THE OFFER THAT WAS SEALED. A listing
  // at another price, or gone from the shop's active listings, for any part of
  // the window: the sealed offer was not what buyers could see.
  const { exposureOf } = await import('./outcome.js');
  const exposure = await exposureOf(experimentId);
  const listingId = exposure ? /\/listing\/(\d+)/.exec(exposure.exposureRef)?.[1] ?? null : null;
  let offered: string | null = null;
  if (listingId) {
    const shownInForce = (await query(
      `SELECT seen, price_cents, currency, observed_at FROM venue_listing_readings
        WHERE product_id = ? AND provider = ? AND listing_id = ? AND datetime(observed_at) <= datetime(?)
        ORDER BY datetime(observed_at) DESC, rowid DESC LIMIT 1`,
      [productId, provider, listingId, from.toISOString()])).rows as unknown as Array<Record<string, unknown>>;
    const shownDuring = (await query(
      `SELECT seen, price_cents, currency, observed_at FROM venue_listing_readings
        WHERE product_id = ? AND provider = ? AND listing_id = ?
          AND datetime(observed_at) > datetime(?) AND datetime(observed_at) <= datetime(?)
        ORDER BY datetime(observed_at), rowid`,
      [productId, provider, listingId, from.toISOString(), to.toISOString()])).rows as unknown as Array<Record<string, unknown>>;
    const sealedCents = plan.price.amountCents;
    const sealedCurrency = plan.price.currency.toLowerCase();
    const other = [...shownInForce, ...shownDuring].filter((r) => Number(r.seen) === 0
      || Number(r.price_cents) !== sealedCents || String(r.currency ?? '') !== sealedCurrency);
    if (other.length > 0) {
      const money = (c: number) => `$${(c / 100).toFixed(2)}`;
      const what = [...new Set(other.map((r) => Number(r.seen) === 0 ? 'not among the shop\'s active listings'
        : r.price_cents == null ? 'at no readable price' : `at ${money(Number(r.price_cents))}`))].join(', then ');
      const dates = [...new Set(other.map((r) => String(r.observed_at).slice(0, 10)))].join(', ');
      offered = `${plan.listing.venueName} showed listing ${listingId} ${what} for at least part of this window `
        + `(read on ${dates}), not the offer sealed at ${money(sealedCents)}`;
    }
  }
  if (hidden.length === 0 && away.length === 0 && offered === null) return null;

  const shop = (await query(
    `SELECT provider_account_label FROM company_senses
      WHERE product_id = ? AND provider = ? AND provider_account_label IS NOT NULL
      ORDER BY rowid DESC LIMIT 1`, [productId, provider])).rows[0] as Record<string, unknown> | undefined;
  const shopName = shop ? String(shop.provider_account_label) : 'the shop';
  const parts: string[] = [];
  if (away.length > 0) {
    const dates = [...new Set(away.map((r) => String(r.observed_at).slice(0, 10)))].join(', ');
    parts.push(`${plan.listing.venueName} reported ${shopName} on vacation for at least part of this window `
      + `— read on ${dates} — so nobody could have bought`);
  }
  if (offered !== null) parts.push(offered);
  if (hidden.length === 0) return parts.join('; ');
  const dates = [...new Set(hidden.map((r) => String(r.said_at).slice(0, 10)))].join(', ');
  return [...parts, `buyers could not find ${shopName} in ${plan.listing.venueName} search for at least part `
    + `of this window — you said so on ${dates}`].join('; ');
}

// ─── What the venue shows for a test's listing ──────────────────────────────
//
// A listing test seals a prediction about one offer at one price. The owner
// places the listing by hand, so what the venue actually shows is read on each
// pass and kept as a change log (`venue_listing_readings`, migration 356).

export interface ListingFile { filename: string; sizeBytes: number | null }

export interface ListingAsShown {
  seen: boolean; priceCents: number | null; currency: string | null;
  /** The files as last read on this row; null when they were not read on that pass. */
  files: ListingFile[] | null;
  /** When the venue was read showing it so, `YYYY-MM-DD HH:MM:SS`, UTC. */
  observedAt: string;
}

/** Keep what the venue showed for a listing. Only a change is a new row. */
export async function noteListingAsShown(input: {
  productId: string; provider: string; listingId: string;
  seen: boolean; priceCents: number | null; currency: string | null;
  /** Null when the files were not read on this pass: then they are not compared, and not written. */
  files?: ListingFile[] | null;
}): Promise<void> {
  const p = input.provider.toLowerCase();
  const price = input.seen ? input.priceCents : null;
  const currency = input.seen && input.currency ? input.currency.toLowerCase() : null;
  const files = input.seen && input.files ? JSON.stringify(input.files) : null;
  const last = await listingAsShown(input.productId, p, input.listingId);
  const lastFiles = await filesAsShown(input.productId, p, input.listingId);
  const filesChanged = files !== null && (lastFiles === null || JSON.stringify(lastFiles.files) !== files);
  if (last && last.seen === input.seen && last.priceCents === price && last.currency === currency && !filesChanged) return;
  await query(
    `INSERT INTO venue_listing_readings (id, product_id, provider, listing_id, seen, price_cents, currency, files_json)
     VALUES (?,?,?,?,?,?,?,?)`,
    [nanoid(), input.productId, p, input.listingId, input.seen ? 1 : 0, price, currency, files]);
}

/** The files as last READ on a listing, whichever pass read them; null when they never were. */
export async function filesAsShown(productId: string, provider: string, listingId: string): Promise<{ files: ListingFile[]; observedAt: string } | null> {
  const r = (await query(
    `SELECT files_json, observed_at FROM venue_listing_readings
      WHERE product_id = ? AND provider = ? AND listing_id = ? AND files_json IS NOT NULL
      ORDER BY datetime(observed_at) DESC, rowid DESC LIMIT 1`,
    [productId, provider.toLowerCase(), listingId])).rows[0] as Record<string, unknown> | undefined;
  return r ? { files: JSON.parse(String(r.files_json)) as ListingFile[], observedAt: String(r.observed_at) } : null;
}

/**
 * THE FILE FOUNDRY BUILT FOR THIS TEST, as its own deliverable says:
 * `File: NAME (N bytes, …)`. That line is written by the institution when the
 * deliverable is recorded, never by a model or a buyer. Null when it says none.
 */
export async function sealedFileOf(experimentId: string): Promise<{ filename: string; bytes: number } | null> {
  const { materialOf } = await import('./hand.js');
  const d = await materialOf(experimentId, 'deliverable');
  const m = d ? /File: (\S+) \((\d+) bytes/.exec(d.body) : null;
  return m ? { filename: m[1], bytes: Number(m[2]) } : null;
}

/** What the venue last showed for a listing, or null when it has never been read. */
export async function listingAsShown(productId: string, provider: string, listingId: string): Promise<ListingAsShown | null> {
  const r = (await query(
    `SELECT seen, price_cents, currency, files_json, observed_at FROM venue_listing_readings
      WHERE product_id = ? AND provider = ? AND listing_id = ?
      ORDER BY datetime(observed_at) DESC, rowid DESC LIMIT 1`,
    [productId, provider.toLowerCase(), listingId])).rows[0] as Record<string, unknown> | undefined;
  return r ? { seen: Number(r.seen) === 1, priceCents: r.price_cents == null ? null : Number(r.price_cents),
    currency: r.currency == null ? null : String(r.currency),
    files: r.files_json == null ? null : JSON.parse(String(r.files_json)) as ListingFile[],
    observedAt: String(r.observed_at) } : null;
}

