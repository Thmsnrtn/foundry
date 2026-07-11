// =============================================================================
// FOUNDRY — Envelopes (Hands Law / Constitution Law 10)
//
// Grants bound WHAT the hands may touch; envelopes bound HOW MUCH per week
// without asking; the trust ladder bounds what the autopilot may DECIDE.
// Freedom inside a budget — the way humans delegate to humans. Consumption
// is insert-or-increment on a per-ISO-week row (race-safe on the UNIQUE key,
// same discipline as communication_budgets).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export interface EnvelopeCheck {
  allowed: boolean;
  used: number;
  cap: number;
  remaining: number;
}

/** Default weekly caps by scope class. Generous but finite — a runaway loop
 *  hits the wall the same week it starts, not on the invoice. */
const DEFAULT_CAPS: Array<{ prefix: string; cap: number }> = [
  { prefix: 'mcp:', cap: 100 },
  { prefix: 'dept:', cap: 10 }, // department actions start deliberately small
];
const FALLBACK_CAP = 50;

export function defaultCap(scope: string): number {
  return DEFAULT_CAPS.find((d) => scope.startsWith(d.prefix))?.cap ?? FALLBACK_CAP;
}

/** ISO date of the Monday of the week containing `now`. */
export function weekStarting(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function getCap(productId: string, scope: string): Promise<number> {
  const r = await query(
    'SELECT weekly_cap FROM envelopes WHERE product_id = ? AND scope = ?',
    [productId, scope],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.weekly_cap) : defaultCap(scope);
}

export async function setCap(productId: string, scope: string, weeklyCap: number): Promise<void> {
  const cap = Math.min(Math.max(Math.floor(weeklyCap), 0), 100_000);
  await query(
    `INSERT INTO envelopes (id, product_id, scope, weekly_cap)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id, scope) DO UPDATE SET weekly_cap = excluded.weekly_cap, updated_at = CURRENT_TIMESTAMP`,
    [nanoid(), productId, scope, cap],
  );
}

export async function getUsage(productId: string, scope: string, week = weekStarting()): Promise<number> {
  const r = await query(
    'SELECT used_count FROM envelope_usage WHERE product_id = ? AND scope = ? AND week_starting = ?',
    [productId, scope, week],
  );
  return Number((r.rows[0] as Record<string, unknown> | undefined)?.used_count ?? 0);
}

/** If under this week's cap, consume one unit and allow; else refuse without
 *  consuming. Race-safe: first-of-week insert falls back to increment on the
 *  UNIQUE conflict. */
export async function checkAndConsume(productId: string, scope: string): Promise<EnvelopeCheck> {
  const cap = await getCap(productId, scope);
  const week = weekStarting();
  const used = await getUsage(productId, scope, week);
  if (used >= cap) return { allowed: false, used, cap, remaining: 0 };

  try {
    await query(
      `INSERT INTO envelope_usage (id, product_id, scope, week_starting, used_count)
       VALUES (?, ?, ?, ?, 1)`,
      [nanoid(), productId, scope, week],
    );
    return { allowed: true, used: 1, cap, remaining: cap - 1 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/UNIQUE constraint failed|unique constraint/i.test(msg)) throw err;
  }
  // Row exists — guarded increment; 0 rows changed means a racer filled the cap.
  const res = await query(
    `UPDATE envelope_usage SET used_count = used_count + 1, updated_at = CURRENT_TIMESTAMP
     WHERE product_id = ? AND scope = ? AND week_starting = ? AND used_count < ?`,
    [productId, scope, week, cap],
  );
  const changed = Number((res as unknown as { rowsAffected?: number }).rowsAffected ?? 1);
  const nowUsed = await getUsage(productId, scope, week);
  return changed > 0
    ? { allowed: true, used: nowUsed, cap, remaining: Math.max(0, cap - nowUsed) }
    : { allowed: false, used: nowUsed, cap, remaining: 0 };
}
