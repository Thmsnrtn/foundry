// =============================================================================
// THE WORLD REPORTS TO THE EXPOSURE
//
// `recordBusinessOutcome` had no production caller and `experiment_exposures
// (provider, exposure_ref)` was the join nothing populated. This is the join:
// a verified Stripe event tagged for an experiment becomes a `payment` or
// `refund` outcome event on the experiment's live exposure, and a payment
// opens a fulfilment (what is owed, keyed to the provider's references, naming
// no buyer). The billing webhook is already registered for every event on the
// shared account; nothing new is exposed to the world.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';
import { exposureOf, recordBusinessOutcome } from './outcome.js';

type Row = Record<string, unknown>;

interface StripeObject { id?: string; object?: string; metadata?: Record<string, string> | null; [k: string]: unknown }

export interface SettlementFact {
  experimentId: string; kind: 'payment' | 'refund'; amountCents: number; currency: string; observedAt: Date;
  providerRef: string; paymentRef: string; chargeRef: string | null; payerReference: string | null; paymentLinkId: string | null;
}

const isOurs = (m: Record<string, string> | null | undefined) => !!m && (m.app == null || m.app === 'foundry') && typeof m.experiment_id === 'string' && m.experiment_id.trim() !== '';

/** The commercial facts a Stripe event carries for an experiment, or none. */
export function settlementFactsFromStripeEvent(event: { id?: string; type: string; created?: number; data?: { object?: unknown } }): SettlementFact[] {
  const o = (event.data?.object ?? {}) as StripeObject;
  const at = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000);
  const meta = o.metadata ?? null;
  if (event.type === 'payment_intent.succeeded' && o.object === 'payment_intent' && isOurs(meta)) {
    const charge = o.latest_charge;
    return [{ experimentId: meta!.experiment_id, kind: 'payment', amountCents: Number(o.amount_received ?? o.amount ?? 0), currency: String(o.currency ?? 'usd'),
      observedAt: at, providerRef: String(o.id), paymentRef: String(o.id), chargeRef: typeof charge === 'string' ? charge : (charge as StripeObject | null)?.id ?? null,
      payerReference: typeof o.receipt_email === 'string' ? o.receipt_email : null, paymentLinkId: null }];
  }
  if (event.type === 'checkout.session.completed' && o.object === 'checkout.session' && o.payment_status === 'paid' && isOurs(meta) && typeof o.payment_intent === 'string') {
    const details = o.customer_details as { email?: string | null } | null | undefined;
    return [{ experimentId: meta!.experiment_id, kind: 'payment', amountCents: Number(o.amount_total ?? 0), currency: String(o.currency ?? 'usd'),
      observedAt: at, providerRef: String(o.payment_intent), paymentRef: String(o.payment_intent), chargeRef: null,
      payerReference: details?.email ?? null, paymentLinkId: typeof o.payment_link === 'string' ? o.payment_link : null }];
  }
  if (event.type === 'charge.refunded' && o.object === 'charge' && isOurs(meta)) {
    const refunds = (o.refunds as { data?: Array<{ id: string; amount: number }> } | undefined)?.data ?? [];
    const last = refunds[refunds.length - 1];
    return [{ experimentId: meta!.experiment_id, kind: 'refund', amountCents: Number(last?.amount ?? o.amount_refunded ?? 0), currency: String(o.currency ?? 'usd'),
      observedAt: at, providerRef: last?.id ?? `${String(o.id)}:refund`, paymentRef: String(o.payment_intent ?? ''), chargeRef: String(o.id),
      payerReference: typeof o.receipt_email === 'string' ? o.receipt_email : null, paymentLinkId: null }];
  }
  return [];
}

export interface SettlementIntake { recorded: Array<{ eventId: string; kind: string; duplicate: boolean }>; refused: Array<{ providerRef: string; reason: string }> }

/**
 * Record what a verified Stripe event reveals about an experiment's exposure.
 * A payment opens what is owed; a refund closes it. Payer identity is passed
 * through to classification and never stored.
 */
export async function intakeStripeSettlement(event: { id?: string; type: string; created?: number; data?: { object?: unknown } }): Promise<SettlementIntake> {
  const result: SettlementIntake = { recorded: [], refused: [] };
  for (const fact of settlementFactsFromStripeEvent(event)) {
    const x = await exposureOf(fact.experimentId);
    if (!x) { result.refused.push({ providerRef: fact.providerRef, reason: 'the experiment has no exposure' }); continue; }
    if (x.provider !== 'stripe' || (fact.paymentLinkId && fact.paymentLinkId !== x.exposureRef)) {
      result.refused.push({ providerRef: fact.providerRef, reason: `the payment was not made at the experiment's exposure (${x.provider}:${x.exposureRef})` });
      continue;
    }
    // A PAYMENT KEEPS THE EXCHANGE IT WAS MADE UNDER. Money paid before
    // anything was received and money paid afterwards by somebody who had
    // already read the thing are different evidence about willingness to pay.
    const { exchangeOf } = await import('./probe-design-context.js');
    const ev = await recordBusinessOutcome({
      exposureId: x.id, kind: fact.kind, amountCents: fact.amountCents, currency: fact.currency.toLowerCase(), observedAt: fact.observedAt,
      provider: 'stripe', providerRef: fact.providerRef, payerReference: fact.payerReference, arrivedVia: 'payment_link',
      exchange: await exchangeOf(fact.experimentId),
    });
    if ('refused' in ev) { result.refused.push({ providerRef: fact.providerRef, reason: ev.refused }); continue; }
    result.recorded.push({ eventId: ev.id, kind: fact.kind, duplicate: ev.duplicate });
    const founderId = String(((await query('SELECT founder_id FROM experiment_exposures WHERE id = ?', [x.id])).rows[0] as Row).founder_id);
    if (fact.kind === 'payment') {
      const existing = (await query('SELECT id, charge_ref FROM experiment_fulfilments WHERE payment_event_id = ?', [ev.id])).rows[0] as Row | undefined;
      if (!existing) {
        await query(
          `INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [nanoid(), founderId, fact.experimentId, x.id, ev.id, 'stripe', fact.paymentRef, fact.chargeRef, fact.amountCents, fact.currency.toLowerCase()]);
      } else if (existing.charge_ref == null && fact.chargeRef) {
        // The intent and its session are one payment; only one of them carries the charge.
        await query(`UPDATE experiment_fulfilments SET charge_ref = ?, updated_at = datetime('now') WHERE id = ?`, [fact.chargeRef, String(existing.id)]);
      }
    } else if (fact.paymentRef) {
      await query(`UPDATE experiment_fulfilments SET status = 'refunded', refund_ref = COALESCE(refund_ref, ?), updated_at = datetime('now') WHERE experiment_id = ? AND payment_ref = ?`,
        [fact.providerRef, fact.experimentId, fact.paymentRef]);
    }
  }
  if (result.refused.length) log.warn('experiment.settlement_intake.refused', { eventType: event.type, refused: result.refused });
  return result;
}
