// =============================================================================
// FOUNDRY — Onboarding audit progress tracking (Phase 1.1 / 1.2)
// The onboarding audit runs asynchronously; the progress page HTMX-polls the
// onboarding_audit_progress row so the founder sees live status instead of a
// hung 2-5 minute POST.
// =============================================================================

import { query } from '../../db/client.js';

export const AUDIT_TOTAL_STEPS = 9;

export interface AuditProgress {
  product_id: string;
  status: 'running' | 'completed' | 'error';
  current_step: number;
  total_steps: number;
  step_label: string;
  error: string | null;
  started_at: string;
  updated_at: string;
}

/** Begin (or restart) progress tracking for a product's onboarding audit. */
export async function startAuditProgress(productId: string): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO onboarding_audit_progress
       (product_id, status, current_step, total_steps, step_label, error, started_at, updated_at)
     VALUES (?, 'running', 0, ?, 'Starting…', NULL, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       status='running', current_step=0, total_steps=excluded.total_steps,
       step_label='Starting…', error=NULL, started_at=excluded.started_at,
       updated_at=excluded.updated_at`,
    [productId, AUDIT_TOTAL_STEPS, now, now],
  );
}

/** Report a named step. Non-throwing — progress must never break the audit. */
export async function updateAuditProgress(
  productId: string,
  step: number,
  label: string,
): Promise<void> {
  try {
    await query(
      `UPDATE onboarding_audit_progress
         SET current_step = ?, step_label = ?, updated_at = ?
       WHERE product_id = ?`,
      [step, label, new Date().toISOString(), productId],
    );
  } catch {
    /* non-fatal */
  }
}

export async function completeAuditProgress(productId: string): Promise<void> {
  try {
    await query(
      `UPDATE onboarding_audit_progress
         SET status='completed', current_step = total_steps, step_label='Done', updated_at = ?
       WHERE product_id = ?`,
      [new Date().toISOString(), productId],
    );
  } catch {
    /* non-fatal */
  }
}

export async function failAuditProgress(productId: string, error: string): Promise<void> {
  try {
    await query(
      `UPDATE onboarding_audit_progress
         SET status='error', error = ?, updated_at = ?
       WHERE product_id = ?`,
      [error.slice(0, 500), new Date().toISOString(), productId],
    );
  } catch {
    /* non-fatal */
  }
}

export async function getAuditProgress(productId: string): Promise<AuditProgress | null> {
  const result = await query(
    `SELECT * FROM onboarding_audit_progress WHERE product_id = ?`,
    [productId],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0] as Record<string, unknown>;
  return {
    product_id: r.product_id as string,
    status: r.status as AuditProgress['status'],
    current_step: Number(r.current_step),
    total_steps: Number(r.total_steps),
    step_label: r.step_label as string,
    error: (r.error as string | null) ?? null,
    started_at: r.started_at as string,
    updated_at: r.updated_at as string,
  };
}
