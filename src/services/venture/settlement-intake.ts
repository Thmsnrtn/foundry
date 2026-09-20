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
//
// THE WORLD REPORTS OUT OF ORDER, and this reads it by reference rather than
// by arrival. A refund names the payment it returns (`settlesRef`); a dispute
// names the payment or charge it contests; a declined attempt is a
// `checkout_started` that never became a payment, which is the conversion
// question's denominator and nobody's obligation. An object that carries no
// metadata of ours (a Dispute never does) is resolved to its experiment by the
// payment and charge references the fulfilment already holds. A payment that
// arrives after its own refund is closed at the row by migration 326, and
// this reports that closure rather than delivering for money already gone.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';
import { exposureOf, recordBusinessOutcome } from './outcome.js';

type Row = Record<string, unknown>;

interface StripeObject { id?: string; object?: string; metadata?: Record<string, string> | null; [k: string]: unknown }

export type SettlementKind = 'payment' | 'refund' | 'checkout_started' | 'dispute' | 'dispute_won' | 'dispute_lost';

export interface SettlementFact {
  /** Null when the object carries no metadata of ours; resolved by reference at intake. */
  experimentId: string | null; kind: SettlementKind; amountCents: number; currency: string; observedAt: Date;
  providerRef: string; paymentRef: string; chargeRef: string | null; payerReference: string | null; paymentLinkId: string | null;
  /** The payment this event is about, when it reverses or contests one. */
  settlesRef: string | null;
}

const isOurs = (m: Record<string, string> | null | undefined) => !!m && (m.app == null || m.app === 'foundry') && typeof m.experiment_id === 'string' && m.experiment_id.trim() !== '';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const refOf = (v: unknown): string | null => typeof v === 'string' ? v : (v as StripeObject | null)?.id ?? null;

/** The commercial facts a Stripe event carries for an experiment, or none. */
export function settlementFactsFromStripeEvent(event: { id?: string; type: string; created?: number; data?: { object?: unknown } }): SettlementFact[] {
  const o = (event.data?.object ?? {}) as StripeObject;
  const at = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000);
  const meta = o.metadata ?? null;
  const currency = String(o.currency ?? 'usd');
  if (event.type === 'payment_intent.succeeded' && o.object === 'payment_intent' && isOurs(meta)) {
    return [{ experimentId: meta!.experiment_id, kind: 'payment', amountCents: Number(o.amount_received ?? o.amount ?? 0), currency,
      observedAt: at, providerRef: String(o.id), paymentRef: String(o.id), chargeRef: refOf(o.latest_charge),
      payerReference: str(o.receipt_email), paymentLinkId: str(meta!.payment_link), settlesRef: null }];
  }
  if (event.type === 'checkout.session.completed' && o.object === 'checkout.session' && o.payment_status === 'paid' && isOurs(meta) && typeof o.payment_intent === 'string') {
    const details = o.customer_details as { email?: string | null } | null | undefined;
    return [{ experimentId: meta!.experiment_id, kind: 'payment', amountCents: Number(o.amount_total ?? 0), currency,
      observedAt: at, providerRef: String(o.payment_intent), paymentRef: String(o.payment_intent), chargeRef: null,
      payerReference: details?.email ?? null, paymentLinkId: str(o.payment_link), settlesRef: null }];
  }
  // SOMEBODY BEGAN TO PAY AND WAS DECLINED. Not a payment, not an obligation,
  // not an invalidity: the denominator of the conversion question. One row
  // per intent; a second attempt on the same intent is the same beginning.
  if (event.type === 'payment_intent.payment_failed' && o.object === 'payment_intent' && isOurs(meta)) {
    const err = o.last_payment_error as { charge?: string | null } | null | undefined;
    return [{ experimentId: meta!.experiment_id, kind: 'checkout_started', amountCents: Number(o.amount ?? 0), currency,
      observedAt: at, providerRef: `${String(o.id)}:declined`, paymentRef: String(o.id), chargeRef: str(err?.charge),
      payerReference: str(o.receipt_email), paymentLinkId: str(meta!.payment_link), settlesRef: null }];
  }
  if (event.type === 'charge.refunded' && o.object === 'charge' && isOurs(meta)) {
    const refunds = (o.refunds as { data?: Array<{ id: string; amount: number }> } | undefined)?.data ?? [];
    const last = refunds[refunds.length - 1];
    const paymentRef = String(o.payment_intent ?? '');
    return [{ experimentId: meta!.experiment_id, kind: 'refund', amountCents: Number(last?.amount ?? o.amount_refunded ?? 0), currency,
      observedAt: at, providerRef: last?.id ?? `${String(o.id)}:refund`, paymentRef, chargeRef: String(o.id),
      payerReference: str(o.receipt_email), paymentLinkId: null, settlesRef: paymentRef || String(o.id) }];
  }
  // A DISPUTE CARRIES NO METADATA OF OURS: a Dispute's metadata is its own,
  // never copied from the charge. It names the charge and the intent, and
  // that is how it finds the experiment.
  if (o.object === 'dispute' && (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed')) {
    const paymentRef = str(o.payment_intent) ?? '';
    const chargeRef = refOf(o.charge);
    const base = { experimentId: isOurs(meta) ? meta!.experiment_id : null, amountCents: Number(o.amount ?? 0), currency, observedAt: at,
      paymentRef, chargeRef, payerReference: null, paymentLinkId: null, settlesRef: paymentRef || chargeRef };
    if (event.type === 'charge.dispute.created') return [{ ...base, kind: 'dispute', providerRef: String(o.id) }];
    const status = String(o.status ?? '');
    if (status === 'won' || status === 'warning_closed') return [{ ...base, kind: 'dispute_won', providerRef: `${String(o.id)}:won` }];
    if (status === 'lost') return [{ ...base, kind: 'dispute_lost', providerRef: `${String(o.id)}:lost` }];
    return [];
  }
  return [];
}

export interface SettlementIntake {
  recorded: Array<{ eventId: string; kind: string; duplicate: boolean;
    /** The fulfilment this fact opened or changed, and how it stands now. */
    fulfilment?: { id: string; status: string; closedOnArrival: boolean; disputed: boolean };
    /** A payment accepted on its tag alone, because the intent names no link. */
    linkUnread?: boolean }>;
  refused: Array<{ providerRef: string; reason: string }>;
}

/** The experiment a reference belongs to, from what is already owed. */
async function experimentByReference(refs: Array<string | null>): Promise<string | null> {
  const known = refs.filter((r): r is string => !!r);
  if (!known.length) return null;
  const marks = known.map(() => '?').join(',');
  const r = (await query(`SELECT experiment_id FROM experiment_fulfilments WHERE payment_ref IN (${marks}) OR charge_ref IN (${marks}) LIMIT 1`, [...known, ...known])).rows[0] as Row | undefined;
  return r ? String(r.experiment_id) : null;
}

/**
 * Record what a verified Stripe event reveals about an experiment's exposure.
 * A payment opens what is owed; a refund closes it; a dispute suspends it and
 * its outcome resumes or closes it. Payer identity is passed through to
 * classification and never stored. Every write is idempotent on the
 * provider's references, so a redelivered event changes nothing.
 */
export async function intakeStripeSettlement(event: { id?: string; type: string; created?: number; data?: { object?: unknown } }): Promise<SettlementIntake> {
  const result: SettlementIntake = { recorded: [], refused: [] };
  for (const fact of settlementFactsFromStripeEvent(event)) {
    const experimentId = fact.experimentId ?? await experimentByReference([fact.paymentRef, fact.chargeRef]);
    if (!experimentId) { result.refused.push({ providerRef: fact.providerRef, reason: 'no purchase of ours matches this reference' }); continue; }
    const x = await exposureOf(experimentId);
    if (!x) { result.refused.push({ providerRef: fact.providerRef, reason: 'the experiment has no exposure' }); continue; }
    if (x.provider !== 'stripe' || (fact.paymentLinkId && fact.paymentLinkId !== x.exposureRef)) {
      result.refused.push({ providerRef: fact.providerRef, reason: `the payment was not made at the experiment's exposure (${x.provider}:${x.exposureRef})` });
      continue;
    }
    const founderId = String(((await query('SELECT founder_id FROM experiment_exposures WHERE id = ?', [x.id])).rows[0] as Row).founder_id);

    // THE OUTCOME OF A DISPUTE is a state of the obligation, not a new event:
    // `reversed` already counts the dispute itself, and a lost one is not a
    // second refund. Won, the row resumes; lost, the money is gone and the
    // row closes as refunded with the dispute as its reference.
    if (fact.kind === 'dispute_won' || fact.kind === 'dispute_lost') {
      const disputeId = fact.providerRef.replace(/:(won|lost)$/, '');
      const rows = (await query(`SELECT id, dispute_outcome FROM experiment_fulfilments WHERE experiment_id = ? AND (payment_ref = ? OR charge_ref = ?)`,
        [experimentId, fact.paymentRef, fact.chargeRef ?? ''])).rows as unknown as Row[];
      if (!rows.length) { result.refused.push({ providerRef: fact.providerRef, reason: 'no purchase of ours matches this dispute' }); continue; }
      for (const f of rows) {
        const duplicate = f.dispute_outcome != null;
        if (!duplicate) {
          await query(`UPDATE experiment_fulfilments SET disputed_at = COALESCE(disputed_at, ?), updated_at = datetime('now') WHERE id = ?`, [fact.observedAt.toISOString(), String(f.id)]);
          if (fact.kind === 'dispute_won') await query(`UPDATE experiment_fulfilments SET dispute_outcome = 'won', updated_at = datetime('now') WHERE id = ? AND dispute_outcome IS NULL`, [String(f.id)]);
          else await query(`UPDATE experiment_fulfilments SET dispute_outcome = 'lost', status = 'refunded', refund_ref = COALESCE(refund_ref, ?), updated_at = datetime('now') WHERE id = ? AND dispute_outcome IS NULL`, [disputeId, String(f.id)]);
        }
        const now = (await query('SELECT status, disputed_at, dispute_outcome FROM experiment_fulfilments WHERE id = ?', [String(f.id)])).rows[0] as Row;
        result.recorded.push({ eventId: disputeId, kind: fact.kind, duplicate,
          fulfilment: { id: String(f.id), status: String(now.status), closedOnArrival: false, disputed: now.disputed_at != null && now.dispute_outcome == null } });
      }
      continue;
    }

    // A PAYMENT KEEPS THE EXCHANGE IT WAS MADE UNDER. Money paid before
    // anything was received and money paid afterwards by somebody who had
    // already read the thing are different evidence about willingness to pay.
    const { exchangeOf } = await import('./probe-design-context.js');
    const ev = await recordBusinessOutcome({
      exposureId: x.id, kind: fact.kind, amountCents: fact.amountCents, currency: fact.currency.toLowerCase(), observedAt: fact.observedAt,
      provider: 'stripe', providerRef: fact.providerRef, payerReference: fact.payerReference, arrivedVia: 'payment_link',
      exchange: await exchangeOf(experimentId), settlesRef: fact.settlesRef,
    });
    if ('refused' in ev) { result.refused.push({ providerRef: fact.providerRef, reason: ev.refused }); continue; }
    const entry: SettlementIntake['recorded'][number] = { eventId: ev.id, kind: fact.kind, duplicate: ev.duplicate };
    if (fact.kind === 'payment') {
      if (fact.paymentLinkId == null) entry.linkUnread = true;
      const existing = (await query('SELECT id, charge_ref FROM experiment_fulfilments WHERE payment_event_id = ?', [ev.id])).rows[0] as Row | undefined;
      let id = existing ? String(existing.id) : nanoid();
      if (!existing) {
        await query(
          `INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, founderId, experimentId, x.id, ev.id, 'stripe', fact.paymentRef, fact.chargeRef, fact.amountCents, fact.currency.toLowerCase()]);
      } else if (existing.charge_ref == null && fact.chargeRef) {
        // The intent and its session are one payment; only one of them carries the charge.
        await query(`UPDATE experiment_fulfilments SET charge_ref = ?, updated_at = datetime('now') WHERE id = ?`, [fact.chargeRef, id]);
      }
      // Read back what the row guard made of it: a refund or dispute that
      // arrived first has already closed or marked the row.
      const now = (await query('SELECT id, status, refund_ref, disputed_at, dispute_outcome FROM experiment_fulfilments WHERE id = ?', [id])).rows[0] as Row;
      id = String(now.id);
      entry.fulfilment = { id, status: String(now.status), closedOnArrival: !existing && String(now.status) === 'refunded',
        disputed: now.disputed_at != null && now.dispute_outcome == null };
    } else if (fact.kind === 'refund') {
      // The refund after its payment closes the row; before it, the row
      // guard closes the row at birth from the event recorded above.
      await query(`UPDATE experiment_fulfilments SET status = 'refunded', refund_ref = COALESCE(refund_ref, ?), updated_at = datetime('now')
                    WHERE experiment_id = ? AND (payment_ref = ? OR (charge_ref IS NOT NULL AND charge_ref = ?)) AND status <> 'refunded'`,
        [fact.providerRef, experimentId, fact.paymentRef, fact.chargeRef ?? '']);
      const f = (await query('SELECT id, status FROM experiment_fulfilments WHERE experiment_id = ? AND (payment_ref = ? OR (charge_ref IS NOT NULL AND charge_ref = ?)) LIMIT 1',
        [experimentId, fact.paymentRef, fact.chargeRef ?? ''])).rows[0] as Row | undefined;
      if (f) entry.fulfilment = { id: String(f.id), status: String(f.status), closedOnArrival: false, disputed: false };
    } else if (fact.kind === 'dispute') {
      await query(`UPDATE experiment_fulfilments SET disputed_at = COALESCE(disputed_at, ?), updated_at = datetime('now')
                    WHERE experiment_id = ? AND (payment_ref = ? OR (charge_ref IS NOT NULL AND charge_ref = ?))`,
        [fact.observedAt.toISOString(), experimentId, fact.paymentRef, fact.chargeRef ?? '']);
      const f = (await query('SELECT id, status, disputed_at, dispute_outcome FROM experiment_fulfilments WHERE experiment_id = ? AND (payment_ref = ? OR (charge_ref IS NOT NULL AND charge_ref = ?)) LIMIT 1',
        [experimentId, fact.paymentRef, fact.chargeRef ?? ''])).rows[0] as Row | undefined;
      if (f) entry.fulfilment = { id: String(f.id), status: String(f.status), closedOnArrival: false, disputed: f.disputed_at != null && f.dispute_outcome == null };
    }
    result.recorded.push(entry);
  }
  if (result.refused.length) log.warn('experiment.settlement_intake.refused', { eventType: event.type, refused: result.refused });
  return result;
}
