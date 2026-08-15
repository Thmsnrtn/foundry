import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type SpendScope = { scope: 'global' | 'product' | 'founder'; id: string; capCents: number };

export class SpendCeilingError extends Error {
  constructor(public readonly scope: SpendScope['scope']) {
    super(`AI daily cost ceiling reached (${scope})`);
    this.name = 'SpendCeilingError';
  }
}

export interface SpendReservation { id: string; amountCents: number; scopes: SpendScope[] }

export async function reserveSpend(input: {
  productId?: string; founderId?: string; model: string; amountCents: number;
  caps: { global: number; product: number; founder: number }; ttlMs?: number;
}): Promise<SpendReservation> {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  // Lost provider responses remain ambiguous until expiry, then count at the
  // full authorized amount. This is conservative reconciliation, never a
  // fail-open release.
  await query(
    `UPDATE ai_spend_reservations SET status = 'expired', actual_cents = reserved_cents, updated_at = ?
     WHERE status = 'ambiguous' AND expires_at <= ?`, [now, now]);
  const id = nanoid();
  try {
    await query(
      `INSERT INTO ai_spend_reservations
       (id, product_id, founder_id, date, model, reserved_cents, global_cap_cents,
        product_cap_cents, founder_cap_cents, status, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`,
      [id, input.productId ?? null, input.founderId ?? null, date, input.model, input.amountCents,
        input.caps.global, input.productId ? input.caps.product : null,
        input.founderId ? input.caps.founder : null, now, now,
        new Date(Date.now() + (input.ttlMs ?? 15 * 60_000)).toISOString()]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/ai_spend_ceiling:(global|product|founder)/);
    if (match) throw new SpendCeilingError(match[1] as SpendScope['scope']);
    throw error;
  }
  const scopes: SpendScope[] = [
    { scope: 'global', id: '__global__', capCents: input.caps.global },
    ...(input.productId ? [{ scope: 'product' as const, id: input.productId, capCents: input.caps.product }] : []),
    ...(input.founderId ? [{ scope: 'founder' as const, id: input.founderId, capCents: input.caps.founder }] : []),
  ];
  return { id, amountCents: input.amountCents, scopes };
}

export async function finishReservation(
  reservation: SpendReservation,
  outcome: { kind: 'settled'; actualCents: number } | { kind: 'released' | 'ambiguous' },
): Promise<void> {
  await query(
    `UPDATE ai_spend_reservations SET status = ?, actual_cents = ?, updated_at = ?
     WHERE id = ? AND status = 'reserved'`,
    [outcome.kind, outcome.kind === 'settled' ? outcome.actualCents : null,
      new Date().toISOString(), reservation.id]);
}
