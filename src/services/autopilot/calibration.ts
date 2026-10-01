// =============================================================================
// FOUNDRY — Calibration scoring (ported from AcreOS confidenceObservations.ts)
//
// The trust ladder measures AGREEMENT (did the founder do what the autopilot
// would have?). Calibration measures TRUTHFULNESS OF CONFIDENCE: did the
// beliefs a category's decisions rested on hold up? A category whose premises
// are falsified is overconfident and should not be trusted with more autonomy,
// whatever its agreement rate.
//
// Source, a fresh ledger read: decision_premises (beliefs that held vs
// falsified). Verified actions were a second source until the legacy executor
// and its verifier were retired (Roadmap 2027 R10); nothing could act through
// them here, so that half only ever read zero.
// Deterministic. Feeds Controls + the operator letter. A category below the
// floor is a promotion HOLD, mirroring the existing quality hold.
// =============================================================================

import { query } from '../../db/client.js';

export type CalibrationVerdict = 'well_calibrated' | 'overconfident' | 'thin';

export interface CategoryCalibration {
  category: string;
  premisesHeld: number;
  premisesFalsified: number;
  /** 0..1 across both signals; null when too thin to judge. */
  score: number | null;
  verdict: CalibrationVerdict;
}

const MIN_SAMPLE = 4;
export const CALIBRATION_FLOOR = 0.6;

export async function getCategoryCalibration(productId: string, category: string): Promise<CategoryCalibration> {
  // Premises recorded for this category's decisions, resolved either way.
  const premises = (await query(
    `SELECT dp.status, COUNT(*) as n FROM decision_premises dp
       JOIN decisions d ON d.id = dp.decision_id
      WHERE dp.product_id = ? AND d.category = ? AND dp.status IN ('holding','falsified')
      GROUP BY dp.status`,
    [productId, category],
  )).rows as unknown as Array<Record<string, unknown>>;
  let premisesHeld = 0, premisesFalsified = 0;
  for (const r of premises) {
    if (r.status === 'holding') premisesHeld = Number(r.n);
    if (r.status === 'falsified') premisesFalsified = Number(r.n);
  }

  const good = premisesHeld;
  const bad = premisesFalsified;
  const total = good + bad;
  if (total < MIN_SAMPLE) {
    return { category, premisesHeld, premisesFalsified, score: null, verdict: 'thin' };
  }
  const score = good / total;
  return {
    category, premisesHeld, premisesFalsified, score,
    verdict: score >= CALIBRATION_FLOOR ? 'well_calibrated' : 'overconfident',
  };
}

/** Is this category too overconfident to earn MORE autonomy right now?
 *  A promotion HOLD (never a demotion — that's the anomaly path's job). */
export async function calibrationHold(productId: string, category: string): Promise<boolean> {
  const c = await getCategoryCalibration(productId, category);
  return c.score != null && c.score < CALIBRATION_FLOOR;
}

export async function getAllCalibrations(productId: string): Promise<CategoryCalibration[]> {
  const cats = (await query(
    'SELECT DISTINCT category FROM autopilot_policies WHERE product_id = ?',
    [productId],
  )).rows as unknown as Array<Record<string, string>>;
  return Promise.all(cats.map((c) => getCategoryCalibration(productId, String(c.category))));
}
