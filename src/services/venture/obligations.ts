// =============================================================================
// WHAT A BUYER IS OWED, AS ONE OBJECT
//
// A purchase of an experiment's offer used to be read four ways: an aggregate
// on Economics ("paid for, not delivered"), an exception string on the test's
// page, a predicate inside the door's ranking of acts, and a list on the
// Workshop page — each with its own SQL, each drifting from the others by one
// clause. This is the one reading. Everything that shows, ranks or carries an
// obligation reads it from here, and the predicate that says "somebody is
// still owed something behind this row" is exported for the SQL that cannot
// call a function.
//
// An obligation is a fulfilment that is not yet discharged: the goods not yet
// delivered, a delivery the provider has not confirmed, a refund owed but not
// issued, a refund the buyer asked for, or a charge the buyer is contesting. It
// closes when the goods are confirmed delivered and nothing is asked back, or
// when the money has gone back — and only then. It outlives the test's
// settlement, the owner's pause, the acts' expiry and the test's stop, because
// none of those is the buyer's concern.
//
// No buyer identity is read here. The provider's payment reference is what the
// owner needs to find the purchase in his own Stripe account, and it is the
// only reference the row holds.
// =============================================================================

import { query, realCompany } from '../../db/client.js';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

/** The one predicate: somebody is still owed something behind fulfilment `f`. */
export const OPEN_OBLIGATION = (f: string): string =>
  `((${f}.status IN ('owed','sent','failed') AND ${f}.refund_ref IS NULL)
    OR (${f}.refund_requested_at IS NOT NULL AND ${f}.refund_ref IS NULL AND ${f}.status <> 'refunded')
    OR (${f}.disputed_at IS NOT NULL AND ${f}.dispute_outcome IS NULL))`;

export type ObligationState =
  | 'owed'                    // paid; the goods have not gone out
  | 'sent_unconfirmed'        // sent; the provider has not said it arrived
  | 'failed_refund_pending'   // the delivery failed; the refund is owed and not issued
  | 'refund_requested'        // the buyer asked through the link; not issued
  | 'disputed'                // the buyer is contesting the charge with their bank
  | 'uncovered';              // reported after the acts allowing the test lapsed: nothing covers it

export type ObligationAction =
  | 'nothing'                 // Foundry carries it on the next pass
  | 'check_delivery'          // sent days ago, unconfirmed: worth his eyes
  | 'money_tools_off'         // a refund is owed and Foundry may not move money
  | 'refund_yourself'         // a refund is owed and the door keeps refusing it
  | 'respond_to_dispute'      // only he can answer the bank
  | 'deliver_or_refund_yourself' // no act of his covers it; it is his in Stripe
  | 'refund_on_the_venue';      // the money is the venue's; only he can give it back, there

export interface Obligation {
  id: string;
  experimentId: string;
  experimentTitle: string;
  productId: string | null;
  state: ObligationState;
  action: ObligationAction;
  amountCents: number;
  currency: string;
  paymentRef: string;
  /** When the obligation opened (the purchase), ISO. */
  since: string;
  /** When the delivery went out, ISO, when it has. */
  sentAt: string | null;
  /** How Foundry stands on it, in the owner's words. */
  sentence: string;
  /** What is asked of him, in one line, or null when nothing is. */
  asksHim: string | null;
  /**
   * WHERE THE MONEY IS, which decides who can give it back. Foundry's only
   * refund executor is Stripe; a marketplace holds its own.
   */
  provider: string;
  /**
   * HOW THIS CAME TO BE KNOWN. The difference between a channel Foundry
   * watches reporting nothing and a channel it cannot read reporting nothing
   * is the difference between evidence and silence.
   */
  observedHow: 'foundry_observed' | 'venue_reported' | 'owner_entered' | 'inferred';
}

/** Sent and unconfirmed for this long, it is worth the owner's eyes. */
export const CHECK_DELIVERY_AFTER_HOURS = 72;
/** Sent and unconfirmed for this long, it is treated as undelivered and refunded. */
export const UNCONFIRMED_IS_FAILED_AFTER_DAYS = 7;
/** A refund refused for this long has had its retries; the owner is asked. */
export const REFUND_IS_HIS_AFTER_HOURS = 24;

/** What is his when a refund is owed and Foundry cannot issue it. The refund
 * act he approved still covers this purchase — its expiry bounds what may be
 * taken on, not the discharge — but the door will not move money while the
 * deployment's switch is off, and only he can refund in Stripe. */
const MONEY_TOOLS_OFF = 'The refund you approved covers this purchase, but this deployment\u2019s money-tools switch (FOUNDRY_ENABLE_MONEY_TOOLS, set where Foundry is deployed, not on a page) is off, so I may not move money. Refund it yourself in Stripe and I close it when Stripe reports the refund; or have the switch turned on and I issue it on the next pass.';
const REFUND_YOURSELF = 'The refund you approved has been refused at the door for a day. Refund it yourself in Stripe and I close it when Stripe reports the refund; I keep trying each pass meanwhile.';

// WHAT HE IS ASKED WHEN HE HAS TAKEN THE AUTHORITY BACK. Not the sentence
// above: that one promises to keep trying, and after a withdrawal that would
// be a promise nothing can keep.
const REFUND_WITHDRAWN = 'You withdrew the authority to refund this test, so I will not try again. '
  + 'Refund it yourself in Stripe and I close it when Stripe reports the refund, or approve the refund again and I will.';

const money = (cents: number, currency: string): string =>
  `${currency.toLowerCase() === 'usd' ? '$' : ''}${(cents / 100).toFixed(2)}${currency.toLowerCase() === 'usd' ? '' : ` ${currency.toUpperCase()}`}`;
const day = (iso: string): string => iso.slice(0, 10);
const hoursSince = (iso: string | null, now: Date): number => iso ? (now.getTime() - new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime()) / 3_600_000 : 0;

async function read(r: Row, now: Date, moneyToolsOn: boolean): Promise<Obligation> {
  const amount = money(Number(r.amount_cents), String(r.currency));
  const ref = String(r.payment_ref);
  const title = String(r.title ?? 'the test');
  const sentAt = r.sent_at == null ? null : String(r.sent_at);
  const disputed = r.disputed_at != null && r.dispute_outcome == null;
  const refundOwed = (String(r.status) === 'failed' || r.refund_requested_at != null) && r.refund_ref == null;
  // THE ACTS COVER WHAT WAS REPORTED WHILE THEY STOOD. A purchase reported
  // after the last act allowing the test expired is covered by nothing he
  // approved, so Foundry neither delivers nor refunds it: it is his.
  const uncovered = r.act_expires_at != null && hoursSince(String(r.act_expires_at), new Date(String(r.created_at).includes('T') ? String(r.created_at) : String(r.created_at).replace(' ', 'T') + 'Z')) > 0;
  // THE AUTHORITY TO GIVE MONEY BACK, WITHDRAWN. Not the same as expiry and
  // not the same as money tools being off: the owner took back the one act
  // that would have discharged this, so nothing Foundry does on the next pass
  // will refund it. Said at once rather than after a day of saying it will
  // try again.
  const refundWithdrawn = r.refund_act_revoked_at != null;
  let state: ObligationState; let action: ObligationAction; let sentence: string; let asksHim: string | null = null;
  // WHOSE MONEY IT IS DECIDES WHO CAN GIVE IT BACK. Every sentence below used
  // to end "in Stripe", which is true of a charge Foundry took and false of a
  // marketplace order. A venue holds its own money: Foundry has no executor
  // for it, no amount of authority would give it one, and saying "refund it in
  // Stripe" about an Etsy order sends the owner to an account where the charge
  // does not exist. Named here once so every branch reads the same fact.
  const venue = String(r.provider) !== 'stripe';
  const venueName = String(r.provider).charAt(0).toUpperCase() + String(r.provider).slice(1);
  const putItRight = venue
    ? `Refund it yourself on ${venueName}, against order ${ref}, and record it here; I have no way to move ${venueName}'s money and never will.`
    : 'Refund it yourself in Stripe and I close it when Stripe reports the refund.';

  const refundAsk = (): ObligationAction => {
    // A VENUE REFUND IS NEVER FOUNDRY'S TO TRY. Not after a day, not with the
    // money switch on, not with the act standing: there is no door.
    if (venue) return 'refund_on_the_venue';
    if (refundWithdrawn) return 'refund_yourself';
    if (!moneyToolsOn) return 'money_tools_off';
    const askedAt = r.refund_requested_at == null ? String(r.updated_at) : String(r.refund_requested_at);
    return hoursSince(askedAt, now) >= REFUND_IS_HIS_AFTER_HOURS ? 'refund_yourself' : 'nothing';
  };
  if (uncovered && !disputed) {
    state = 'uncovered'; action = 'deliver_or_refund_yourself';
    sentence = `A buyer paid ${amount} for ${title} (payment ${ref}) on ${day(String(r.created_at))}, after the acts you approved for this test had lapsed.`;
    asksHim = venue
      ? `Nothing you approved covers delivering or refunding it, so I do neither; it is yours, on ${venueName}, against order ${ref}.`
      : 'Nothing you approved covers delivering or refunding it, so I do neither; it is yours, in Stripe.';
  } else if (disputed) {
    state = 'disputed'; action = 'respond_to_dispute';
    // THE SENTENCE HE READS FIRST HAS TO BE TRUE TOO. Only `asksHim` was made
    // channel-aware here, so the two lines contradicted each other: a buyer on
    // a marketplace opens a case with the marketplace, not with their bank,
    // and telling him otherwise sends him looking in the wrong place.
    sentence = venue
      ? `A buyer on ${venueName} is contesting the ${amount} charge for ${title} (order ${ref}). Nothing is sent or refunded on it until ${venueName} decides the case.`
      : `A buyer is contesting the ${amount} charge for ${title} (payment ${ref}) with their bank. Nothing is sent or refunded on it until the dispute is decided.`;
    asksHim = venue
      ? `Answering the case is yours, on ${venueName}; Foundry does not speak to a marketplace or a bank for you.`
      : 'Answering the dispute is yours, in your Stripe account; Foundry does not speak to a bank for you.';
  } else if (String(r.status) === 'failed' && r.refund_ref == null) {
    state = 'failed_refund_pending'; action = refundAsk();
    sentence = `A buyer paid ${amount} for ${title} (payment ${ref}) on ${day(String(r.created_at))}; the delivery failed on ${day(String(r.updated_at))}, and the refund did not go through.${action === 'nothing' ? ' I try again on the next pass.' : ''}${refundWithdrawn ? ' You withdrew the authority to refund this test, so I will not try again.' : ''}`;
    asksHim = venue ? putItRight
      : refundWithdrawn ? REFUND_WITHDRAWN
        : action === 'money_tools_off' ? MONEY_TOOLS_OFF : action === 'refund_yourself' ? REFUND_YOURSELF : null;
  } else if (refundOwed) {
    state = 'refund_requested'; action = refundAsk();
    sentence = venue
      ? `A buyer on ${venueName} asked for their ${amount} back on order ${ref} and it has not gone back.`
      : `A buyer asked for a refund through the delivery link (payment ${ref}) and the ${amount} has not gone back.${action === 'nothing' ? ' I try again on the next pass.' : ''}${refundWithdrawn ? ' You withdrew the authority to refund this test, so I will not try again.' : ''}`;
    asksHim = venue ? putItRight
      : refundWithdrawn ? REFUND_WITHDRAWN
        : action === 'money_tools_off' ? MONEY_TOOLS_OFF : action === 'refund_yourself' ? REFUND_YOURSELF : null;
  } else if (String(r.status) === 'sent') {
    const hours = hoursSince(sentAt ?? String(r.updated_at), now);
    state = 'sent_unconfirmed'; action = hours >= CHECK_DELIVERY_AFTER_HOURS ? 'check_delivery' : 'nothing';
    // THE SEVEN-DAY PROMISE IS A PROMISE NOTHING CAN KEEP FOR A VENUE ORDER.
    // Nothing here watches the marketplace, and no pass refunds on it — the
    // whole reason `refund_on_the_venue` exists. Saying it anyway is the exact
    // shape this module already refuses elsewhere: a sentence the institution
    // repeats about something that will never happen.
    sentence = venue
      ? `${title} was bought on ${venueName} (order ${ref}, ${amount}) on ${day(sentAt ?? String(r.updated_at))} and I have no reading of whether the buyer got it. I do not watch ${venueName}, so this will not resolve itself here.`
      : `${title} was sent to a buyer (payment ${ref}, ${amount}) on ${day(sentAt ?? String(r.updated_at))} and the mail provider has not confirmed it arrived. After ${String(UNCONFIRMED_IS_FAILED_AFTER_DAYS)} days without confirmation it is treated as undelivered and refunded.`;
    asksHim = venue
      ? `Check the order on ${venueName}; nothing here can tell you whether it was delivered.`
      : action === 'check_delivery' ? 'Worth a look: the provider has not confirmed this delivery in three days.' : null;
  } else {
    // A PROMISE THE INSTITUTION CANNOT KEEP IS WORSE THAN A REFUSAL IT
    // EXPLAINS — the rule an owner-withdrawn refund taught, met here a second
    // time. The thing a buyer bought can go past its freshness limit, and the
    // quality gate then refuses the delivery, rightly and for ever. The
    // steward re-pulls what it can re-pull; where it cannot, "the delivery
    // goes out on the next pass" is a sentence the institution says on every
    // pass about something that will never happen.
    const stuck = await whyItCannotGoOut(String(r.experiment_id), now);
    if (stuck) {
      state = 'owed'; action = 'deliver_or_refund_yourself';
      sentence = `A buyer paid ${amount} for ${title} (payment ${ref}) on ${day(String(r.created_at))}, `
        + `and the delivery is refused: ${stuck}. Nothing I do on a later pass changes that, so I am not going to tell you it is coming.`;
      // THE LAST HARD-CODED STRIPE IN THIS FILE. `putItRight` already says the
      // true thing for both channels, and this branch is reachable for a venue
      // order: `recordVenueOrder` inserts at the default status and marks it
      // delivered, so anything that interrupts between those leaves a venue row
      // reading `owed`.
      asksHim = venue ? `This one is yours: ${putItRight}`
        : 'This one is yours: send them what they bought, or refund them in Stripe.';
    } else {
      state = 'owed';
      // NO PASS DELIVERS A LISTING. The hand's delivery pass runs on acts this
      // experiment does not have, so promising one for a venue order is a
      // sentence that comes back every hour and never becomes true.
      action = venue ? 'deliver_or_refund_yourself' : 'nothing';
      sentence = venue
        ? `A buyer paid ${amount} for ${title} on ${venueName} (order ${ref}) on ${day(String(r.created_at))}, and my record does not show it handed over. ${venueName} delivers its own downloads; nothing here does.`
        : `A buyer paid ${amount} for ${title} (payment ${ref}) on ${day(String(r.created_at))}; the delivery goes out on the next pass.`;
      asksHim = venue ? `Check order ${ref} on ${venueName}. ${putItRight}` : null;
    }
  }
  return { id: String(r.id), experimentId: String(r.experiment_id), experimentTitle: title, productId: r.product_id == null ? null : String(r.product_id),
    state, action, amountCents: Number(r.amount_cents), currency: String(r.currency), paymentRef: ref, since: String(r.created_at), sentAt, sentence, asksHim,
    provider: String(r.provider), observedHow: String(r.observed_how) as Obligation['observedHow'] };
}

/**
 * WHY WHAT WAS BOUGHT CANNOT GO OUT, or null when nothing stands in the way.
 *
 * Only a reason the institution cannot clear by itself counts. A brief the
 * hands made is re-pulled by the steward on the same pass, so its staleness is
 * a delay and not a dead end; a deliverable nothing can re-pull is a dead end,
 * and the difference is exactly what the owner needs to be told apart.
 */
async function whyItCannotGoOut(experimentId: string, now: Date): Promise<string | null> {
  const { materialOf, checkDeliverableQuality } = await import('./hand.js');
  const deliverable = await materialOf(experimentId, 'deliverable');
  if (!deliverable) return 'there is nothing attached to deliver';
  const quality = checkDeliverableQuality(deliverable, now);
  if (quality.ok) return null;
  const shape = await materialOf(experimentId, 'offer_shape');
  const canRePull = (shape?.body ?? '').includes('"kind":"data_brief"');
  return canRePull ? null : quality.failures.join('; ');
}

// OWNER TRUTH: an obligation reaches Home, the queue and Economics as his, so
// the asset behind it is read through the reality boundary. STANDING DOES NOT
// APPLY: a buyer owed something under an experimental asset is owed it exactly
// as under an earned one — the obligation is the buyer's, not the asset's —
// and every asset an experiment opens a purchase under is experimental until
// the world earns it, so filtering by standing would hide the frontier's
// obligations, which are the only ones there are.
const SELECT = `SELECT f.id, f.experiment_id, f.status, f.amount_cents, f.currency, f.payment_ref, f.refund_ref, f.refund_requested_at,
         f.disputed_at, f.dispute_outcome, f.created_at, f.updated_at, f.provider, f.observed_how,
         (SELECT p.id FROM products p WHERE p.from_experiment_id = f.experiment_id AND p.deleted_at IS NULL AND ${realCompany('p')} ORDER BY p.created_at, p.rowid LIMIT 1) AS product_id,
         COALESCE((SELECT m.title FROM experiment_materials m WHERE m.experiment_id = f.experiment_id AND m.kind = 'deliverable'
                    ORDER BY m.recorded_at DESC, m.rowid DESC LIMIT 1), e.what_we_do) AS title,
         (SELECT o.executed_at FROM outbound_actions o WHERE o.fulfilment_id = f.id AND o.experiment_act = 'delivery' AND o.executed_at IS NOT NULL
           ORDER BY o.executed_at DESC LIMIT 1) AS sent_at,
         (SELECT a.expires_at FROM proposed_acts a WHERE a.experiment_id = f.experiment_id AND a.subject = 'contact_people' AND a.action_type = 'send_email'
            AND coalesce(a.measurement_critical, 0) = 1 ORDER BY a.proposed_at DESC, a.rowid DESC LIMIT 1) AS act_expires_at,
         -- AND WHETHER WHAT WOULD DISCHARGE IT STILL STANDS. An act that
         -- expired stops covering what happens after it; an act the owner
         -- WITHDREW stops covering anything at all, including what it had
         -- already taken on. Both leave a buyer owed something, and until this
         -- was read the second case reported "I try again on the next pass"
         -- about a refund that could never go through.
         (SELECT a.revoked_at FROM proposed_acts a WHERE a.experiment_id = f.experiment_id
            AND a.action_type = 'stripe_create_refund'
            ORDER BY a.proposed_at DESC, a.rowid DESC LIMIT 1) AS refund_act_revoked_at
    FROM experiment_fulfilments f JOIN venture_experiments e ON e.id = f.experiment_id`;

const moneyToolsOn = (): boolean => process.env.FOUNDRY_ENABLE_MONEY_TOOLS === 'true';

/** Every open obligation of this owner's, oldest first. */
export async function obligationsFor(founderId: string, now = new Date()): Promise<Obligation[]> {
  const on = moneyToolsOn();
  return Promise.all((await rows(`${SELECT} WHERE e.founder_id = ? AND ${OPEN_OBLIGATION('f')} ORDER BY f.created_at, f.rowid`, [founderId])).map(async (r) => read(r, now, on)));
}

/** The open obligations of one test. */
export async function obligationsOf(experimentId: string, now = new Date()): Promise<Obligation[]> {
  const on = moneyToolsOn();
  return Promise.all((await rows(`${SELECT} WHERE f.experiment_id = ? AND ${OPEN_OBLIGATION('f')} ORDER BY f.created_at, f.rowid`, [experimentId])).map(async (r) => read(r, now, on)));
}

/** Whether anything is still owed behind this test. */
export async function owesAnybody(experimentId: string): Promise<boolean> {
  const r = (await rows(`SELECT COUNT(*) AS n FROM experiment_fulfilments f WHERE f.experiment_id = ? AND ${OPEN_OBLIGATION('f')}`, [experimentId]))[0];
  return Number(r?.n ?? 0) > 0;
}
