// =============================================================================
// FOUNDRY — Fleet Letter Verifier (Jarvis slice 1 — the reliability keystone)
//
// An INDEPENDENT pass between composition and delivery. The verifier trusts
// nothing the composer said: for every ranked "needs you" item it re-fetches
// the decision FRESH and checks explicit success criteria:
//   1. the decision exists,
//   2. it is still pending (not resolved between compose and deliver),
//   3. it belongs to the named product, and that product to this founder
//      (tenant safety at the last line of defense),
//   4. the stated gate matches the ledger,
//   5. the letter is fresh (composed within the staleness window).
// A line that fails is DROPPED and logged as a defect (audit_log,
// action_type 'letter:verifier') — the founder never sees an unverified
// claim, and every drop is queryable ("why didn't you show me X?").
// =============================================================================

import { nanoid } from 'nanoid';
import { query, insertAuditLog } from '../../db/client.js';
import type { FleetLetter, FleetNeedsYou } from './fleet.js';
import { getSevenDayResponsibilitySummary } from '../institution/absence-summary.js';

const STALENESS_MS = 5 * 60_000;

export interface VerificationResult {
  letter: FleetLetter;      // the verified letter (failed items removed)
  checked: number;
  dropped: number;
  reasons: string[];        // one per dropped item, for the audit trail
}

async function verifyNeedsYou(item: FleetNeedsYou, founderId: string): Promise<string | null> {
  const fresh = (await query(
    `SELECT d.status, d.gate, d.product_id, p.owner_id
       FROM decisions d JOIN products p ON p.id = d.product_id
      WHERE d.id = ?`,
    [item.decisionId],
  )).rows[0] as Record<string, unknown> | undefined;

  if (!fresh) return `decision ${item.decisionId} not found in ledger`;
  if (String(fresh.owner_id) !== founderId) return `decision ${item.decisionId} belongs to another tenant`;
  if (String(fresh.product_id) !== item.productId) return `decision ${item.decisionId} product mismatch`;
  if (String(fresh.status) !== 'pending') return `decision ${item.decisionId} no longer pending (${fresh.status})`;
  if (Number(fresh.gate ?? 0) !== item.gate) return `decision ${item.decisionId} gate mismatch (letter says ${item.gate}, ledger says ${fresh.gate})`;
  return null;
}

export async function verifyFleetLetter(letter: FleetLetter): Promise<VerificationResult> {
  const reasons: string[] = [];

  // Success criterion 5: freshness — a stale composition must not ship.
  const age = Date.now() - new Date(letter.composedAt).getTime();
  if (!Number.isFinite(age) || age > STALENESS_MS) {
    reasons.push(`letter stale (composed ${letter.composedAt}) — recompose before delivery`);
    await logDefects(letter.founderId, reasons);
    return {
      letter: { ...letter, needsYou: [], products: [], quiet: true },
      checked: 0, dropped: letter.needsYou.length, reasons,
    };
  }

  const verified: FleetNeedsYou[] = [];
  for (const item of letter.needsYou) {
    const failure = await verifyNeedsYou(item, letter.founderId);
    if (failure) reasons.push(failure);
    else verified.push(item);
  }

  // Tenant check on the per-product letters too — no product that isn't
  // the founder's may appear, whatever the composer thought.
  const owned = new Set(
    ((await query('SELECT id FROM products WHERE owner_id = ?', [letter.founderId]))
      .rows as unknown as Array<Record<string, string>>).map((r) => String(r.id)),
  );
  const products = letter.products.filter((p) => {
    if (owned.has(p.productId)) return true;
    reasons.push(`product ${p.productId} belongs to another tenant — removed`);
    return false;
  });
  // Responsibility classifications are independently reconstructed from the
  // canonical product-scoped ledgers. Composer-provided classifications are
  // never delivered on trust.
  for (const product of products) {
    product.responsibilities = await getSevenDayResponsibilitySummary(product.productId);
  }

  if (reasons.length > 0) await logDefects(letter.founderId, reasons);

  return {
    letter: { ...letter, needsYou: verified, products, quiet: verified.length === 0 && products.every((p) =>
      p.letter.quiet && Object.values(p.responsibilities).every((items) => items.length === 0)
    ) },
    checked: letter.needsYou.length,
    dropped: letter.needsYou.length - verified.length,
    reasons,
  };
}

async function logDefects(founderId: string, reasons: string[]): Promise<void> {
  try {
    // audit_log.product_id has a FK to products — anchor fleet-level defects
    // to one of the founder's real products (any one; the trigger field
    // carries the fleet/founder identity for querying).
    const anchor = (await query(
      'SELECT id FROM products WHERE owner_id = ? LIMIT 1', [founderId],
    )).rows[0] as Record<string, string> | undefined;
    if (!anchor) return; // no products → nothing the letter could have claimed
    await insertAuditLog({
      id: nanoid(),
      product_id: String(anchor.id),
      action_type: 'letter:verifier',
      gate: 0,
      trigger: `fleet_letter/${founderId}`,
      reasoning: reasons.join(' | '),
      input_context: JSON.stringify({ founder_id: founderId, dropped: reasons.length }),
      output: undefined,
      outcome: 'refused',
    });
  } catch { /* verifier logging must never block delivery of verified content */ }
}
