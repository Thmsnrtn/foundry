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
  if (hidden.length === 0) return null;

  const shop = (await query(
    `SELECT provider_account_label FROM company_senses
      WHERE product_id = ? AND provider = ? AND provider_account_label IS NOT NULL
      ORDER BY rowid DESC LIMIT 1`, [productId, provider])).rows[0] as Record<string, unknown> | undefined;
  const shopName = shop ? String(shop.provider_account_label) : 'the shop';
  const dates = [...new Set(hidden.map((r) => String(r.said_at).slice(0, 10)))].join(', ');
  return `buyers could not find ${shopName} in ${plan.listing.venueName} search for at least part `
    + `of this window — you said so on ${dates}`;
}
