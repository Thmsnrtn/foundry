// =============================================================================
// FOUNDRY — Cross-Company Insight Reader (Option B fleet slice, 2026-07-13)
//
// The reader half of the cross-company contract: decision_patterns has
// consent-gated anonymized writes; this turns them into actionable insights
// for a founder's OPEN decisions. Deterministic — no model call — and it
// abstains below PEER_SIGNAL_MIN_SAMPLE peers rather than mislead (Honesty
// Law: an honest silence beats a confident number built on 2 data points).
//
// Fleet slice boundary (per operator decision 2026-07-13): this reader + the
// existing FleetObservatory ARE the launch slice. FleetOracle/Sentinel/
// PortfolioLedger and the rest defer behind the 3-paying-founders trigger.
// =============================================================================

import { query } from '../../db/client.js';
import { getPeerSignal } from '../decisions/patterns.js';

export interface FleetInsight {
  productId: string;
  productName: string;
  decisionId: string;
  decisionWhat: string;
  /** e.g. "7 founders at your stage (early revenue) who chose 'raise prices' saw a positive outcome 71% of the time." */
  summary: string;
  sampleSize: number;
}

const MAX_INSIGHTS = 5;

/** For every pending decision across the founder's fleet, ask the anonymized
 *  pattern ledger what peers at the same stage chose and how it went.
 *  Returns only insights backed by enough peers; often that means none —
 *  the card says so honestly instead of padding. */
export async function getFleetInsights(founderId: string): Promise<FleetInsight[]> {
  const pending = await query(
    `SELECT d.id, d.what, d.category, d.product_id, p.name as product_name,
            COALESCE(ls.current_prompt, 'prompt_1') as stage
       FROM decisions d
       JOIN products p ON p.id = d.product_id
       LEFT JOIN lifecycle_state ls ON ls.product_id = d.product_id
      WHERE p.owner_id = ? AND d.status = 'pending'
      ORDER BY d.gate DESC, d.created_at ASC
      LIMIT 20`,
    [founderId],
  );

  const insights: FleetInsight[] = [];
  for (const row of pending.rows as unknown as Array<Record<string, unknown>>) {
    if (insights.length >= MAX_INSIGHTS) break;
    const signal = await getPeerSignal({
      decisionType: String(row.category),
      lifecycleStage: String(row.stage),
    });
    if (!signal) continue; // abstained — not enough peers for this one
    insights.push({
      productId: String(row.product_id),
      productName: String(row.product_name),
      decisionId: String(row.id),
      decisionWhat: String(row.what),
      summary: signal.summary,
      sampleSize: signal.sampleSize,
    });
  }
  return insights;
}
