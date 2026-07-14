// =============================================================================
// FOUNDRY — Calibration scoring (ported from AcreOS confidenceObservations.ts)
//
// The trust ladder measures AGREEMENT (did the founder do what the autopilot
// would have?). Calibration measures TRUTHFULNESS OF CONFIDENCE: when the
// autopilot acted, did it actually work? A category that acts and its acts
// pass verification is well-calibrated; one whose acts fail is overconfident
// and should not be trusted with more autonomy, whatever its agreement rate.
//
// Sources, both fresh ledger reads:
//   - action_executions.verify_status (the action verifier — passed/failed)
//   - decision_premises (beliefs that held vs falsified)
// Deterministic. Feeds Controls + the operator letter. A category below the
// floor is a promotion HOLD, mirroring the existing quality hold.
// =============================================================================

import { query } from '../../db/client.js';

export type CalibrationVerdict = 'well_calibrated' | 'overconfident' | 'thin';

export interface CategoryCalibration {
  category: string;
  actionsPassed: number;
  actionsFailed: number;
  premisesHeld: number;
  premisesFalsified: number;
  /** 0..1 across both signals; null when too thin to judge. */
  score: number | null;
  verdict: CalibrationVerdict;
}

const MIN_SAMPLE = 4;
export const CALIBRATION_FLOOR = 0.6;

export async function getCategoryCalibration(productId: string, category: string): Promise<CategoryCalibration> {
  // Verified actions attributed to this category's autopilot.
  const actions = (await query(
    `SELECT verify_status, COUNT(*) as n FROM action_executions
      WHERE product_id = ? AND approved_by = ? AND verify_status IN ('passed','failed')
      GROUP BY verify_status`,
    [productId, `autopilot:${category}`],
  )).rows as unknown as Array<Record<string, unknown>>;
  let actionsPassed = 0, actionsFailed = 0;
  for (const r of actions) {
    if (r.verify_status === 'passed') actionsPassed = Number(r.n);
    if (r.verify_status === 'failed') actionsFailed = Number(r.n);
  }

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

  const good = actionsPassed + premisesHeld;
  const bad = actionsFailed + premisesFalsified;
  const total = good + bad;
  if (total < MIN_SAMPLE) {
    return { category, actionsPassed, actionsFailed, premisesHeld, premisesFalsified, score: null, verdict: 'thin' };
  }
  const score = good / total;
  return {
    category, actionsPassed, actionsFailed, premisesHeld, premisesFalsified, score,
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
