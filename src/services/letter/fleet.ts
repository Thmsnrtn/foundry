// =============================================================================
// FOUNDRY — The Fleet Letter (Jarvis slice 1 / One Letter)
//
// A portfolio operator gets ONE artifact, not N letters. Composition:
//   - per-product Letters reuse composeLetter verbatim (deterministic ledger
//     reads — no model call, no fabrication)
//   - the cross-fleet "needs you" is ranked from STRUCTURED ledger rows
//     (gate × risk × deadline × operator attention memory), each item
//     carrying provenance (decision id) so the independent verifier can
//     re-check it against a FRESH read before anything is delivered.
// Ranking beats recency: the one thing on top should be the thing a good
// chief of staff would put on top.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { composeLetter, type Letter } from './composer.js';
import type { Fluency } from '../ux/fluency.js';

export interface FleetNeedsYou {
  decisionId: string;
  productId: string;
  productName: string;
  what: string;
  gate: number;
  riskState: string;
  deadline: string | null;
  score: number;
}

export interface FleetProductLetter {
  productId: string;
  productName: string;
  riskState: string;
  letter: Letter;
}

export interface FleetLetter {
  founderId: string;
  composedAt: string;
  products: FleetProductLetter[];
  /** Ranked across the whole fleet — [0] is THE one thing. */
  needsYou: FleetNeedsYou[];
  quiet: boolean;
}

const RISK_WEIGHT: Record<string, number> = { red: 15, yellow: 7, green: 0 };
const MAX_NEEDS_YOU = 5;

function deadlineUrgency(deadline: string | null): number {
  if (!deadline) return 0;
  const dt = new Date(deadline).getTime();
  if (Number.isNaN(dt)) return 0;
  const hours = (dt - Date.now()) / 3_600_000;
  if (hours <= 48) return 10; // overdue or imminent
  if (hours <= 24 * 7) return 5;
  return 2;
}

/** Attention memory (admission-controlled: explicit founder reactions only).
 *  A product whose surfaced items the founder consistently acts on ranks up;
 *  consistent dismissal ranks it down. Bounded ±5 so facts still dominate. */
async function attentionAdjustment(founderId: string, productId: string): Promise<number> {
  const r = await query(
    `SELECT reaction, COUNT(*) as n FROM operator_attention
     WHERE founder_id = ? AND product_id = ?
       AND created_at >= datetime('now', '-30 days')
     GROUP BY reaction`,
    [founderId, productId],
  );
  let acted = 0, dismissed = 0;
  for (const row of r.rows as unknown as Array<Record<string, unknown>>) {
    if (row.reaction === 'acted') acted = Number(row.n);
    if (row.reaction === 'dismissed') dismissed = Number(row.n);
  }
  const total = acted + dismissed;
  if (total < 3) return 0; // not enough explicit signal — no adjustment
  return Math.max(-5, Math.min(5, Math.round(((acted - dismissed) / total) * 5)));
}

export async function composeFleetLetter(founderId: string, f: Fluency = 'balanced'): Promise<FleetLetter> {
  const products = (await query(
    `SELECT p.id, p.name, COALESCE(ls.risk_state, 'green') as risk_state
       FROM products p LEFT JOIN lifecycle_state ls ON ls.product_id = p.id
      WHERE p.owner_id = ? AND p.status != 'archived'
      ORDER BY p.created_at ASC`,
    [founderId],
  )).rows as unknown as Array<Record<string, string>>;

  const letters: FleetProductLetter[] = await Promise.all(
    products.map(async (p) => ({
      productId: p.id,
      productName: p.name,
      riskState: p.risk_state,
      letter: await composeLetter(p.id, f),
    })),
  );

  // Structured cross-fleet ranking — provenance-carrying, verifier-checkable.
  const pending = (await query(
    `SELECT d.id, d.product_id, d.what, d.gate, d.deadline, p.name as product_name,
            COALESCE(ls.risk_state, 'green') as risk_state
       FROM decisions d
       JOIN products p ON p.id = d.product_id
       LEFT JOIN lifecycle_state ls ON ls.product_id = d.product_id
      WHERE p.owner_id = ? AND d.status = 'pending' AND p.status != 'archived'
      ORDER BY d.created_at ASC LIMIT 50`,
    [founderId],
  )).rows as unknown as Array<Record<string, unknown>>;

  const adjustments = new Map<string, number>();
  for (const p of products) adjustments.set(p.id, await attentionAdjustment(founderId, p.id));

  const needsYou: FleetNeedsYou[] = pending
    .map((d) => {
      const gate = Number(d.gate ?? 0);
      const risk = String(d.risk_state);
      const deadline = (d.deadline as string) ?? null;
      return {
        decisionId: String(d.id),
        productId: String(d.product_id),
        productName: String(d.product_name),
        what: String(d.what),
        gate,
        riskState: risk,
        deadline,
        score: gate * 10 + (RISK_WEIGHT[risk] ?? 0) + deadlineUrgency(deadline)
          + (adjustments.get(String(d.product_id)) ?? 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NEEDS_YOU);

  const quiet = needsYou.length === 0 && letters.every((l) => l.letter.quiet);
  return {
    founderId,
    composedAt: new Date().toISOString(),
    products: letters,
    needsYou,
    quiet,
  };
}

/** Admission-controlled memory write: only explicit founder reactions,
 *  only for items that were actually surfaced (item_ref = decision id). */
export async function recordAttention(
  founderId: string,
  productId: string,
  itemRef: string,
  reaction: 'opened' | 'acted' | 'dismissed',
): Promise<void> {
  // The item must be a real decision on a product this founder owns —
  // attention memory never stores unverifiable references.
  const owns = await query(
    `SELECT d.id FROM decisions d JOIN products p ON p.id = d.product_id
      WHERE d.id = ? AND d.product_id = ? AND p.owner_id = ?`,
    [itemRef, productId, founderId],
  );
  if (owns.rows.length === 0) return;
  await query(
    `INSERT INTO operator_attention (id, founder_id, product_id, item_kind, item_ref, reaction)
     VALUES (?, ?, ?, 'needs_you', ?, ?)`,
    [nanoid(), founderId, productId, itemRef, reaction],
  );
}
