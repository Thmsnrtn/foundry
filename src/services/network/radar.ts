// =============================================================================
// FOUNDRY — Network radar (Ascent B4 / Compounding Law)
//
// Collective foresight: every founder's anonymized metrics sharpen the early-
// warning signal for everyone. The radar places a product in its peer cell
// (lifecycle stage × MRR bracket) and warns when one of its vitals sits in the
// dangerous tail of the peer distribution — BEFORE the founder would notice.
//
// Honesty Law: abstains below 5 peers in the cell (the established peer-signal
// convention); every warning shows the percentile evidence it rests on.
// Loop stage: sense/learn.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';

// direction: is a HIGHER value worse ('high_bad') or a LOWER one ('low_bad')?
const RADAR_METRICS: Array<{ key: string; direction: 'high_bad' | 'low_bad'; label: string }> = [
  { key: 'churn_rate', direction: 'high_bad', label: 'churn' },
  { key: 'activation_rate', direction: 'low_bad', label: 'activation' },
  { key: 'day_30_retention', direction: 'low_bad', label: '30-day retention' },
  { key: 'nps_score', direction: 'low_bad', label: 'NPS' },
];

const MIN_PEERS = 5;

function mrrBracket(mrrCents: number): string {
  const mrr = mrrCents / 100;
  if (mrr === 0) return '0';
  if (mrr < 5000) return '0-5k';
  if (mrr < 25000) return '5k-25k';
  if (mrr < 100000) return '25k-100k';
  if (mrr < 500000) return '100k-500k';
  return '500k+';
}

export interface RadarWarning {
  metric: string;
  label: string;
  value: number;
  p25: number;
  p50: number;
  p75: number;
  sampleCount: number;
  message: string;
}

/** Scan one product against its peer cell. Returns [] when healthy or when the
 *  network is too thin to say anything honest. */
export async function scanForWarnings(productId: string): Promise<RadarWarning[]> {
  const snapRes = await query(
    `SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
    [productId],
  );
  const snap = snapRes.rows[0] as Record<string, unknown> | undefined;
  if (!snap) return [];

  const lsRes = await query(
    'SELECT current_prompt FROM lifecycle_state WHERE product_id = ?', [productId],
  );
  const stage = ((lsRes.rows[0] as Record<string, unknown> | undefined)?.current_prompt as string) ?? 'prompt_1';

  // MRR for the bracket: prefer absolute, else reconstruct sign-agnostic zero.
  const mrrCents = Number(snap.mrr_cents ?? snap.new_mrr_cents ?? 0);
  const bracket = mrrBracket(mrrCents);

  const warnings: RadarWarning[] = [];
  for (const m of RADAR_METRICS) {
    const value = snap[m.key] as number | null;
    if (value == null) continue;

    const cell = await query(
      `SELECT p25, p50, p75, sample_count FROM network_benchmarks
       WHERE metric = ? AND lifecycle_stage = ? AND mrr_bracket = ?
       ORDER BY last_updated DESC LIMIT 1`,
      [m.key, stage, bracket],
    );
    const b = cell.rows[0] as Record<string, number> | undefined;
    if (!b || Number(b.sample_count) < MIN_PEERS) continue; // abstain — thin cell

    const inDangerTail =
      m.direction === 'high_bad' ? value > Number(b.p75) : value < Number(b.p25);
    if (!inDangerTail) continue;

    const tail = m.direction === 'high_bad' ? 'worst quartile' : 'bottom quartile';
    warnings.push({
      metric: m.key,
      label: m.label,
      value: Number(value),
      p25: Number(b.p25), p50: Number(b.p50), p75: Number(b.p75),
      sampleCount: Number(b.sample_count),
      message: `Your ${m.label} (${value}) is in the ${tail} of ${b.sample_count} peers at your stage/${bracket} — peer median is ${b.p50}.`,
    });
  }

  if (warnings.length > 0) {
    log.info('network radar warnings', { productId, count: warnings.length, metrics: warnings.map((w) => w.metric) });
  }
  return warnings;
}
