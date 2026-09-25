// =============================================================================
// FOUNDRY — what one live asset owes and holds, in seven answers
//
// The integrated plan (§5) asks that, for each live asset, the institution can
// answer seven questions: who the customer is and what was promised; where
// buyers can actually meet it; which provider operations have been shown to
// work for this account; what money was charged, deducted, refunded, paid out
// and seen in a bank; what duty is owed, by whom and by when; what may be done
// and recovered; and what the owner must decide versus what Foundry carries.
//
// THE ANSWERS ALREADY EXISTED, SCATTERED. Keyed by experiment or by founder,
// in seven readers, on four pages — and several were not there at all: buyer
// rights, a due date, per-asset fees, payouts, what the account had been shown
// to do. An absence on an owner's screen reads as "nothing to know". So this
// module adds no record and no second ledger. It asks the readers that decide
// each fact, and where none can answer it says so in words, marked `unknown`
// or `partly` — the discipline the rest of the institution already keeps for
// an empty till.
//
// It decides nothing and grants nothing. A `known` here is a statement about
// the evidence behind a sentence, never a permission.
// =============================================================================

import { query } from '../../db/client.js';

export const QUESTIONS = [
  'Who is the customer, and what was promised?',
  'Where can a buyer actually meet it?',
  'What has the account been shown to do?',
  'What money moved, and where was it seen?',
  'What is owed, by whom, and by when?',
  'What may be done, and what if it is interrupted?',
  'What is yours to decide, and what does Foundry carry?',
] as const;

export type Known = 'known' | 'partly' | 'unknown';

export interface ContractAnswer {
  question: (typeof QUESTIONS)[number];
  answer: string;
  known: Known;
}

export interface OperatingContract {
  productId: string;
  name: string;
  experimentId: string | null;
  answers: ContractAnswer[];
}

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${String(n)} ${n === 1 ? one : many}`;
type Row = Record<string, unknown>;

/**
 * THE SEVEN ANSWERS FOR ONE ASSET, or null when it is not this founder's.
 * Every answer is a sentence; none is ever an empty field.
 */
export async function operatingContractOf(productId: string, founderId: string): Promise<OperatingContract | null> {
  const p = (await query(
    `SELECT id, name, owner_id, from_experiment_id FROM products WHERE id = ? AND deleted_at IS NULL`,
    [productId])).rows[0] as Row | undefined;
  if (!p || String(p.owner_id) !== founderId) return null;
  const experimentId = p.from_experiment_id == null ? null : String(p.from_experiment_id);

  const { materialOf, offerShapePlanOf } = await import('./hand.js');
  const { exposureOf } = await import('./outcome.js');
  const { findabilityOf } = await import('./findability.js');
  const plan = experimentId ? await offerShapePlanOf(experimentId) : null;
  const listing = plan?.listing ?? null;
  const venueName = listing?.venueName ?? null;
  const exposure = experimentId ? await exposureOf(experimentId) : null;

  // The account's standing at the venue, read once and used by three answers.
  const journey = listing?.venue === 'etsy'
    ? await (await import('../senses/journey.js')).etsyJourney(productId) : null;
  const venueRead = journey?.stage === 'qualified';

  const answers: ContractAnswer[] = [];
  const say = (i: number, answer: string, known: Known): void => {
    answers.push({ question: QUESTIONS[i], answer, known });
  };

  // ─── 1. The customer, and the promise ─────────────────────────────────────
  const deliverable = experimentId ? await materialOf(experimentId, 'deliverable') : null;
  const paid = exposure ? Number(((await query(
    `SELECT COUNT(*) AS n FROM business_outcome_events b
       JOIN business_outcome_event_kinds k ON k.kind = b.kind AND k.is_payment = 1
      WHERE b.exposure_id = ?`, [exposure.id])).rows[0] as Row).n ?? 0) : 0;
  const buyers = paid > 0
    ? `${plural(paid, 'paid order')} on record; buyers are not identified here by name, only counted`
    : 'Nobody has paid for it yet';
  // RIGHTS ARE NOT A FIELD ANYWHERE, and saying so is the answer. A buyer of a
  // file may do what the venue's defaults allow; nothing here narrows or
  // widens that, and inventing terms on the page would be a promise.
  const rights = 'No terms of use or licence for the buyer are recorded, so what a buyer may do with it is whatever the venue\'s own terms allow';
  say(0, deliverable
    ? `${buyers}. What is sold is "${deliverable.title}", fixed by its digest ${deliverable.digest}. ${rights}.`
    : `${buyers}. No deliverable is recorded for it, so what a buyer would receive is not on record. ${rights}.`,
  deliverable ? 'partly' : 'unknown');

  // ─── 2. Where a buyer can meet it ─────────────────────────────────────────
  if (!exposure || exposure.withdrawnAt) {
    say(1, exposure
      ? `It was listed at ${exposure.exposureRef} and taken down on ${exposure.withdrawnAt!.slice(0, 10)}; it is not listed anywhere now.`
      : `It is not listed anywhere yet${venueName ? `; the plan is ${venueName}` : ''}.`, 'unknown');
  } else if (listing) {
    const found = await findabilityOf(productId, listing.venue);
    const where = `Listed at ${exposure.exposureRef}, on ${venueName}, since ${exposure.placedAt.slice(0, 10)}`;
    say(1, !found || !found.byTheOwner
      ? `${where}. You have not said whether buyers can find the shop in ${venueName} search, and nothing here can see it.`
      : found.findable
        ? `${where}. You said on ${found.saidAt.slice(0, 10)} that buyers can find the shop in ${venueName} search.`
        : `${where}. You said on ${found.saidAt.slice(0, 10)} that buyers cannot find the shop in ${venueName} search, so the listing is there and nobody can reach it.`,
    found?.findable && found.byTheOwner ? 'known' : 'partly');
  } else {
    say(1, `Offered at ${exposure.exposureRef} since ${exposure.placedAt.slice(0, 10)}.`, 'known');
  }

  // ─── 3. What the account has been shown to do ─────────────────────────────
  if (journey) {
    // What a connection may never do, said at every stage; the reader's own
    // sentence opens with "Reading is all of it", which only reads right once
    // something has been read.
    const limits = journey.grantsNothing.replace(/^Reading is all of it\. /, '');
    const connected = journey.stage === 'identity_confirmed' || journey.stage === 'identity_verified' || venueRead;
    say(2, venueRead
      ? `Reading the shop, its listings and its paid receipts has worked for this account, and reading is all of it. ${limits}`
      : connected
        ? `An ${venueName} account is connected for it and has not been read successfully yet; connected, it can only read. ${limits}`
        : `No ${venueName} account is connected for it, so nothing has been shown to work there — it has not been read at all. Connected, it could only read. ${limits}`,
    venueRead ? 'known' : connected ? 'partly' : 'unknown');
  } else {
    say(2, 'Not assessed here for this kind of asset yet; its readiness on the test\'s page says what it depends on.', 'unknown');
  }

  // ─── 4. Money, in the words its evidence supports ─────────────────────────
  // Real money only: a rehearsal or a provider's test mode is never counted.
  const m = experimentId ? (await query(
    `SELECT
       COUNT(CASE WHEN e.kind = 'charge' THEN 1 END) AS charges,
       COALESCE(SUM(CASE WHEN e.kind = 'charge' THEN e.amount_cents END), 0) AS charged,
       COALESCE(SUM(CASE WHEN e.kind = 'provider_fee' THEN e.amount_cents END), 0) AS fees,
       COUNT(CASE WHEN e.kind = 'charge' AND NOT EXISTS (
               SELECT 1 FROM economic_events g
                WHERE g.fulfilment_id = e.fulfilment_id AND g.kind = 'provider_fee' AND g.evidence_mode = 'real')
             THEN 1 END) AS fees_unread,
       COALESCE(SUM(CASE WHEN e.kind = 'refund' THEN e.amount_cents END), 0) AS refunded,
       COALESCE(SUM(CASE WHEN e.kind IN ('dispute_withdrawal','dispute_fee') THEN e.amount_cents END), 0) AS disputed
       FROM economic_events e
       JOIN experiment_fulfilments f ON f.id = e.fulfilment_id
      WHERE f.experiment_id = ? AND e.founder_id = ? AND e.evidence_mode = 'real'`,
    [experimentId, founderId])).rows[0] as Row : null;
  const charges = Number(m?.charges ?? 0);
  if (charges === 0) {
    say(3, listing && !venueRead
      ? `No sale has been recorded against it — and nothing reads ${venueName} for it yet, so that is not evidence that nobody bought.`
      : 'No sale has been recorded against it.',
    listing && !venueRead ? 'unknown' : 'known');
  } else {
    const unread = Number(m?.fees_unread ?? 0);
    const parts = [
      `${usd(Number(m?.charged ?? 0))} charged across ${plural(charges, 'sale')}`,
      `${usd(Number(m?.fees ?? 0))} in fees ${venueName ?? 'the provider'} kept`
        + (unread > 0 ? ` (the fee on ${String(unread)} of them has not been read, so it is unknown, not zero)` : ''),
    ];
    if (Number(m?.refunded ?? 0) > 0) parts.push(`${usd(Number(m?.refunded))} refunded`);
    if (Number(m?.disputed ?? 0) > 0) parts.push(`${usd(Number(m?.disputed))} withdrawn in disputes`);
    // A PAYOUT IS ABOUT A BALANCE, NOT A SALE, so it is never this asset's row;
    // and no bank is read at all. Both are said rather than left blank.
    say(3, `${parts.join('; ')}. No payout is attributable to one asset, and ${venueName ? `${venueName}'s payouts are not read` : 'payouts are not read'} — so none of this has been seen arriving in a bank.`, 'partly');
  }

  // ─── 5. What is owed, by whom, by when ────────────────────────────────────
  const duties: string[] = [];
  if (experimentId) {
    const { obligationsOf } = await import('./obligations.js');
    for (const o of await obligationsOf(experimentId)) {
      duties.push(`${o.sentence} (${o.asksHim ? `yours: ${o.asksHim}` : 'Foundry carries it'}, since ${o.since.slice(0, 10)})`);
    }
    const unrecorded = (await query(
      `SELECT order_ref, observed_at FROM venue_orders_after_settlement
        WHERE experiment_id = ? AND resolved_at IS NULL ORDER BY observed_at`, [experimentId])).rows as unknown as Row[];
    for (const r of unrecorded) {
      duties.push(`order ${String(r.order_ref)} was paid at ${venueName ?? 'the venue'} and is not yet recorded here (seen ${String(r.observed_at).slice(0, 10)})`);
    }
  }
  const unheard = listing
    ? ` ${venueName} messages are not read here, so a buyer who asks for help or a refund reaches you there, and I would not know.`
    : '';
  say(4, duties.length
    ? `${duties.join('; ')}. No deadline is on record for any of it, and the provider's own process may not wait.${unheard}`
    : `Nothing is owed to a buyer on record.${unheard}`,
  listing ? 'partly' : 'known');

  // ─── 6. What may be done, and what if it is interrupted ───────────────────
  const boundaries = Number(((await query(
    `SELECT COUNT(*) AS n FROM owner_boundaries WHERE product_id = ? AND lifted_at IS NULL`, [productId]))
    .rows[0] as Row).n ?? 0);
  const { qualificationOf } = experimentId ? await import('./qualification.js') : { qualificationOf: null };
  const q = experimentId && qualificationOf ? await qualificationOf(experimentId) : null;
  const standing = `${plural(boundaries, 'standing boundary', 'standing boundaries')} in your words`
    + (q ? `; ${q.blocking.length ? `not ready: ${q.blocking.join(', ')}` : 'everything it needs is in place'}` : '');
  say(5, listing
    ? `${standing}. Foundry holds read access only, so it cannot change anything at ${venueName} and nothing it does there needs recovering; every change there is yours, by hand.`
    : `${standing}. What happens to an interrupted act for this asset is not assessed here yet.`,
  listing ? 'known' : 'partly');

  // ─── 7. His, and Foundry's ────────────────────────────────────────────────
  const his = [
    ...(q?.conditions.filter((c) => c.verdict === 'waits_for_you').map((c) => c.name) ?? []),
    ...(experimentId ? (await (await import('./obligations.js')).obligationsOf(experimentId))
      .filter((o) => o.asksHim).map((o) => o.asksHim!) : []),
  ];
  const carries: string[] = [];
  if (venueRead || journey?.stage === 'identity_confirmed') carries.push(`reading ${venueName} for its orders on every pass`);
  if (exposure && !exposure.withdrawnAt && q?.state !== 'operating') carries.push('settling the test by the rule you sealed, when its window closes');
  if (q?.state === 'operating') carries.push('keeping the settled test\'s record as it was sealed');
  say(6, `Yours: ${his.length ? his.join('; ') : 'nothing right now'}. Foundry carries: ${carries.length ? carries.join('; ') : 'nothing on its own for this asset yet'}.`,
    'known');

  return { productId, name: String(p.name), experimentId, answers };
}
