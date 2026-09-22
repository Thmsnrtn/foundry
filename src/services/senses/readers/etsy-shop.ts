// =============================================================================
// FOUNDRY — reading the shop this institution sells through
//
// The owner asked for "the first genuinely qualified external operating
// capability", proved by "the smallest legitimate, controlled real-account
// qualification sequence", and said in the same breath: do not publish the
// workbook or incur listing fees merely to establish that the integration
// works. Reading is the whole of what can honestly be proven without
// publishing — and it is the half that decides whether the experiment means
// anything, because a venue nobody can read is a venue whose silence is not
// evidence.
//
// WHAT THIS CANNOT DO, STRUCTURALLY. The credential it acts through was issued
// against `shops_r`, `listings_r` and `transactions_r`, a set closed by
// constitutional triggers. There is no `listings_w` in this file, in the
// adapter, or in the scope table, so nothing here can create, change, publish
// or withdraw a listing whatever it is asked to do.
//
// NO OUTBOUND DOOR, AND THAT IS DELIBERATE. `capability_providers.tool` is the
// name at that door and means "reaches the world on its own"; a read causes no
// external effect, so it goes through `safeFetch` like every other eye in this
// institution and is classified `read_only`. Its audit is the retrieval below.
//
// WHAT ETSY WILL NOT TELL ANYBODY. There is no shop-statistics endpoint: no
// daily views, visits, favourites, impressions or search queries. Etsy
// withdrew that deliberately, having found the data used to infer its own
// financials ahead of its announcements. Only a listing's LIFETIME views and
// favourite count are readable, with receipts. That limit is not worked around
// here; it is written into the retrieval's `cannot_see`, so every observation
// drawn from this read carries the shape of the instrument that took it.
// =============================================================================

import { safeFetch } from '../../outbound/ssrf.js';
import { query } from '../../../db/client.js';
import { connectedSenses } from '../index.js';
import { withSenseSecret } from '../credentials.js';
import { recordRetrieval } from '../../venture/sources/index.js';

const API = 'https://openapi.etsy.com/v3/application';

/** Who is asking. Etsy's terms ask for this, and it is the honest thing to send. */
const USER_AGENT = 'FoundryResearch/1.0 (+https://apexmicro.ai; research@apexmicro.ai)';

export interface ShopOrder {
  orderRef: string; paidAt: string; grossCents: number; feeCents: number | null; currency: string;
}

export interface ShopListing {
  listingId: string; title: string; state: string;
  /** Etsy reports this as a LIFETIME total, never as a daily figure. */
  lifetimeViews: number | null;
  favourites: number | null;
  url: string | null;
}

export interface ShopReading {
  shop: { shopId: string; shopName: string | null; url: string | null };
  listings: ShopListing[];
  orders: ShopOrder[];
  /** The retrieval this reading was judged out of, with its declared limits. */
  retrievalId: string;
}

export type ReadFailure = { failed: true; ownerWords: string };

/** What Etsy can be asked, said once so the retrieval and the owner agree. */
export const CAN_SEE =
  'which shop this credential opens, by id and name; the listings in it, with each one’s '
  + 'lifetime view and favourite counts; and the receipts — order number, date and amount';

export const CANNOT_SEE =
  'daily views, visits, favourites, impressions, search queries or traffic sources: Etsy exposes '
  + 'no shop-statistics endpoint at all, deliberately, so an absence of those numbers here is an '
  + 'absence of an instrument and never evidence about the shop. Nor what a buyer wrote in Etsy '
  + 'Messages, so a refund being asked for cannot be seen from here';

/** Etsy states money as an amount over a divisor. Cents, so nothing rounds twice. */
function cents(money: unknown): { amount: number; currency: string } | null {
  if (money === null || typeof money !== 'object') return null;
  const m = money as Record<string, unknown>;
  const amount = Number(m.amount);
  const divisor = Number(m.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor === 0) return null;
  return {
    amount: Math.round((amount / divisor) * 100),
    currency: typeof m.currency_code === 'string' ? m.currency_code.toLowerCase() : 'usd',
  };
}

async function get(url: string, accessToken: string, apiKey: string): Promise<Record<string, unknown>> {
  const res = await safeFetch(url, {
    headers: {
      'x-api-key': apiKey, Authorization: `Bearer ${accessToken}`,
      accept: 'application/json', 'user-agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Etsy answered ${String(res.status)}`);
  return await res.json() as Record<string, unknown>;
}

const list = (body: Record<string, unknown>): Array<Record<string, unknown>> =>
  Array.isArray(body.results) ? body.results as Array<Record<string, unknown>> : [];

/**
 * READ THE SHOP, ONCE, AND RECORD WHAT THE INSTRUMENT COULD AND COULD NOT SEE.
 *
 * Every failure is an answer the owner can act on rather than an empty result:
 * a sense nobody connected, a grant that turned out narrower than the one
 * asked for, a deployment with no app registered, or Etsy refusing. None of
 * them is reported as "no orders", because an unread venue reporting nothing
 * and a read venue reporting nothing are different facts and this institution
 * has a rule about confusing them.
 */
export async function readTheShop(input: {
  founderId: string; productId: string;
}): Promise<ShopReading | ReadFailure> {
  const sense = (await connectedSenses(input.productId)).find((s) => s.provider === 'etsy');
  if (!sense) {
    return { failed: true, ownerWords: 'no Etsy account is connected, so there is nothing to read' };
  }
  const apiKey = (process.env.ETSY_API_KEY ?? '').trim();
  if (!apiKey) {
    return { failed: true, ownerWords: 'this deployment has no Etsy app registered, so it cannot ask Etsy anything' };
  }

  // THE GRANT IS CHECKED BEFORE IT IS USED, because a credential issued against
  // fewer scopes than were asked for fails at the third request rather than the
  // first, and by then the reading is half-taken and looks like a shop with no
  // orders.
  const granted = (await query(
    `SELECT granted_scopes_json FROM sense_credentials
      WHERE company_sense_id = ? AND revoked_at IS NULL`, [sense.id]))
    .rows[0] as Record<string, unknown> | undefined;
  const scopes: string[] = granted
    ? (JSON.parse(String(granted.granted_scopes_json)) as string[]) : [];
  const missing = ['shops_r', 'listings_r', 'transactions_r'].filter((s) => !scopes.includes(s));
  if (missing.length) {
    return {
      failed: true,
      ownerWords: `the Etsy connection was granted ${missing.join(' and ')} — without `
        + 'it I can only read part of the shop, and a part-read would look like a shop with less in it',
    };
  }

  const read = await withSenseSecret(sense.id, async (secret) => {
    const token = secret.access_token;
    if (typeof token !== 'string' || !token) return null;

    const me = await get(`${API}/users/me`, token, apiKey);
    const shopId = me.shop_id == null ? null : String(me.shop_id);
    if (!shopId) return { noShop: true as const };
    const shop = await get(`${API}/shops/${encodeURIComponent(shopId)}`, token, apiKey);

    const listings = list(await get(
      `${API}/shops/${encodeURIComponent(shopId)}/listings?limit=100`, token, apiKey))
      .map((l): ShopListing => ({
        listingId: String(l.listing_id ?? ''),
        title: typeof l.title === 'string' ? l.title : '',
        state: typeof l.state === 'string' ? l.state : 'unknown',
        lifetimeViews: Number.isFinite(Number(l.views)) ? Number(l.views) : null,
        favourites: Number.isFinite(Number(l.num_favorers)) ? Number(l.num_favorers) : null,
        url: typeof l.url === 'string' ? l.url : null,
      }));

    const orders = list(await get(
      `${API}/shops/${encodeURIComponent(shopId)}/receipts?limit=100`, token, apiKey))
      .map((r): ShopOrder | null => {
        const gross = cents(r.grandtotal ?? r.total_price);
        if (!gross || gross.amount <= 0) return null;
        const at = Number(r.created_timestamp);
        return {
          orderRef: String(r.receipt_id ?? ''),
          paidAt: new Date((Number.isFinite(at) ? at : 0) * 1000).toISOString(),
          grossCents: gross.amount,
          // ETSY'S RECEIPT DOES NOT STATE THE FEE. It is on the payment record,
          // behind a scope this connection does not hold, so it is null rather
          // than guessed — `recordVenueOrder` already accepts "not yet on the
          // statement" and a fee invented here would be a cost nobody paid.
          feeCents: null,
          currency: gross.currency,
        };
      })
      .filter((o): o is ShopOrder => o !== null && o.orderRef !== '');

    return {
      shop: {
        shopId,
        shopName: typeof shop.shop_name === 'string' ? shop.shop_name : null,
        url: typeof shop.url === 'string' ? shop.url : null,
      },
      listings, orders,
    };
  });

  if (read === null) {
    return { failed: true, ownerWords: 'the Etsy connection has no usable credential' };
  }
  if ('noShop' in read) {
    return { failed: true, ownerWords: 'that Etsy account answers, and has no shop on it' };
  }

  const retrievalId = await recordRetrieval({
    founderId: input.founderId, sourceType: 'marketplace',
    source: `etsy:shop:${read.shop.shopId}`,
    terms: `the shop this credential opens, its listings and its receipts`,
    returnedCount: read.listings.length + read.orders.length,
    canSee: CAN_SEE, cannotSee: CANNOT_SEE,
    notAlsoTried: null,
    wouldMostHelp: read.orders.length === 0
      ? 'whether anybody is seeing the listing at all — which Etsy will not report to anyone, '
        + 'so the shop statistics page stays the only place it exists'
      : 'the fees Etsy kept on these orders, which sit on the payment record rather than the receipt',
    evidenceMode: 'real',
    items: [
      ...read.listings.map((l) => ({
        label: `${l.title || 'untitled listing'} (${l.state})`,
        url: l.url, datedAt: null,
        said: `${l.lifetimeViews === null ? 'views not reported' : `${String(l.lifetimeViews)} views since it was listed`}, `
          + `${l.favourites === null ? 'favourites not reported' : `${String(l.favourites)} favourites`}`,
        relevant: l.state === 'active', sharedTerms: [],
      })),
      ...read.orders.map((o) => ({
        label: `order ${o.orderRef}`, url: null, datedAt: o.paidAt.slice(0, 10),
        said: `${(o.grossCents / 100).toFixed(2)} ${o.currency.toUpperCase()} paid`,
        relevant: true, sharedTerms: [],
      })),
    ],
  });

  return { ...read, retrievalId };
}

/**
 * READ THE VENUE AND WRITE DOWN WHAT IT SAID.
 *
 * The owner: he does not intend to personally collect listing URLs, check
 * external accounts or reconcile marketplace activity, and "do not treat
 * manually completing external platform workflows as the normal long-term
 * operating model". This is the pass that takes that work off him for the one
 * responsibility now qualified to be taken — reading.
 *
 * ORDERS ARRIVE AS `venue_reported`, NOT AS `owner_entered`. That is the whole
 * economic point of the connection: an order Etsy itself reported through a
 * credential he granted is a different quality of fact from one he typed off a
 * statement, and `observed_how` is the column that says which.
 *
 * AND AN ABSENCE IS RECORDED AS AN ABSENCE OF ORDERS ONLY. The observation
 * carries the retrieval, whose `cannot_see` names what Etsy withholds — so
 * "nobody bought anything" is evidence, and "nobody looked at it" remains
 * unknown and is never silently read as zero.
 */
export async function bringTheVenueUpToDate(input: {
  founderId: string; experimentId: string;
}): Promise<{ read: false; because: string } | {
  read: true; orders: number; recorded: number; listings: number; shopName: string | null;
}> {
  const e = (await query(
    `SELECT e.claim_id, e.evidence_mode,
            (SELECT p.id FROM products p WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL) AS product_id
       FROM venture_experiments e WHERE e.id = ? AND e.founder_id = ?`,
    [input.experimentId, input.founderId])).rows[0] as Record<string, unknown> | undefined;
  if (!e?.product_id) return { read: false, because: 'that test has no asset to read a venue for' };

  const reading = await readTheShop({ founderId: input.founderId, productId: String(e.product_id) });
  if ('failed' in reading) return { read: false, because: reading.ownerWords };

  const { noteSenseObserved } = await import('../index.js');
  await noteSenseObserved(String(e.product_id), 'etsy');

  let recorded = 0;
  if (e.claim_id) {
    const { observe } = await import('../../venture/market-evidence.js');
    const day = new Date().toISOString().slice(0, 10);
    await observe({
      founderId: input.founderId, claimId: String(e.claim_id), sourceType: 'marketplace',
      source: `etsy:shop:${reading.shop.shopId}:${day}`,
      saw: `${reading.shop.shopName ?? 'the shop'} on ${day}: ${String(reading.listings.length)} `
        + `listing${reading.listings.length === 1 ? '' : 's'}, ${String(reading.orders.length)} `
        + `order${reading.orders.length === 1 ? '' : 's'} on the receipts Etsy returned. `
        + `Etsy reports no view, visit or impression counts to anyone.`,
      bearing: 'supports', directness: 'direct', observedAt: new Date(),
      evidenceMode: e.evidence_mode as 'real' | 'sandbox' | 'reference',
      retrievalId: reading.retrievalId,
      // THE ABSENCE IS ABOUT ORDERS AND NOTHING ELSE. Etsy answered; it said
      // no receipts. That is evidence. What it will not say anything about
      // cannot be inferred from the same silence.
      fromAbsence: reading.orders.length === 0,
    });
  }

  const { recordVenueOrder } = await import('../../venture/proof-2.js');
  for (const o of reading.orders) {
    try {
      const r = await recordVenueOrder({
        founderId: input.founderId, experimentId: input.experimentId,
        order: o, observedHow: 'venue_reported',
      });
      if (!r.duplicate) recorded += 1;
    } catch {
      // An order the record refuses — no exposure yet, a test not approved —
      // is not a reason to abandon the rest of the reading.
    }
  }

  return {
    read: true, orders: reading.orders.length, recorded,
    listings: reading.listings.length, shopName: reading.shop.shopName,
  };
}

/**
 * THE TESTS WHOSE VENUE IS WORTH READING.
 *
 * Deliberately NOT the selection `settleListings` uses, and the difference is
 * the whole point: that one requires a live exposure, because it settles what
 * a listing did. This one must run BEFORE a listing exists — verifying which
 * shop the credential opens, and seeing that there is nothing in it yet, is
 * exactly the qualification step the owner asked for, and it happens while the
 * shop is still empty.
 */
export async function listingExperimentsToRead(): Promise<Array<{ founderId: string; experimentId: string }>> {
  const rows = (await query(
    `SELECT e.id, e.founder_id FROM venture_experiments e
      WHERE e.decision = 'approved' AND e.ran_at IS NULL
        AND e.validity = 'valid' AND e.evidence_mode = 'real'
        AND EXISTS (SELECT 1 FROM experiment_materials m
                     WHERE m.experiment_id = e.id AND m.kind = 'offer_shape')
      ORDER BY e.decided_at, e.rowid`)).rows as unknown as Array<Record<string, unknown>>;
  const out: Array<{ founderId: string; experimentId: string }> = [];
  for (const r of rows) {
    const { offerShapePlanOf } = await import('../../venture/hand.js');
    const plan = await offerShapePlanOf(String(r.id));
    if (plan?.listing?.venue === 'etsy') {
      out.push({ founderId: String(r.founder_id), experimentId: String(r.id) });
    }
  }
  return out;
}
