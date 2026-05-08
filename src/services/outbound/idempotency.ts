// =============================================================================
// FOUNDRY — Outbound Idempotency (V3.1 Layer C)
// At-most-once dedup for outbound actions keyed on (product, action_type,
// dedup_key). Used by the tool gateway. Distinct from webhook_idempotency
// which dedups inbound webhook event ids.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReserveResult {
  /** True iff this call inserted the row (caller must do the work). */
  fresh: boolean;
  /** Cached result from a prior successful call, or null. */
  cached: unknown | null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reserve an idempotency key. If new, inserts and returns fresh=true.
 * If a non-expired row already exists, returns fresh=false with the cached
 * result_json (or null if the prior call has not yet stored one).
 *
 * Race-safe: relies on the UNIQUE(product_id, action_type, dedup_key) index.
 * On constraint conflict, retries the read and returns the existing row.
 */
export async function checkAndReserve(
  productId: string,
  actionType: string,
  dedupKey: string,
  ttlSeconds: number,
  agentId?: string | null
): Promise<ReserveResult> {
  const existing = await loadActive(productId, actionType, dedupKey);
  if (existing) {
    return { fresh: false, cached: parseResult(existing.result_json) };
  }

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Clear any expired row that would otherwise block the UNIQUE index.
  await query(
    `DELETE FROM idempotency_keys
       WHERE product_id = ? AND action_type = ? AND dedup_key = ?
         AND datetime(expires_at) <= datetime('now')`,
    [productId, actionType, dedupKey]
  );

  try {
    await query(
      `INSERT INTO idempotency_keys (id, product_id, agent_id, action_type, dedup_key, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, agentId ?? null, actionType, dedupKey, expiresAt]
    );
    return { fresh: true, cached: null };
  } catch (err) {
    // Race: another caller inserted between our read and write. Re-read.
    if (isUniqueConflict(err)) {
      const racer = await loadActive(productId, actionType, dedupKey);
      if (racer) return { fresh: false, cached: parseResult(racer.result_json) };
    }
    throw err;
  }
}

/**
 * Persist the result of a fresh reservation so subsequent calls within TTL
 * return the cached payload. Called by the gateway after a successful
 * underlying invocation.
 */
export async function storeResult(
  productId: string,
  actionType: string,
  dedupKey: string,
  result: unknown
): Promise<void> {
  await query(
    `UPDATE idempotency_keys
       SET result_json = ?
     WHERE product_id = ? AND action_type = ? AND dedup_key = ?`,
    [JSON.stringify(result ?? null), productId, actionType, dedupKey]
  );
}

/**
 * Delete expired rows. Called by the daily cron.
 */
export async function cleanupExpired(): Promise<number> {
  const result = await query(
    `DELETE FROM idempotency_keys WHERE datetime(expires_at) <= datetime('now')`
  );
  return Number((result as unknown as { rowsAffected?: number }).rowsAffected ?? 0);
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface IdempotencyRow {
  result_json: string | null;
  expires_at: string;
}

async function loadActive(
  productId: string,
  actionType: string,
  dedupKey: string
): Promise<IdempotencyRow | null> {
  const result = await query(
    `SELECT result_json, expires_at FROM idempotency_keys
      WHERE product_id = ? AND action_type = ? AND dedup_key = ?
        AND datetime(expires_at) > datetime('now')
      LIMIT 1`,
    [productId, actionType, dedupKey]
  );
  return (result.rows[0] as unknown as IdempotencyRow | undefined) ?? null;
}

function parseResult(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isUniqueConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|unique constraint/i.test(msg);
}
