// =============================================================================
// FOUNDRY — Peer Signal (Wave 3, action 22)
// Surfaces the cross-product decision_patterns table to the founder.
// "Founders like you also approved..." — the compounding moat the
// 300-persona review (Council 19, 20) flagged as Foundry's durable
// differentiator. The table is collected; this module reads it.
// =============================================================================

import { query } from '../../db/client.js';
import { PEER_SIGNAL_MIN_SAMPLE } from '../decisions/patterns.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeerSignal {
  decision_type: string;
  approval_rate: number;            // 0-1: fraction of peer founders who approved this kind
  positive_outcome_rate: number;     // 0-1: of approved, fraction with positive_outcome
  sample_size: number;
  median_outcome_days: number | null;
}

export interface PeerSignalForDecision extends PeerSignal {
  /** Whether the peer signal is strong enough to surface (sample_size >= 5). */
  worth_surfacing: boolean;
  /** Short headline copy ready for the dashboard card. */
  headline: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the peer signal for a given decision shape (decision_type +
 * lifecycle stage). Returns null if no patterns table data exists.
 */
export async function computePeerSignal(opts: {
  decision_type: string;
  product_lifecycle_stage: string;
  market_category?: string | null;
}): Promise<PeerSignal | null> {
  // Build a flexible filter — match on type + stage; market_category is
  // an optional bonus filter.
  const filters = ['decision_type = ?', 'product_lifecycle_stage = ?'];
  const args: unknown[] = [opts.decision_type, opts.product_lifecycle_stage];
  if (opts.market_category) {
    filters.push('market_category = ?');
    args.push(opts.market_category);
  }
  const whereClause = filters.join(' AND ');

  const r = await query(
    `SELECT
       COUNT(*) AS n,
       SUM(CASE WHEN outcome_direction = 'positive' THEN 1 ELSE 0 END) AS positive,
       AVG(outcome_timeframe_days) AS avg_days
     FROM decision_patterns
    WHERE ${whereClause}`,
    args
  );

  const row = r.rows[0] as Record<string, number | null> | undefined;
  if (!row) return null;
  const n = Number(row.n ?? 0);
  if (n === 0) return null;

  // We don't have a separate "approved vs rejected" column — the table is
  // populated only when a decision has been ACTED on. So approval_rate
  // here is effectively 1.0 when patterns exist; the actionable signal is
  // the positive_outcome_rate.
  const positive = Number(row.positive ?? 0);
  const positiveRate = n === 0 ? 0 : positive / n;
  const medianDays = row.avg_days != null ? Math.round(row.avg_days) : null;

  return {
    decision_type: opts.decision_type,
    approval_rate: 1.0,
    positive_outcome_rate: positiveRate,
    sample_size: n,
    median_outcome_days: medianDays,
  };
}

/**
 * Decorate a peer signal for dashboard display. Computes the headline
 * string and the worth_surfacing flag.
 */
export function decorateForDisplay(signal: PeerSignal): PeerSignalForDecision {
  const worthSurfacing = signal.sample_size >= 5;
  const pct = Math.round(signal.positive_outcome_rate * 100);
  const headline = worthSurfacing
    ? `Founders like you who acted on this saw positive outcomes ${pct}% of the time (n=${signal.sample_size})`
    : `Not enough peer data yet (n=${signal.sample_size}). The pattern needs ≥5 datapoints.`;
  return {
    ...signal,
    worth_surfacing: worthSurfacing,
    headline,
  };
}

/**
 * Top-N peer-validated decision types for the dashboard's compounding-moat
 * card. Only returns types with sample_size >= 5 AND positive_outcome_rate
 * >= 60%, sorted by sample size DESC.
 */
export async function topPeerValidatedDecisionTypes(
  productLifecycleStage: string,
  limit: number = 5
): Promise<PeerSignalForDecision[]> {
  // COUNTED BY COMPANY, NOT BY ROW. This was `COUNT(*) ... HAVING n >= 5` and
  // the card said "n=5" to mean five peers — which one company making five
  // similar decisions satisfied exactly as well as five companies making one
  // each. The sentence shown to that company's competitor asserted the second.
  //
  // `decisions/patterns.ts` documents this defect as fixed on its own reader
  // and exports the rule; this reader kept the row count, and unlike that one
  // it is not consent-gated, so it is the copy a founder actually sees. Rows
  // with no `contributor_hash` cannot be attributed to a company and are not
  // counted as one.
  const r = await query(
    `SELECT
       decision_type,
       COUNT(DISTINCT contributor_hash) AS n,
       COUNT(DISTINCT CASE WHEN outcome_direction = 'positive' THEN contributor_hash END) AS positive,
       AVG(outcome_timeframe_days) AS avg_days
     FROM decision_patterns
    WHERE product_lifecycle_stage = ? AND contributor_hash IS NOT NULL
    GROUP BY decision_type
    HAVING n >= ? AND CAST(positive AS REAL) / n >= 0.6
    ORDER BY n DESC
    LIMIT ?`,
    [productLifecycleStage, PEER_SIGNAL_MIN_SAMPLE, limit]
  );

  return r.rows.map((row) => {
    const rec = row as Record<string, number | null>;
    const n = Number(rec.n ?? 0);
    const positive = Number(rec.positive ?? 0);
    const signal: PeerSignal = {
      decision_type: rec.decision_type as unknown as string,
      approval_rate: 1.0,
      positive_outcome_rate: n === 0 ? 0 : positive / n,
      sample_size: n,
      median_outcome_days: rec.avg_days != null ? Math.round(rec.avg_days) : null,
    };
    return decorateForDisplay(signal);
  });
}
