// =============================================================================
// FOUNDRY — Data Classification Policy (V3.1 Layer C)
// Per-product per-surface authorization for outbound data classes. Used by
// the tool gateway. When no policy exists for (product, surface), defaults
// allow 'general' and 'customer' classes; everything else is rejected.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassificationPolicy {
  id: string;
  product_id: string;
  surface: string;
  allowed_classes: string[];
  forbidden_classes: string[];
  notes: string | null;
  updated_at: string;
}

export interface UpsertPolicyInput {
  allowed_classes: string[];
  forbidden_classes?: string[];
  notes?: string | null;
}

export interface CheckResult {
  allowed: boolean;
  reason: string;
}

const DEFAULT_ALLOWED = new Set(['general', 'customer']);

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getPolicy(
  productId: string,
  surface: string
): Promise<ClassificationPolicy | null> {
  const result = await query(
    `SELECT * FROM data_classifications WHERE product_id = ? AND surface = ?`,
    [productId, surface]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToPolicy(row);
}

export async function upsertPolicy(
  productId: string,
  surface: string,
  input: UpsertPolicyInput
): Promise<ClassificationPolicy> {
  const allowed = JSON.stringify(input.allowed_classes ?? []);
  const forbidden = JSON.stringify(input.forbidden_classes ?? []);
  const existing = await getPolicy(productId, surface);

  if (existing) {
    await query(
      `UPDATE data_classifications
          SET allowed_classes = ?, forbidden_classes = ?, notes = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [allowed, forbidden, input.notes ?? null, existing.id]
    );
  } else {
    await query(
      `INSERT INTO data_classifications
         (id, product_id, surface, allowed_classes, forbidden_classes, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, surface, allowed, forbidden, input.notes ?? null]
    );
  }
  // Re-read to return the canonical row.
  const policy = await getPolicy(productId, surface);
  if (!policy) throw new Error('upsertPolicy: row missing after upsert');
  return policy;
}

/**
 * Decide whether (product, surface) admits the given data class.
 *
 * Decision order:
 *   1. If a policy row exists, forbidden_classes is a hard block.
 *   2. If a policy row exists, allowed_classes is a hard allow.
 *   3. If a policy row exists and class is in neither list, default deny.
 *   4. If no policy row exists, allow {'general','customer'} only.
 */
export async function checkAllowed(
  productId: string,
  surface: string,
  dataClass: string
): Promise<CheckResult> {
  const policy = await getPolicy(productId, surface);
  if (!policy) {
    if (DEFAULT_ALLOWED.has(dataClass)) {
      return { allowed: true, reason: `default policy allows '${dataClass}'` };
    }
    return {
      allowed: false,
      reason: `no policy for surface '${surface}'; default rejects '${dataClass}'`,
    };
  }

  if (policy.forbidden_classes.includes(dataClass)) {
    return {
      allowed: false,
      reason: `surface '${surface}' explicitly forbids '${dataClass}'`,
    };
  }
  if (policy.allowed_classes.includes(dataClass)) {
    return {
      allowed: true,
      reason: `surface '${surface}' allows '${dataClass}'`,
    };
  }
  return {
    allowed: false,
    reason: `surface '${surface}' does not list '${dataClass}' as allowed`,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

function rowToPolicy(row: Record<string, unknown>): ClassificationPolicy {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    surface: row.surface as string,
    allowed_classes: parseStringArray(row.allowed_classes),
    forbidden_classes: parseStringArray(row.forbidden_classes),
    notes: (row.notes as string | null) ?? null,
    updated_at: row.updated_at as string,
  };
}

function parseStringArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
