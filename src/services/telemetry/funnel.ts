// =============================================================================
// FOUNDRY — Activation funnel telemetry (Phase 5.2)
// Records each founder's progression through the activation funnel so we can
// read conversion by step (and cohort). Recording is idempotent per
// (founder, product, step) and never throws — instrumentation must not break
// the flow it measures.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { logger } from '../logger.js';

// Ordered funnel steps. Keep in order — the readout renders them this way.
export const FUNNEL_STEPS = [
  'signup',
  'repo_connected',
  'audit_done',
  'briefing_viewed',
  'decision_approved',
  'trial_started',
  'paid',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * Record that a founder reached a funnel step. Idempotent (first occurrence
 * wins) and non-throwing. product_id defaults to '' for pre-product steps.
 */
export async function recordFunnelStep(
  step: FunnelStep,
  ids: { founderId: string; productId?: string | null },
): Promise<void> {
  if (!ids.founderId) return;
  try {
    await query(
      `INSERT OR IGNORE INTO funnel_events (id, founder_id, product_id, step, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [nanoid(), ids.founderId, ids.productId ?? '', step, new Date().toISOString()],
    );
  } catch (err) {
    logger.warn('funnel.record_failed', { step, error: (err as Error).message });
  }
}

export interface FunnelReadoutRow {
  step: FunnelStep;
  count: number;
  /** Conversion from the first step (signup), 0–1. */
  fromTop: number;
  /** Conversion from the immediately-preceding step, 0–1. */
  fromPrev: number;
}

/**
 * Distinct founders who reached each step (optionally since a date), with
 * top-of-funnel and step-over-step conversion rates.
 */
export async function getFunnelReadout(sinceIso?: string): Promise<FunnelReadoutRow[]> {
  const where = sinceIso ? 'WHERE created_at >= ?' : '';
  const args = sinceIso ? [sinceIso] : [];
  const result = await query(
    `SELECT step, COUNT(DISTINCT founder_id) AS cnt FROM funnel_events ${where} GROUP BY step`,
    args,
  );
  const counts = new Map<string, number>();
  for (const row of result.rows as Array<Record<string, unknown>>) {
    counts.set(row.step as string, Number(row.cnt));
  }

  const top = counts.get(FUNNEL_STEPS[0]) ?? 0;
  const rows: FunnelReadoutRow[] = [];
  let prev = 0;
  FUNNEL_STEPS.forEach((step, i) => {
    const count = counts.get(step) ?? 0;
    rows.push({
      step,
      count,
      fromTop: top > 0 ? count / top : 0,
      fromPrev: i === 0 ? 1 : prev > 0 ? count / prev : 0,
    });
    prev = count;
  });
  return rows;
}
