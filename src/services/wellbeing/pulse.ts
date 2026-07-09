// =============================================================================
// FOUNDRY — Founder pulse (Ascent B5 / Human Law)
//
// The founder's state is telemetry. Computed entirely from data Foundry already
// has — no surveys, no new tracking:
//   • decision load: founder-resolved decisions last 7d vs their own trailing
//     4-week weekly average (a 2× week is a strain signal, whatever the number)
//   • late-night share: fraction of resolutions logged 23:00–05:00
//   • rejection rate: high rejection weeks mean the agents are misaligned or
//     the founder is grinding against the system — either way, friction
// The pulse never diagnoses; it notices, kindly, with the numbers shown
// (Honesty Law). Consumers: the weekly pulse job (notifies only on 'overloaded')
// and, later, briefing pacing (defer non-critical alerts when strained).
// =============================================================================

import { query } from '../../db/client.js';

export type PulseSignal = 'steady' | 'strained' | 'overloaded';

export interface FounderPulse {
  signal: PulseSignal;
  decisions7d: number;
  weeklyAvgPrior4w: number;
  loadRatio: number | null;       // null when there's no prior baseline
  lateNightShare: number;         // 0..1 of this week's resolutions at 23:00–05:00
  rejectionRate7d: number;        // 0..1
  message: string;                // the kind, numbers-shown observation
}

export async function getFounderPulse(productId: string): Promise<FounderPulse> {
  const [thisWeek, prior4w, lateNight, rejected] = await Promise.all([
    query(
      `SELECT COUNT(*) AS n FROM decisions
       WHERE product_id = ? AND decided_by = 'founder'
         AND decided_at >= datetime('now', '-7 days')`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) AS n FROM decisions
       WHERE product_id = ? AND decided_by = 'founder'
         AND decided_at >= datetime('now', '-35 days')
         AND decided_at <  datetime('now', '-7 days')`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) AS n FROM decisions
       WHERE product_id = ? AND decided_by = 'founder'
         AND decided_at >= datetime('now', '-7 days')
         AND CAST(strftime('%H', decided_at) AS INTEGER) NOT BETWEEN 5 AND 22`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) AS n FROM decisions
       WHERE product_id = ? AND decided_by = 'founder' AND status = 'rejected'
         AND decided_at >= datetime('now', '-7 days')`,
      [productId],
    ),
  ]);

  const n = (r: typeof thisWeek): number => Number((r.rows[0] as Record<string, unknown>)?.n ?? 0);
  const decisions7d = n(thisWeek);
  const weeklyAvgPrior4w = n(prior4w) / 4;
  const loadRatio = weeklyAvgPrior4w > 0 ? decisions7d / weeklyAvgPrior4w : null;
  const lateNightShare = decisions7d > 0 ? n(lateNight) / decisions7d : 0;
  const rejectionRate7d = decisions7d > 0 ? n(rejected) / decisions7d : 0;

  // Strain scoring: each factor contributes independently; two factors = overloaded.
  let strain = 0;
  if (loadRatio != null && loadRatio >= 2) strain++;
  if (lateNightShare >= 0.4 && decisions7d >= 3) strain++;
  if (rejectionRate7d >= 0.5 && decisions7d >= 4) strain++;

  const signal: PulseSignal = strain >= 2 ? 'overloaded' : strain === 1 ? 'strained' : 'steady';

  const parts: string[] = [];
  if (loadRatio != null && loadRatio >= 2) {
    parts.push(`you resolved ${decisions7d} decisions this week — ${loadRatio.toFixed(1)}× your usual ${weeklyAvgPrior4w.toFixed(1)}/week`);
  }
  if (lateNightShare >= 0.4 && decisions7d >= 3) {
    parts.push(`${Math.round(lateNightShare * 100)}% of them were made between 11pm and 5am`);
  }
  if (rejectionRate7d >= 0.5 && decisions7d >= 4) {
    parts.push(`you rejected ${Math.round(rejectionRate7d * 100)}% of what was proposed — the agents may be misaligned with where your head is`);
  }
  const message = parts.length > 0
    ? `Noticing: ${parts.join('; ')}. Nothing here needs a decision tonight — the queue will keep.`
    : 'Decision pace looks steady this week.';

  return { signal, decisions7d, weeklyAvgPrior4w, loadRatio, lateNightShare, rejectionRate7d, message };
}
