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

// `computePeerSignal` WAS HERE, AND WAS THE WRONG COPY OF THE READER BELOW.
//
// It counted ROWS — `COUNT(*)` with no contributor floor and no exclusion of
// rows carrying no `contributor_hash` — and `decorateForDisplay` then wrote
// "Founders like you who acted on this saw positive outcomes X% of the time
// (n=4)". One company contributing four similar decisions read as four
// companies; a demo row from the seed, which carries no hash at all, read as a
// company too. The reader below documents that exact defect as fixed on ITSELF,
// in this same file, and this one kept it.
//
// It had no production caller: it was reached only from tests, and one of those
// asserted the row count as the expected behaviour. A wrong function beside the
// right one, in the same file, under a friendlier name, is a trap for whoever
// needs a peer signal next.

/**
 * Decorate a peer signal for dashboard display. Computes the headline string
 * and the worth_surfacing flag.
 *
 * `sample_size` here is COMPANIES, because the only caller counts distinct
 * contributor hashes. The floor is the shared constant rather than a second
 * literal 5 — one number, one home.
 */
export function decorateForDisplay(signal: PeerSignal): PeerSignalForDecision {
  const worthSurfacing = signal.sample_size >= PEER_SIGNAL_MIN_SAMPLE;
  const pct = Math.round(signal.positive_outcome_rate * 100);
  const headline = worthSurfacing
    ? `Founders like you who acted on this saw positive outcomes ${pct}% of the time `
      + `(${signal.sample_size} companies)`
    : `Not enough peer data yet (${signal.sample_size} companies). `
      + `The pattern needs at least ${PEER_SIGNAL_MIN_SAMPLE}.`;
  return { ...signal, worth_surfacing: worthSurfacing, headline };
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
