// =============================================================================
// FOUNDRY — what a Stripe event says about money, as opposed to about a sale
//
// `settlement-intake` reads a Stripe event as a fact about an EXPERIMENT: a
// payment happened on an exposure, and something is now owed to a buyer. This
// reads the same event as a fact about MONEY: this much was charged, this much
// of it the provider took, this much went back.
//
// Two readings of one event rather than one reading doing both jobs, because
// they answer to different rules. The experiment reading may never carry an
// amount into a verdict; the money reading may never carry a buyer's identity.
//
// THE ACCOUNT IS SHARED, AND THAT DECIDES WHAT CAN BE READ HERE.
//
// `docs/stripe-shared-account.md`: one live Stripe account serves the personal
// land sales, AcreOS and Foundry, and "a Stripe webhook endpoint cannot be
// scoped to 'only my products'". Isolation is by the `app` tag, enforced in
// code. So:
//
//   • A CHARGE, ITS FEE, ITS REFUND AND ITS DISPUTE can be read, because each
//     is an object tagged for one tenant. They are attributable with certainty.
//
//   • A PAYOUT CANNOT. A payout is a lump of the account's balance moving to a
//     bank; it mixes tenants by construction, and the land sales are the only
//     live money in that account. Reading `payout.paid` as Foundry's cash would
//     be reporting somebody else's money as this institution's, which is the
//     worst error available on this surface. Nothing here ingests one, and the
//     projection says what it cannot know instead of guessing.
//
// THE FEE IS NOT IN THE EVENT. Stripe sends `balance_transaction` as an id, not
// as an object, so what the provider took requires one API read. When that read
// is unavailable — no key, an outage, a refusal — NO FEE ROW IS WRITTEN, and
// the unit's contribution reports itself as not known. An assumed fee would put
// the whole price into margin on the one figure where the difference is the
// entire margin.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';
import { record, type EconomicKind, type EvidenceMode } from './ledger.js';

interface StripeObject {
  id?: string; object?: string; metadata?: Record<string, string> | null; [k: string]: unknown;
}

export interface MoneyFact {
  kind: EconomicKind;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  /** The provider's own id for this fact. Idempotency turns on it. */
  providerRef: string;
  /** The charge this belongs to, when it belongs to one. */
  chargeRef: string | null;
  /** The payment intent, which is how a fulfilment is found. */
  paymentRef: string | null;
  /** The balance transaction that states the fee, when the event names one. */
  balanceTransactionRef: string | null;
}

const isOurs = (m: Record<string, string> | null | undefined): boolean =>
  !!m && (m.app == null || m.app === 'foundry')
  && typeof m.experiment_id === 'string' && m.experiment_id.trim() !== '';

const btRef = (v: unknown): string | null =>
  typeof v === 'string' ? v : (v as StripeObject | null)?.id ?? null;

/**
 * The money facts an event states on its own, before any API read. Pure, so
 * the mapping can be exercised against captured payloads with no network.
 */
export function moneyFactsFromStripeEvent(
  event: { id?: string; type: string; created?: number; data?: { object?: unknown } },
): MoneyFact[] {
  const o = (event.data?.object ?? {}) as StripeObject;
  const at = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000);
  const meta = o.metadata ?? null;
  const currency = String(o.currency ?? 'usd');

  if (event.type === 'charge.succeeded' && o.object === 'charge' && isOurs(meta)) {
    return [{
      kind: 'charge', amountCents: Number(o.amount ?? 0), currency, occurredAt: at,
      providerRef: String(o.id), chargeRef: String(o.id),
      paymentRef: typeof o.payment_intent === 'string' ? o.payment_intent : null,
      balanceTransactionRef: btRef(o.balance_transaction),
    }];
  }

  if (event.type === 'charge.refunded' && o.object === 'charge' && isOurs(meta)) {
    const refunds = (o.refunds as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [];
    const last = refunds[refunds.length - 1];
    if (!last) return [];
    return [{
      kind: 'refund', amountCents: Number(last.amount ?? 0), currency, occurredAt: at,
      providerRef: String(last.id ?? `${String(o.id)}:refund`), chargeRef: String(o.id),
      paymentRef: typeof o.payment_intent === 'string' ? o.payment_intent : null,
      balanceTransactionRef: btRef(last.balance_transaction),
    }];
  }

  // A dispute IS expanded: `balance_transactions` arrives as objects, so the
  // withdrawal and the provider's handling charge are both stated outright.
  // A DISPUTE CARRIES NO METADATA OF OURS (a Dispute's metadata is its own,
  // never copied from the charge); it names the charge and the intent, and
  // `linkFor` below finds the sale by those or finds nothing.
  if (event.type === 'charge.dispute.created' && o.object === 'dispute' && (isOurs(meta) || o.charge != null)) {
    const txns = (o.balance_transactions as Array<Record<string, unknown>> | undefined) ?? [];
    const facts: MoneyFact[] = [{
      kind: 'dispute_withdrawal', amountCents: Number(o.amount ?? 0), currency, occurredAt: at,
      providerRef: String(o.id), chargeRef: typeof o.charge === 'string' ? o.charge : null,
      paymentRef: typeof o.payment_intent === 'string' ? o.payment_intent : null,
      balanceTransactionRef: null,
    }];
    const feeCents = txns.reduce((n, t) => n + Math.abs(Number(t.fee ?? 0)), 0);
    if (feeCents > 0) {
      facts.push({
        kind: 'dispute_fee', amountCents: feeCents, currency, occurredAt: at,
        providerRef: `${String(o.id)}:fee`, chargeRef: typeof o.charge === 'string' ? o.charge : null,
        paymentRef: typeof o.payment_intent === 'string' ? o.payment_intent : null,
        balanceTransactionRef: null,
      });
    }
    return facts;
  }

  return [];
}

export interface EconomicIntake {
  recorded: Array<{ kind: string; providerRef: string; duplicate: boolean }>;
  unread: Array<{ providerRef: string; reason: string }>;
}

/**
 * Record what an event says about money, against the sale it belongs to.
 *
 * Runs AFTER `intakeStripeSettlement`, because a charge row must point at the
 * outcome event that recorded the payment and at the fulfilment it opened —
 * both of which that intake creates. Ordering is enforced by the caller in
 * `billing/stripe.ts`, and the lookups below simply find nothing if it is not.
 */
export async function intakeStripeEconomics(
  event: { id?: string; type: string; created?: number; data?: { object?: unknown } },
): Promise<EconomicIntake> {
  const out: EconomicIntake = { recorded: [], unread: [] };
  const facts = moneyFactsFromStripeEvent(event);
  if (facts.length === 0) return out;

  for (const f of facts) {
    const link = await linkFor(f);
    if (!link) {
      out.unread.push({ providerRef: f.providerRef, reason: 'no settled sale of ours matches this charge' });
      continue;
    }
    const r = await record({
      founderId: link.founderId,
      kind: f.kind,
      amountCents: f.amountCents,
      currency: f.currency,
      occurredAt: f.occurredAt,
      provider: 'stripe',
      providerRef: f.providerRef,
      sourceEventId: f.kind === 'charge' ? link.outcomeEventId : null,
      fulfilmentId: link.fulfilmentId,
      claimQuality: 'measured',
      evidenceMode: link.evidenceMode,
      because: becauseOf(f.kind),
    });
    out.recorded.push({ kind: f.kind, providerRef: f.providerRef, duplicate: r.duplicate });

    // The fee is the one thing the event does not state. Read it once, here,
    // where the charge it belongs to is already in hand.
    if (f.kind === 'charge' && f.balanceTransactionRef) {
      await recordProviderFee(f, link);
    }
  }
  return out;
}

const becauseOf = (kind: EconomicKind): string => ({
  charge: 'A buyer was charged this, and Stripe said so.',
  refund: 'This went back to the buyer.',
  dispute_withdrawal: 'Stripe withdrew this while a buyer disputed the charge.',
  dispute_fee: 'What Stripe charged for handling the dispute.',
  provider_fee: 'What Stripe took from this charge, from its own balance transaction.',
  refund_fee_returned: 'A fee Stripe gave back with the refund.',
  unit_cost: 'What producing and delivering this cost.',
  payout: 'Money moved to a bank account.',
  payout_reversed: 'A payout came back.',
  operating_spend: 'Spent running the institution.',
  owner_contribution: 'The owner put this in.',
  owner_distribution: 'The owner took this out.',
}[kind]);

interface Link {
  founderId: string;
  fulfilmentId: string;
  outcomeEventId: string;
  evidenceMode: EvidenceMode;
}

/** The sale this money fact belongs to, found by the provider's own references. */
async function linkFor(f: MoneyFact): Promise<Link | null> {
  const refs = [f.paymentRef, f.chargeRef].filter((r): r is string => !!r);
  if (refs.length === 0) return null;
  const placeholders = refs.map(() => '?').join(',');
  const r = await query(
    `SELECT fl.id AS fulfilment_id, fl.founder_id, fl.payment_event_id, e.evidence_mode
       FROM experiment_fulfilments fl
       JOIN business_outcome_events e ON e.id = fl.payment_event_id
      WHERE fl.payment_ref IN (${placeholders}) OR fl.charge_ref IN (${placeholders})
      LIMIT 1`, [...refs, ...refs]);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    founderId: String(row.founder_id),
    fulfilmentId: String(row.fulfilment_id),
    outcomeEventId: String(row.payment_event_id),
    evidenceMode: String(row.evidence_mode) as EvidenceMode,
  };
}

/**
 * Ask Stripe what it took. One read, and a failure is recorded as silence
 * rather than as a zero — `unitContribution` reports "not known" when no fee
 * row exists for a charge, which is the honest state.
 */
async function recordProviderFee(f: MoneyFact, link: Link): Promise<void> {
  if (!f.balanceTransactionRef) return;
  try {
    const { retrieveBalanceTransaction } = await import('./provider-stripe.js');
    const bt = await retrieveBalanceTransaction(f.balanceTransactionRef);
    if (!bt || typeof bt.fee !== 'number') return;
    await record({
      founderId: link.founderId,
      kind: 'provider_fee',
      amountCents: Math.abs(bt.fee),
      currency: f.currency,
      occurredAt: f.occurredAt,
      provider: 'stripe',
      providerRef: f.balanceTransactionRef,
      fulfilmentId: link.fulfilmentId,
      claimQuality: 'measured',
      evidenceMode: link.evidenceMode,
      because: becauseOf('provider_fee'),
    });
  } catch (err) {
    // Deliberately quiet and deliberately empty-handed. The fee is unknown,
    // and the surface says so.
    log.warn('provider fee unread', { balanceTransaction: f.balanceTransactionRef, error: String(err) });
  }
}
