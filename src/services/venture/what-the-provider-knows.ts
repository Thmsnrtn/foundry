// =============================================================================
// WHAT THE PROVIDER KNOWS, WHATEVER IT TOLD US.
//
// Every safeguard before this one asks whether a path was working. None of
// them can answer the question that actually costs somebody money: a payment
// happened, the provider tried to tell us, and the message did not arrive.
// No check made before the fact catches that. The endpoint was configured, the
// signature was right, the machinery passed every test — and a delivery was
// dropped, or a signing secret was rotated at four in the afternoon, and a
// person who paid $29 is waiting for something nobody knows they are owed.
//
// So the institution asks. Once a pass, for an owner with a live paid offer,
// it reads the provider's own list of payments in the window and compares it
// with what it was told. A payment the provider knows about and Foundry does
// not is taken in through THE SAME DOOR a webhook would have used — the same
// facts, the same idempotency, the same fulfilment opened and owed — so
// nothing here is a second way for money to become real.
//
// AND THE FINDING IS RECORDED AGAINST THE PATH, not just fixed. A payment that
// reached us only because we asked means the observation path was not carrying
// what it is for on that day, and that is the fact a later reading of the
// result depends on. Quietly repairing the consequence and leaving the
// instrument looking healthy is the exact shape of the defect this campaign
// exists because of.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';

type Row = Record<string, unknown>;

export interface ProviderReconciliation {
  /** False when there was nothing to ask about, or nothing to ask with. */
  asked: boolean;
  /** Payments the provider knows of, in the window. */
  theyKnow: number;
  /** Those we had never been told about, by reference. */
  weDidNot: string[];
  /** What the owner would be told, or null when there is nothing to say. */
  sentence: string | null;
}

/** How far back a pass looks. Longer than any window a test settles in. */
export const RECONCILE_DAYS = 45;

/**
 * ASK THE PROVIDER, COMPARE, TAKE IN WHAT WE MISSED.
 *
 * Only for an owner who has a live paid exposure: there is no reason to ask
 * about money for somebody who is not asking anybody for any, and a deployment
 * with no key cannot ask at all and says so rather than reporting nothing
 * found.
 */
export async function reconcileWithTheProvider(
  founderId: string, now = new Date(),
): Promise<ProviderReconciliation> {
  const nothing: ProviderReconciliation = { asked: false, theyKnow: 0, weDidNot: [], sentence: null };
  if (!process.env.STRIPE_SECRET_KEY) return nothing;
  const paid = (await query(
    `SELECT x.id FROM experiment_exposures x
       JOIN venture_experiments e ON e.id = x.experiment_id
      WHERE x.founder_id = ? AND x.provider = 'stripe' AND e.evidence_mode = 'real'
        AND x.placed_at IS NOT NULL
        AND datetime(x.placed_at) >= datetime(?)
      LIMIT 1`, [founderId, new Date(now.getTime() - RECONCILE_DAYS * 86_400_000).toISOString()]))
    .rows[0] as Row | undefined;
  if (!paid) return nothing;

  const since = Math.floor((now.getTime() - RECONCILE_DAYS * 86_400_000) / 1000);
  let intents: StripeIntent[];
  try {
    const { paymentsTheProviderKnowsOf } = await import('./payment-link.js');
    intents = await paymentsTheProviderKnowsOf(since) as unknown as StripeIntent[];
  } catch (err) {
    log.warn('payments.reconcile.could_not_ask', { error: String(err) });
    return { asked: false, theyKnow: 0, weDidNot: [], sentence: null };
  }

  const weDidNot: string[] = [];
  for (const intent of intents) {
    const known = (await query(
      `SELECT 1 AS n FROM experiment_fulfilments WHERE payment_ref = ? OR charge_ref = ?
        UNION ALL SELECT 1 FROM business_outcome_events WHERE provider_event_ref = ?`,
      [intent.id, intent.latest_charge ?? '', intent.id])).rows[0] as Row | undefined;
    if (known) continue;
    // THE SAME DOOR A WEBHOOK WOULD HAVE USED. Shaped as the event that never
    // arrived, so the fact is recorded once, by one writer, with the same
    // refusals — a payment at somebody else's link is refused here exactly as
    // it is there.
    const { intakeStripeSettlement } = await import('./settlement-intake.js');
    const taken = await intakeStripeSettlement({
      id: `reconciled_${intent.id}`, type: 'payment_intent.succeeded',
      created: intent.created, data: { object: intent as unknown as Record<string, unknown> },
    });
    if (taken.recorded.length > 0) weDidNot.push(intent.id);
  }

  if (weDidNot.length > 0) {
    // THE PATH WAS NOT CARRYING WHAT IT IS FOR. Recorded on the day, through
    // the same writer the health pass uses, so the day record that a later
    // reading of a result depends on says what actually happened.
    const { recordWorkshopHealth } = await import('../public-workshop/settings.js');
    await recordWorkshopHealth(founderId, {
      payments: {
        status: 'needs_attention',
        detail: `${String(weDidNot.length)} payment${weDidNot.length === 1 ? '' : 's'} reached Foundry only because it asked the provider, not because the provider reached Foundry`,
      },
    }, now);
    log.warn('payments.reconcile.unheard', { founderId, count: weDidNot.length });
  }

  return {
    asked: true, theyKnow: intents.length, weDidNot,
    sentence: weDidNot.length === 0 ? null
      : `${String(weDidNot.length)} payment${weDidNot.length === 1 ? '' : 's'} the provider knew about had not reached Foundry. ${weDidNot.length === 1 ? 'It is' : 'They are'} recorded now, and what ${weDidNot.length === 1 ? 'it' : 'they'} bought is owed.`,
  };
}

/** The shape this module needs from a Stripe payment intent. */
export interface StripeIntent {
  id: string; created: number; amount_received?: number; amount?: number; currency?: string;
  object: 'payment_intent'; status: string; latest_charge?: string | null;
  metadata?: Record<string, string>; receipt_email?: string | null;
}
