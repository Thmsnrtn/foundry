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
// WHAT ETSY WILL NOT TELL ANYBODY, STATED EXACTLY. There is no shop-statistics
// endpoint: no DAILY views, visits, favourites, impressions, search queries or
// traffic sources. Etsy withdrew those deliberately, having found the data used
// to infer its own financials ahead of its announcements.
//
// The qualifier matters and an earlier draft of this file dropped it. A
// listing's LIFETIME views and favourite count ARE readable, and this very
// reader fetches them — so "Etsy reports no views to anyone" was a sentence
// disproved by the retrieval it was written into. An overclaim of ignorance is
// as dishonest as an overclaim of knowledge, and easier to miss.
//
// AND THE FEE IS READABLE, WHICH THIS FILE ALSO GOT WRONG. It claimed the fee
// sat "behind a scope this connection does not hold". `getShopPaymentByReceiptId`
// is under `transactions_r`, which this connection holds — and migration 338
// says so in the reason the owner is shown for asking: "to read the orders and
// the fees Etsy kept, so what it earned can be reconciled". The code was
// contradicting the institution's own constitutional record. It reads the fee.
//
// The limits that remain are written into the retrieval's `cannot_see`, so
// every observation drawn from this read carries the shape of the instrument
// that took it.
// =============================================================================

import { safeFetch } from '../../outbound/ssrf.js';
import { query } from '../../../db/client.js';
import { connectedSenses } from '../index.js';
import { withSenseSecret } from '../credentials.js';
import { recordRetrieval } from '../../venture/sources/index.js';

const API = 'https://openapi.etsy.com/v3/application';

/** Etsy's page size, and a ceiling so one shop cannot hold a pass open for ever. */
const PAGE = 100;
const MOST_IN_ONE_READ = 1000;

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
  /** What Etsy said it had, which is not the same as what was fetched. */
  saidListings: number;
  saidOrders: number;
  /** Receipts fetched and then dropped — a shape this reader could not parse. */
  discarded: number;
  /**
   * WHETHER SILENCE MEANS ANYTHING. False when the read was truncated or
   * anything was discarded: a path that cannot tell it was partial must never
   * let an empty list become an affirmative "nobody bought".
   */
  complete: boolean;
  /** The retrieval this reading was judged out of, with its declared limits. */
  retrievalId: string;
}

export type ReadFailure = { failed: true; ownerWords: string };

/** What Etsy can be asked, said once so the retrieval and the owner agree. */
export const CAN_SEE =
  'which shop this credential opens, by id and name; the listings in it, with each one’s '
  + 'lifetime view and favourite counts; and the receipts — order number, date and amount';

export const CANNOT_SEE =
  'DAILY views, visits, favourites, impressions, search queries or traffic sources: Etsy exposes '
  + 'no shop-statistics endpoint at all, deliberately, so an absence of those numbers here is an '
  + 'absence of an instrument and never evidence about the shop. A listing\u2019s LIFETIME view and '
  + 'favourite counts are readable and are read, which is a different and much smaller thing. Nor '
  + 'what a buyer wrote in Etsy Messages, so a refund being asked for cannot be seen from here';

/**
 * ETSY'S MONEY, IN MINOR UNITS, WITHOUT INVENTING ANYTHING.
 *
 * Etsy states an amount over a divisor such that `amount / divisor` is the
 * value: 1400/100 is $14.00, 1400/1 is \u00a51400, 1400/1000 is 1.400 KWD. In every
 * case `amount` IS ALREADY THE MINOR-UNIT INTEGER — cents, yen, fils — which is
 * exactly what `amount_cents` means throughout this institution.
 *
 * An earlier draft computed `round((amount / divisor) * 100)`, which assumes
 * every currency has two decimal places. A yen receipt came out a hundred times
 * too large and a dinar receipt a tenth of its true size. The divisor is kept
 * only to reject a shape that is not money at all.
 *
 * AND AN UNKNOWN CURRENCY IS NOT SILENTLY CALLED DOLLARS. That line invented a
 * fact rather than declining to state one, which is the single thing this file
 * exists not to do. No currency, no reading.
 */
function money(m: unknown): { minorUnits: number; currency: string } | null {
  if (m === null || typeof m !== 'object') return null;
  const v = m as Record<string, unknown>;
  const amount = Number(v.amount);
  const divisor = Number(v.divisor);
  if (!Number.isInteger(amount) || !Number.isFinite(divisor) || divisor <= 0) return null;
  if (typeof v.currency_code !== 'string' || v.currency_code.trim() === '') return null;
  return { minorUnits: amount, currency: v.currency_code.toLowerCase() };
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
  /**
   * THE LISTING THIS EXPERIMENT IS ABOUT, when there is one.
   *
   * `receipts` is a SHOP-WIDE endpoint. Without this every sale of every other
   * thing in the owner's shop was recorded as this experiment's order — a
   * charge in its ledger, a delivered fulfilment, and, because
   * `settleFromTheWorld` counts events inside the exposure's window, a sealed
   * prediction settled `as_predicted` on somebody else's sale. `observed_how`
   * is immutable and the fulfilment cannot be deleted, so the false record
   * would have been permanent.
   */
  onlyListingId?: string | null;
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
    // THE SENTENCE USED TO SAY THE OPPOSITE OF WHAT IT MEANT. `missing` is what
    // was NOT granted, and the message read "was granted <missing>". A review
    // found it, and found the test that passed on it — the assertion matched a
    // bare scope name, which appears in the true sentence and the false one
    // alike.
    return {
      failed: true,
      ownerWords: `the Etsy connection did not include ${missing.join(' and ')} — without `
        + 'that I can only read part of the shop, and a part-read would look like a shop with less in it',
    };
  }

  const read = await withSenseSecret(sense.id, async (secret) => {
    const token = secret.access_token;
    if (typeof token !== 'string' || !token) return null;

    const me = await get(`${API}/users/me`, token, apiKey);
    const shopId = me.shop_id == null ? null : String(me.shop_id);
    if (!shopId) return { noShop: true as const };
    const shop = await get(`${API}/shops/${encodeURIComponent(shopId)}`, token, apiKey);

    // EVERY PAGE, AND THE SOURCE'S OWN COUNT.
    //
    // This asked for `limit=100` once and took whatever came back. An
    // independent review found what that does: a shop with a hundred and one
    // receipts reads as a shop with a hundred, and — because the caller turns
    // an empty list into an affirmative "nobody bought" — a read that failed to
    // parse its only receipt reads as a shop with none. The owner's own rule
    // is quoted in the readiness module: "Do not use the absence of recorded
    // events as evidence of no external activity when the observation path was
    // unavailable." A path that cannot tell it was truncated is unavailable and
    // does not know it.
    //
    // `said` is what Etsy states it has. `seen` is what was actually fetched.
    // They are reported separately, and where they differ nothing downstream is
    // allowed to treat silence as evidence.
    const pages = async (path: string): Promise<{ said: number; rows: Array<Record<string, unknown>> }> => {
      const rows: Array<Record<string, unknown>> = [];
      let said = 0;
      for (let offset = 0; offset < MOST_IN_ONE_READ; offset += PAGE) {
        const body = await get(
          `${API}/shops/${encodeURIComponent(shopId)}/${path}${path.includes('?') ? '&' : '?'}limit=${String(PAGE)}&offset=${String(offset)}`,
          token, apiKey);
        const got = list(body);
        // The source's own count, which is the only thing in the response that
        // says how much there was.
        if (Number.isFinite(Number(body.count))) said = Math.max(said, Number(body.count));
        rows.push(...got);
        if (got.length < PAGE) break;
      }
      return { said: Math.max(said, rows.length), rows };
    };

    const rawListings = await pages('listings');
    const listings = rawListings.rows.map((l): ShopListing => ({
      listingId: String(l.listing_id ?? ''),
      title: typeof l.title === 'string' ? l.title : '',
      state: typeof l.state === 'string' ? l.state : 'unknown',
      lifetimeViews: Number.isFinite(Number(l.views)) ? Number(l.views) : null,
      favourites: Number.isFinite(Number(l.num_favorers)) ? Number(l.num_favorers) : null,
      url: typeof l.url === 'string' ? l.url : null,
    }));

    // PAID RECEIPTS ONLY, AND ASKED FOR AS SUCH.
    //
    // A receipt exists before the money does on Etsy's deferred methods, and
    // this took every receipt as a paid order — writing a charge into the
    // ledger, a delivered fulfilment and refund exposure for a sale that had
    // not happened, with no path back because a later cancellation hits the
    // duplicate branch and is ignored. `was_paid=true` asks Etsy for the right
    // set; `is_paid` is checked again on what comes back, because a filter a
    // provider applies is a claim and a field on the row is the evidence.
    const rawOrders = await pages('receipts?was_paid=true');
    let discarded = 0;
    const orders: ShopOrder[] = [];
    for (const r of rawOrders.rows) {
      if (r.is_paid === false) { discarded += 1; continue; }
      // ONLY THIS EXPERIMENT'S LISTING. A receipt for anything else in the
      // shop is not this test's evidence and is passed over in silence rather
      // than discarded — it is not a shape this reader failed to parse, it is
      // somebody else's sale, and counting it as a discard would poison the
      // completeness reading with rows that were never ours.
      if (input.onlyListingId) {
        const lines = Array.isArray(r.transactions) ? r.transactions as Array<Record<string, unknown>> : [];
        if (!lines.some((t) => String(t.listing_id ?? '') === input.onlyListingId)) continue;
      }
      const gross = money(r.grandtotal);
      const ref = String(r.receipt_id ?? '');
      const at = Number(r.created_timestamp);
      // EVERY DISCARD IS COUNTED. A receipt dropped for a shape this reader
      // could not parse is not the same fact as a receipt that was never
      // there, and the difference is the whole of what `fromAbsence` means.
      if (!gross || gross.minorUnits <= 0 || ref === '' || !Number.isFinite(at) || at <= 0) {
        discarded += 1;
        continue;
      }
      // THE FEE, READ RATHER THAN LEFT NULL. `getShopPaymentByReceiptId` is
      // under `transactions_r`, which this connection holds — migration 338
      // says so in the very reason the owner is shown for granting it. A fee
      // that cannot be read stays null, which `recordVenueOrder` already
      // accepts as "not yet on the statement"; a fee invented would be a cost
      // nobody paid.
      let feeCents: number | null = null;
      try {
        const pay = await get(
          `${API}/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(ref)}/payments`,
          token, apiKey);
        const first = list(pay)[0];
        const fee = first ? money(first.amount_fees) : null;
        if (fee && fee.currency === gross.currency) feeCents = fee.minorUnits;
      } catch { /* the order stands; the fee is simply not read */ }

      orders.push({
        orderRef: ref,
        // NAMED FOR WHAT IT IS. Etsy's receipt carries no payment timestamp;
        // `created_timestamp` attests creation. With `was_paid=true` the
        // receipt is paid, so this is the order's date and is called that
        // rather than the moment money moved, which Etsy does not state here.
        paidAt: new Date(at * 1000).toISOString(),
        grossCents: gross.minorUnits,
        feeCents,
        currency: gross.currency,
      });
    }

    return {
      shop: {
        shopId,
        shopName: typeof shop.shop_name === 'string' ? shop.shop_name : null,
        url: typeof shop.url === 'string' ? shop.url : null,
      },
      listings, orders,
      saidListings: rawListings.said, saidOrders: rawOrders.said, discarded,
      // COMPLETE MEANS ALL THREE: nothing left unfetched on either endpoint,
      // and nothing fetched that this reader could not read. A discard is a
      // receipt that exists and was not understood, which is exactly the
      // condition under which a silence proves nothing.
      complete: rawListings.said <= listings.length
        && rawOrders.said <= rawOrders.rows.length
        && discarded === 0,
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
    // WHAT THE SOURCE SAID IT HAD, which is what this column is documented to
    // mean — "What the source said it had, which is not what was looked at."
    // It reported the post-filter total, so `returned_count` and
    // `examined_count` were equal by construction and the one column that
    // exists to say "there was more than we looked at" could never say it.
    returnedCount: read.saidListings + read.saidOrders,
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
  read: true; orders: number; recorded: number; listings: number;
  shopName: string | null; complete: boolean;
}> {
  const e = (await query(
    `SELECT e.claim_id, e.evidence_mode,
            (SELECT p.id FROM products p WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL) AS product_id
       FROM venture_experiments e WHERE e.id = ? AND e.founder_id = ?`,
    [input.experimentId, input.founderId])).rows[0] as Record<string, unknown> | undefined;
  if (!e?.product_id) return { read: false, because: 'that test has no asset to read a venue for' };
  const productId = String(e.product_id);

  // WHICH LISTING THIS TEST IS, TAKEN FROM ITS OWN EXPOSURE. The address the
  // owner recorded carries the id; `receipts` is shop-wide and without this
  // every other sale in his shop would be filed as this experiment's.
  const { exposureOf } = await import('../../venture/outcome.js');
  const exposure = await exposureOf(input.experimentId);
  const listingId = exposure && exposure.withdrawnAt === null
    ? (/\/listing\/(\d+)/.exec(exposure.exposureRef)?.[1] ?? null) : null;

  const reading = await readTheShop({
    founderId: input.founderId, productId, onlyListingId: listingId,
  });
  const { noteSenseObserved } = await import('../index.js');
  if ('failed' in reading) {
    // A SENSE GOING BLIND SAYS SO. `renewCredentials` writes its failures here
    // for a reason its own header gives: a sense must say "I have stopped
    // being able to see this" BEFORE anything derived from what it last said
    // is shown. This path reported nothing at all — a credential that started
    // answering 401 produced no log, no `last_error`, no job-health signal.
    //
    // A shop nobody has connected is not a failure and is not written as one;
    // it is the ordinary state of a deployment with no account.
    if (!/no Etsy account is connected/.test(reading.ownerWords)) {
      await noteSenseObserved(productId, 'etsy', reading.ownerWords);
    }
    return { read: false, because: reading.ownerWords };
  }
  await noteSenseObserved(productId, 'etsy');

  let recorded = 0;
  if (e.claim_id) {
    const { observe } = await import('../../venture/market-evidence.js');
    const day = new Date().toISOString().slice(0, 10);
    const source = `etsy:shop:${reading.shop.shopId}:${day}`;
    // ONCE A DAY, NOT ONCE AN HOUR. `observe` does not deduplicate and nothing
    // constrains `source`, so this pass wrote a fresh immutable observation on
    // every tick — twenty-four identical rows a day, each counted by
    // `standingOf` as direct supporting evidence and by the readiness reader
    // as "readings taken from Etsy itself". The job running is not evidence.
    const already = (await query(
      'SELECT id FROM market_observations WHERE claim_id = ? AND source = ? LIMIT 1',
      [String(e.claim_id), source])).rows[0];
    if (!already) {
      await observe({
        founderId: input.founderId, claimId: String(e.claim_id), sourceType: 'marketplace',
        source,
        saw: `${reading.shop.shopName ?? 'the shop'} on ${day}: ${String(reading.listings.length)} `
          + `listing${reading.listings.length === 1 ? '' : 's'}, ${String(reading.orders.length)} `
          + `order${reading.orders.length === 1 ? '' : 's'}`
          + `${listingId ? ` for listing ${listingId}` : ' (no listing of this test is live, so no order is attributed to it)'}`
          + `${reading.complete ? '' : ` — INCOMPLETE: Etsy reported ${String(reading.saidOrders)} receipts and `
            + `${String(reading.discarded)} could not be read`}. `
          + `Etsy reports no daily view, visit or impression counts to anyone; a listing's lifetime `
          + `view and favourite counts are readable and were read.`,
        // WHAT THE READING ACTUALLY BEARS ON THE CLAIM. This was hard-coded to
        // `supports` even when the shop was empty — so "nobody bought
        // anything" was filed as evidence FOR the claim that people would pay,
        // hourly and immutably. Worse, the guard that lets a claim be narrowed
        // requires a `contradicts` observation, so the only mechanism that
        // reads the venue could never produce one and the claim could never be
        // narrowed by what the venue said.
        bearing: reading.orders.length > 0 ? 'supports' : 'contradicts',
        directness: 'direct', observedAt: new Date(),
        evidenceMode: e.evidence_mode as 'real' | 'sandbox' | 'reference',
        retrievalId: reading.retrievalId,
        // AN ABSENCE ONLY WHERE THE INSTRUMENT KNOWS IT SAW EVERYTHING. A
        // truncated read, or one that discarded a receipt it could not parse,
        // is an observation path that was partly unavailable — and the owner's
        // rule is that such a silence is never evidence.
        fromAbsence: reading.complete && reading.orders.length === 0,
      });
    }
  }

  const { recordVenueOrder } = await import('../../venture/proof-2.js');
  const refusals: string[] = [];
  for (const o of reading.orders) {
    try {
      const r = await recordVenueOrder({
        founderId: input.founderId, experimentId: input.experimentId,
        order: o, observedHow: 'venue_reported',
      });
      if (!r.duplicate) recorded += 1;
    } catch (err) {
      // NOT A BARE SWALLOW. The designed state of this pass — no listing
      // recorded yet — makes `recordVenueOrder` refuse every order, and the
      // empty `catch` made that indistinguishable from the ledger rejecting a
      // charge. They are collected and reported.
      refusals.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (refusals.length) {
    const { log } = await import('../../../lib/logger.js');
    log.info(`etsy read: ${String(refusals.length)} order(s) not recorded for `
      + `${input.experimentId}: ${[...new Set(refusals)].join('; ')}`);
  }

  return {
    read: true, orders: reading.orders.length, recorded,
    listings: reading.listings.length, shopName: reading.shop.shopName,
    complete: reading.complete,
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
