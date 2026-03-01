// =============================================================================
// FOUNDRY — Wisdom Layer: Failure Log
// Remembers what was tried and failed so Foundry doesn't recommend it again.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { FailureLog, FailureInput, FailureCategory } from '../../types/index.js';

/**
 * Create a failure log entry.
 */
export async function logFailure(
  productId: string,
  ownerId: string,
  input: FailureInput,
): Promise<FailureLog> {
  const id = nanoid();
  await query(
    `INSERT INTO failure_log (id, product_id, owner_id, category, what_was_tried, timeframe, outcome, founder_hypothesis, linked_stressor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, productId, ownerId, input.category, input.what_was_tried, input.timeframe ?? null, input.outcome, input.founder_hypothesis ?? null, input.linked_stressor_id ?? null],
  );

  const result = await query('SELECT * FROM failure_log WHERE id = ?', [id]);
  return deserializeFailure(result.rows[0] as Record<string, unknown>);
}

/**
 * Retrieve the 5 most recent failures in a category for a product.
 * If category is empty, returns across all categories.
 */
export async function getRelevantFailures(
  productId: string,
  category: string,
): Promise<FailureLog[]> {
  const sql = category
    ? `SELECT * FROM failure_log WHERE product_id = ? AND category = ? ORDER BY created_at DESC LIMIT 5`
    : `SELECT * FROM failure_log WHERE product_id = ? ORDER BY created_at DESC LIMIT 5`;
  const args = category ? [productId, category] : [productId];
  const result = await query(sql, args);
  return result.rows.map((r) => deserializeFailure(r as Record<string, unknown>));
}

/**
 * Get all failures for a product, grouped by category.
 */
export async function getAllFailures(productId: string): Promise<FailureLog[]> {
  const result = await query(
    'SELECT * FROM failure_log WHERE product_id = ? ORDER BY created_at DESC',
    [productId],
  );
  return result.rows.map((r) => deserializeFailure(r as Record<string, unknown>));
}

/**
 * Returns prompt data for the failure capture UI. Does not create the entry.
 */
export function promptFailureCapture(
  productId: string,
  stressorId: string,
  stressorName: string,
): { prompt: string; productId: string; stressorId: string; stressorName: string } {
  return {
    prompt: `It looks like "${stressorName}" resolved in a way that didn't work out. What did you try? Foundry will remember this so it doesn't recommend the same approach again.`,
    productId,
    stressorId,
    stressorName,
  };
}

// ─── Internal ────────────────────────────────────────────────────────────────

function deserializeFailure(row: Record<string, unknown>): FailureLog {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    owner_id: row.owner_id as string,
    category: row.category as FailureCategory,
    what_was_tried: row.what_was_tried as string,
    timeframe: row.timeframe as string | null,
    outcome: row.outcome as string,
    founder_hypothesis: row.founder_hypothesis as string | null,
    linked_stressor_id: row.linked_stressor_id as string | null,
    created_at: row.created_at as string,
  };
}
