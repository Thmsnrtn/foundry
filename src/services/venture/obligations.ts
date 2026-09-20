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
  | 'deliver_or_refund_yourself'; // no act of his covers it; it is his in Stripe

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

const money = (cents: number, currency: string): string =>
  `${currency.toLowerCase() === 'usd' ? '$' : ''}${(cents / 100).toFixed(2)}${currency.toLowerCase() === 'usd' ? '' : ` ${currency.toUpperCase()}`}`;
const day = (iso: string): string => iso.slice(0, 10);
const hoursSince = (iso: string | null, now: Date): number => iso ? (now.getTime() - new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime()) / 3_600_000 : 0;

function read(r: Row, now: Date, moneyToolsOn: boolean): Obligation {
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
  let state: ObligationState; let action: ObligationAction; let sentence: string; let asksHim: string | null = null;
  const refundAsk = (): ObligationAction => {
    if (!moneyToolsOn) return 'money_tools_off';
    const askedAt = r.refund_requested_at == null ? String(r.updated_at) : String(r.refund_requested_at);
    return hoursSince(askedAt, now) >= REFUND_IS_HIS_AFTER_HOURS ? 'refund_yourself' : 'nothing';
  };
  if (uncovered && !disputed) {
    state = 'uncovered'; action = 'deliver_or_refund_yourself';
    sentence = `A buyer paid ${amount} for ${title} (payment ${ref}) on ${day(String(r.created_at))}, after the acts you approved for this test had lapsed.`;
    asksHim = 'Nothing you approved covers delivering or refunding it, so I do neither; it is yours, in Stripe.';
  } else if (disputed) {
    state = 'disputed'; action = 'respond_to_dispute';
    sentence = `A buyer is contesting the ${amount} charge for ${title} (payment ${ref}) with their bank. Nothing is sent or refunded on it until the dispute is decided.`;
    asksHim = 'Answering the dispute is yours, in your Stripe account; Foundry does not speak to a bank for you.';
  } else if (String(r.status) === 'failed' && r.refund_ref == null) {
    state = 'failed_refund_pending'; action = refundAsk();
    sentence = `A buyer paid ${amount} for ${title} (payment ${ref}) on ${day(String(r.created_at))}; the delivery failed on ${day(String(r.updated_at))}, and the refund did not go through.${action === 'nothing' ? ' I try again on the next pass.' : ''}`;
    asksHim = action === 'money_tools_off' ? MONEY_TOOLS_OFF : action === 'refund_yourself' ? REFUND_YOURSELF : null;
  } else if (refundOwed) {
    state = 'refund_requested'; action = refundAsk();
    sentence = `A buyer asked for a refund through the delivery link (payment ${ref}) and the ${amount} has not gone back.${action === 'nothing' ? ' I try again on the next pass.' : ''}`;
    asksHim = action === 'money_tools_off' ? MONEY_TOOLS_OFF : action === 'refund_yourself' ? REFUND_YOURSELF : null;
  } else if (String(r.status) === 'sent') {
    const hours = hoursSince(sentAt ?? String(r.updated_at), now);
    state = 'sent_unconfirmed'; action = hours >= CHECK_DELIVERY_AFTER_HOURS ? 'check_delivery' : 'nothing';
    sentence = `${title} was sent to a buyer (payment ${ref}, ${amount}) on ${day(sentAt ?? String(r.updated_at))} and the mail provider has not confirmed it arrived. After ${String(UNCONFIRMED_IS_FAILED_AFTER_DAYS)} days without confirmation it is treated as undelivered and refunded.`;
    asksHim = action === 'check_delivery' ? 'Worth a look: the provider has not confirmed this delivery in three days.' : null;
  } else {
    state = 'owed'; action = 'nothing';
    sentence = `A buyer paid ${amount} for ${title} (payment ${ref}) on ${day(String(r.created_at))}; the delivery goes out on the next pass.`;
  }
  return { id: String(r.id), experimentId: String(r.experiment_id), experimentTitle: title, productId: r.product_id == null ? null : String(r.product_id),
    state, action, amountCents: Number(r.amount_cents), currency: String(r.currency), paymentRef: ref, since: String(r.created_at), sentAt, sentence, asksHim };
}

// OWNER TRUTH: an obligation reaches Home, the queue and Economics as his, so
// the asset behind it is read through the reality boundary. STANDING DOES NOT
// APPLY: a buyer owed something under an experimental asset is owed it exactly
// as under an earned one — the obligation is the buyer's, not the asset's —
// and every asset an experiment opens a purchase under is experimental until
// the world earns it, so filtering by standing would hide the frontier's
// obligations, which are the only ones there are.
const SELECT = `SELECT f.id, f.experiment_id, f.status, f.amount_cents, f.currency, f.payment_ref, f.refund_ref, f.refund_requested_at,
         f.disputed_at, f.dispute_outcome, f.created_at, f.updated_at,
         (SELECT p.id FROM products p WHERE p.from_experiment_id = f.experiment_id AND p.deleted_at IS NULL AND ${realCompany('p')} ORDER BY p.created_at, p.rowid LIMIT 1) AS product_id,
         COALESCE((SELECT m.title FROM experiment_materials m WHERE m.experiment_id = f.experiment_id AND m.kind = 'deliverable'
                    ORDER BY m.recorded_at DESC, m.rowid DESC LIMIT 1), e.what_we_do) AS title,
         (SELECT o.executed_at FROM outbound_actions o WHERE o.fulfilment_id = f.id AND o.experiment_act = 'delivery' AND o.executed_at IS NOT NULL
           ORDER BY o.executed_at DESC LIMIT 1) AS sent_at,
         (SELECT a.expires_at FROM proposed_acts a WHERE a.experiment_id = f.experiment_id AND a.subject = 'contact_people' AND a.action_type = 'send_email'
            AND coalesce(a.measurement_critical, 0) = 1 ORDER BY a.proposed_at DESC, a.rowid DESC LIMIT 1) AS act_expires_at
    FROM experiment_fulfilments f JOIN venture_experiments e ON e.id = f.experiment_id`;

const moneyToolsOn = (): boolean => process.env.FOUNDRY_ENABLE_MONEY_TOOLS === 'true';

/** Every open obligation of this owner's, oldest first. */
export async function obligationsFor(founderId: string, now = new Date()): Promise<Obligation[]> {
  const on = moneyToolsOn();
  return (await rows(`${SELECT} WHERE e.founder_id = ? AND ${OPEN_OBLIGATION('f')} ORDER BY f.created_at, f.rowid`, [founderId])).map((r) => read(r, now, on));
}

/** The open obligations of one test. */
export async function obligationsOf(experimentId: string, now = new Date()): Promise<Obligation[]> {
  const on = moneyToolsOn();
  return (await rows(`${SELECT} WHERE f.experiment_id = ? AND ${OPEN_OBLIGATION('f')} ORDER BY f.created_at, f.rowid`, [experimentId])).map((r) => read(r, now, on));
}

/** Whether anything is still owed behind this test. */
export async function owesAnybody(experimentId: string): Promise<boolean> {
  const r = (await rows(`SELECT COUNT(*) AS n FROM experiment_fulfilments f WHERE f.experiment_id = ? AND ${OPEN_OBLIGATION('f')}`, [experimentId]))[0];
  return Number(r?.n ?? 0) > 0;
}
