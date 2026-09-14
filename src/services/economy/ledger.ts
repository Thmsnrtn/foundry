// =============================================================================
// FOUNDRY — the economic ledger, and what may be written into it
//
// One append-only table records everything that happens to money, and every
// row names the provider statement it came from. This module is the only way
// in. It exists so that three rules hold at the write site rather than being
// remembered at each call:
//
//   IDEMPOTENT BY THE PROVIDER'S OWN REFERENCE. A webhook is delivered more
//   than once as a matter of course, and a retried job must not double a fee.
//   `(provider, provider_ref, kind)` is unique in the schema; recording the
//   same fact twice returns `duplicate` rather than failing.
//
//   NOTHING IS INVENTED. There is no function here that takes a percentage and
//   produces a fee. If the provider has not said what it took, no row is
//   written, and the projection says the figure is unavailable — which is a
//   different thing from zero and is displayed differently.
//
//   AN ESTIMATE CARRIES ITS ASSUMPTION. The one estimated kind is the tax
//   reserve, and it cannot be written without the policy row that produced it.
//   The schema refuses it; this module makes it awkward to try.
//
// No model ever calls anything here.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type EconomicKind =
  | 'charge' | 'provider_fee' | 'unit_cost' | 'refund' | 'refund_fee_returned'
  | 'dispute_withdrawal' | 'dispute_fee' | 'payout' | 'payout_reversed'
  | 'operating_spend' | 'owner_contribution' | 'owner_distribution';

export type EvidenceMode = 'real' | 'sandbox' | 'reference';

export interface LedgerWrite {
  founderId: string;
  kind: EconomicKind;
  amountCents: number;
  currency?: string;
  occurredAt: Date | string;
  provider: string;
  providerRef: string;
  sourceEventId?: string | null;
  fulfilmentId?: string | null;
  claimQuality?: 'measured' | 'estimated';
  policyId?: string | null;
  evidenceMode: EvidenceMode;
  because: string;
}

export interface LedgerResult { id: string; duplicate: boolean }

const iso = (d: Date | string): string =>
  typeof d === 'string' ? d : d.toISOString().replace('T', ' ').slice(0, 19);

/**
 * Write one economic fact. Returns the existing row's id when the provider has
 * told us this same thing before.
 */
export async function record(w: LedgerWrite): Promise<LedgerResult> {
  if (!Number.isInteger(w.amountCents) || w.amountCents < 0) {
    throw new Error(`economic_event:amount_must_be_a_whole_number_of_cents (${w.amountCents})`);
  }
  const existing = await query(
    `SELECT id FROM economic_events WHERE provider = ? AND provider_ref = ? AND kind = ?`,
    [w.provider, w.providerRef, w.kind]);
  if (existing.rows.length > 0) {
    return { id: (existing.rows[0] as Record<string, string>).id, duplicate: true };
  }
  const id = nanoid();
  await query(
    `INSERT INTO economic_events
       (id, founder_id, kind, amount_cents, currency, occurred_at, provider, provider_ref,
        source_event_id, fulfilment_id, claim_quality, policy_id, evidence_mode, because)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, w.founderId, w.kind, w.amountCents, w.currency ?? 'usd', iso(w.occurredAt),
      w.provider, w.providerRef, w.sourceEventId ?? null, w.fulfilmentId ?? null,
      w.claimQuality ?? 'measured', w.policyId ?? null, w.evidenceMode, w.because]);
  return { id, duplicate: false };
}

// ─── The assumptions ─────────────────────────────────────────────────────────

export interface Policy {
  id: string;
  founderId: string;
  kind: 'tax_reserve' | 'operating_reserve';
  rateBps: number | null;
  amountCents: number | null;
  basis: 'contribution' | 'gross_receipts' | null;
  source: string;
  because: string;
  setBy: string;
  setAt: string;
}

/**
 * The assumption in force, or none. Nothing falls back to a default rate: an
 * institution with no stated tax assumption has not made one, and the surface
 * says so rather than quietly holding back 30% of something.
 */
export async function policyInForce(founderId: string, kind: Policy['kind']): Promise<Policy | null> {
  const r = await query(
    `SELECT id, founder_id, kind, rate_bps, amount_cents, basis, source, because, set_by, set_at
       FROM economic_policies WHERE founder_id = ? AND kind = ? AND superseded_at IS NULL
      ORDER BY set_at DESC LIMIT 1`, [founderId, kind]);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    founderId: row.founder_id as string,
    kind: row.kind as Policy['kind'],
    rateBps: row.rate_bps === null ? null : Number(row.rate_bps),
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    basis: (row.basis as Policy['basis']) ?? null,
    source: row.source as string,
    because: row.because as string,
    setBy: row.set_by as string,
    setAt: String(row.set_at),
  };
}

/**
 * Record an assumption, superseding whatever stood before it. Supersession
 * rather than update: what the institution believed in March is part of why it
 * held back what it held back, and a reserve computed under an old rate must
 * stay explicable.
 */
export async function setPolicy(input: {
  founderId: string;
  kind: Policy['kind'];
  rateBps?: number | null;
  amountCents?: number | null;
  basis?: Policy['basis'];
  source: string;
  because: string;
  setBy: string;
}): Promise<string> {
  if (!input.source.trim() || !input.because.trim()) {
    throw new Error('economic_policy:an_assumption_must_say_where_it_came_from');
  }
  if (input.kind === 'tax_reserve' && (input.rateBps == null || input.basis == null)) {
    throw new Error('economic_policy:a_tax_reserve_needs_a_rate_and_a_basis');
  }
  if (input.kind === 'operating_reserve' && input.amountCents == null) {
    throw new Error('economic_policy:an_operating_reserve_needs_a_floor');
  }
  const id = nanoid();
  const prior = await policyInForce(input.founderId, input.kind);
  await query(
    `INSERT INTO economic_policies (id, founder_id, kind, rate_bps, amount_cents, basis, source, because, set_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.kind, input.rateBps ?? null, input.amountCents ?? null,
      input.basis ?? null, input.source, input.because, input.setBy]);
  if (prior) {
    await query(
      `UPDATE economic_policies SET superseded_at = datetime('now'), superseded_by = ? WHERE id = ?`,
      [id, prior.id]);
  }
  return id;
}
