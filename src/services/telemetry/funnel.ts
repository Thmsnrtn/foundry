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
 * WHICH OF THESE IS SERVICE STATE, AND WHICH IS ANALYTICS.
 *
 * The privacy page offers "Help Improve Foundry", described as letting Foundry
 * use usage patterns to improve the product. NOTHING READ IT. Every step below
 * was recorded against a NAMED founder whether it was on or off, so a person
 * who declined was told their usage was not being used while it was.
 *
 * The owner's §14 decision is to split rather than to gate the lot:
 *
 *   SERVICE — signing up, connecting a repo, starting a trial, paying. Foundry
 *   cannot run or bill an account without these, and offering a choice that
 *   cannot be honoured is worse than offering none. Ungated, and DISCLOSED on
 *   the privacy page in those words.
 *
 *   TELEMETRY — completing an audit, opening a briefing, approving a decision.
 *   These describe how somebody USES the product. The company state they
 *   reflect already lives in its own tables; this is a second copy kept for
 *   Foundry's benefit, which is exactly what the toggle is about.
 *
 * A step in neither list is a step nobody has classified, and `stepKind` fails
 * closed on one — treating an unclassified step as telemetry, because the
 * mistake that costs somebody something is recording without consent.
 */
export const SERVICE_STEPS: readonly FunnelStep[] = [
  'signup', 'repo_connected', 'trial_started', 'paid',
] as const;

export const TELEMETRY_STEPS: readonly FunnelStep[] = [
  'audit_done', 'briefing_viewed', 'decision_approved',
] as const;

export function stepKind(step: FunnelStep): 'service' | 'telemetry' {
  return SERVICE_STEPS.includes(step) ? 'service' : 'telemetry';
}

/**
 * Record that a founder reached a funnel step. Idempotent (first occurrence
 * wins) and non-throwing.
 *
 * TWO PATHS, DELIBERATELY. A service step is recorded against the account,
 * because running and billing the account requires knowing it. A telemetry step
 * is recorded ONLY with the company's `product_improvement` consent, and then
 * against a contributor hash rather than a name — minimisation first, then
 * de-identification, which is the order the owner's decision states.
 *
 * NO CONSENT MEANS NO ROW. Filtering at read time over data already kept would
 * make the toggle a display preference; this makes it a control.
 */
export async function recordFunnelStep(
  step: FunnelStep,
  ids: { founderId: string; productId?: string | null },
): Promise<void> {
  if (!ids.founderId) return;
  try {
    if (stepKind(step) === 'service') {
      await query(
        `INSERT OR IGNORE INTO funnel_events (id, founder_id, product_id, step, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [nanoid(), ids.founderId, ids.productId ?? '', step, new Date().toISOString()],
      );
      return;
    }

    // A telemetry step with no company cannot be consented for by anybody, and
    // fails closed rather than falling back to the account.
    const productId = ids.productId ?? '';
    if (!productId) return;

    const { hasConsent } = await import('../privacy/consent.js');
    if (!(await hasConsent(productId, 'product_improvement'))) return;

    const { contributorHash } = await import('../wisdom/network.js');
    await query(
      `INSERT OR IGNORE INTO product_telemetry_events (id, contributor_hash, step, created_at)
       VALUES (?, ?, ?, ?)`,
      [nanoid(), contributorHash(ids.founderId), step, new Date().toISOString()],
    );
  } catch (err) {
    logger.warn('funnel.record_failed', { step, error: (err as Error).message });
  }
}

export interface FunnelReadoutRow {
  step: FunnelStep;
  count: number;
  /** Which population this count is over. `telemetry` counts only people whose
   *  company consented to product-improvement analytics, so a conversion rate
   *  that crosses the boundary compares two different groups. Carried on the
   *  row so a surface can say so instead of a reader inferring it from a dip. */
  kind: 'service' | 'telemetry';
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
  const counts = new Map<string, number>();

  const service = await query(
    `SELECT step, COUNT(DISTINCT founder_id) AS cnt FROM funnel_events ${where} GROUP BY step`,
    args,
  );
  for (const row of service.rows as Array<Record<string, unknown>>) {
    counts.set(row.step as string, Number(row.cnt));
  }

  // THE TELEMETRY HALF COUNTS CONSENTING PEOPLE ONLY, and the readout must not
  // present that as the same denominator. It is a smaller population by
  // construction, so a conversion rate across the boundary is a ratio between
  // two different groups — which is the provenance error this campaign found in
  // the wisdom network, where a cohort count was published as a contributor
  // count. `consented` below says so out loud rather than leaving a reader to
  // infer it from a dip.
  const telemetry = await query(
    `SELECT step, COUNT(DISTINCT contributor_hash) AS cnt FROM product_telemetry_events
      ${where} GROUP BY step`,
    args,
  );
  for (const row of telemetry.rows as Array<Record<string, unknown>>) {
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
      kind: stepKind(step),
      fromTop: top > 0 ? count / top : 0,
      fromPrev: i === 0 ? 1 : prev > 0 ? count / prev : 0,
    });
    prev = count;
  });
  return rows;
}
