// =============================================================================
// FOUNDRY — Trust ledger (Ascent B6 / Trust Law)
//
// The Second Self begins here: autonomy is PRICED, never configured.
// For each decision category, the ledger measures the actual track record —
// founder-approved agent proposals whose measured outcome was positive — and
// only when calibration clears the bar on a real sample does Foundry PROPOSE
// (never silently apply) graduating that category down a gate. Every delegation
// is reversible, and the evidence is always shown (Honesty Law).
//
// Substrate: decisions.outcome_valence (recorded by the follow-up/retrospective
// loop) — the same outcomes the founder already logs. Loop stage: learn→decide.
// =============================================================================

import { query } from '../../db/client.js';
import { foundryJudgementTestedSql } from '../decisions/foundry-proposed.js';

export const TRUST_MIN_SAMPLE = 8;      // no proposals on thin evidence
export const TRUST_BAR = 0.8;           // 80% positive outcomes to earn a gate

export interface CategoryTrust {
  category: string;
  decided: number;               // decisions that tested Foundry's judgement, outcome recorded
  positive: number;
  positiveRate: number | null;   // null below any evidence
  currentMinGate: number | null; // the lowest gate seen in this category
  earned: boolean;               // clears bar + sample → graduation proposable
}

export interface TrustLedger {
  categories: CategoryTrust[];
  proposals: string[];           // human-readable graduation proposals
}

export async function getTrustLedger(productId: string): Promise<TrustLedger> {
  // `decided_by = 'founder'` SAYS WHO RESOLVED THE ROW, NOT WHO PROPOSED IT.
  // That was the only filter here, under a header promising a track record of
  // "founder-approved agent proposals". Founder-authored decisions land in the
  // same table with the same category and gate — Ask Foundry and the mobile app
  // both insert them — so a founder who dictates their own strategic calls,
  // resolves them, and records good outcomes crossed TRUST_MIN_SAMPLE at
  // TRUST_BAR on their OWN judgment, and was then shown a proposal saying
  // Foundry had earned the gate. A legitimacy the query could not support,
  // offered at the moment the founder decides whether to grant authority.
  //
  // The rule lives in `decisions/foundry-proposed.ts` because three places ask
  // it and all three decide how much authority Foundry gets.
  const rows = await query(
    `SELECT category,
            COUNT(*) AS decided,
            SUM(CASE WHEN outcome_valence = 1 THEN 1 ELSE 0 END) AS positive,
            MIN(gate) AS min_gate
     FROM decisions
     WHERE product_id = ?
       AND status = 'approved'
       AND outcome_valence IS NOT NULL
       AND ${foundryJudgementTestedSql()}
     GROUP BY category`,
    [productId],
  );

  const categories: CategoryTrust[] = (rows.rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const decided = Number(r.decided);
    const positive = Number(r.positive);
    const positiveRate = decided > 0 ? positive / decided : null;
    return {
      category: String(r.category ?? 'uncategorized'),
      decided,
      positive,
      positiveRate,
      currentMinGate: r.min_gate != null ? Number(r.min_gate) : null,
      earned: decided >= TRUST_MIN_SAMPLE && positiveRate != null && positiveRate >= TRUST_BAR,
    };
  });

  const proposals = categories
    .filter((c) => c.earned && (c.currentMinGate ?? 0) >= 1)
    .map((c) =>
      `${c.category}: ${c.positive}/${c.decided} approved decisions turned out positive (${Math.round((c.positiveRate ?? 0) * 100)}%). ` +
      `Foundry proposes handling gate-${c.currentMinGate} ${c.category} decisions autonomously — reversible any time, every action logged.`,
    );

  return { categories, proposals };
}
