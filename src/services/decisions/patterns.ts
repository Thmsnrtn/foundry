// =============================================================================
// FOUNDRY — Decision Patterns (Cross-Product Learning Loop)
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { hasConsent } from '../privacy/consent.js';
import type { DecisionPattern, OutcomeDirection, OutcomeMagnitude, RiskStateValue } from '../../types/index.js';

export async function generatePatternFromOutcome(input: {
  productId: string;
  decisionType: string;
  lifecycleStage: string;
  riskState: RiskStateValue;
  metricsContext: Record<string, unknown>;
  optionChosen: string;
  outcomeDirection: OutcomeDirection;
  outcomeMagnitude: OutcomeMagnitude;
  outcomeTimeframeDays: number;
  marketCategory: string | null;
  contributingFactors: Record<string, unknown> | null;
  scenarioAccuracyScore: number | null;
}): Promise<string | null> {
  // DEFECT-0044: Cross-company decision patterns must not be written without consent
  if (!(await hasConsent(input.productId, 'cross_company_patterns'))) return null;

  const id = nanoid();
  // The contributor hash, not the product id. It lets the aggregation require k
  // distinct companies without the table being able to say who any of them are
  // — see migration 144 for why a fully anonymous row could not carry its own
  // privacy guarantee.
  const { contributorHash } = await import('../wisdom/network.js');
  await query(
    `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage, risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction, outcome_magnitude, outcome_timeframe_days, market_category, contributing_factors, scenario_accuracy_score, contributor_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.decisionType, input.lifecycleStage, input.riskState, JSON.stringify(input.metricsContext),
     input.optionChosen, input.outcomeDirection, input.outcomeMagnitude, input.outcomeTimeframeDays,
     input.marketCategory, input.contributingFactors ? JSON.stringify(input.contributingFactors) : null,
     input.scenarioAccuracyScore, contributorHash(input.productId)]
  );
  return id;
}

// ─── Cross-product peer signal reader (Phase 4.1) ────────────────────────────

export interface PeerSignal {
  /** Distinct COMPANIES behind this signal — not rows. The name stayed the
   * same when the meaning was corrected, because every consumer treats it as a
   * peer count and always has; it was the number that was wrong. */
  sampleSize: number;
  decisionType: string;
  lifecycleStage: string;
  /** Most-chosen option category among peers. */
  dominantOption: string;
  /** Companies that chose it, counted once each. */
  dominantOptionCount: number;
  /** Fraction (0–1) of the dominant option's BACKING COMPANIES that saw a
   * positive outcome. */
  positiveRate: number;
  /** Human-readable one-liner for the briefing / decision queue. */
  summary: string;
}

/** Below this many matching peer outcomes, we abstain rather than mislead. */
/** Distinct COMPANIES required before a peer signal is shown to anyone.
 *
 * This was a row count, and the summary it produced said "5 founders at your
 * stage who chose X". Five rows is one company that made five similar decisions
 * just as easily as five companies that each made one — and the sentence shown
 * to a competitor asserted the second. An honest abstention beats a confident
 * number, and a number about the wrong population is worse than either.
 */
export const PEER_SIGNAL_MIN_SAMPLE = 5;

/**
 * "Founders at your stage who chose X saw Y." Reads anonymized cross-product
 * outcomes for a decision type + lifecycle stage (optionally scoped to a
 * market), and returns the dominant peer choice with its positive-outcome rate.
 *
 * COUNTED BY COMPANY, NOT BY ROW, at every step:
 *
 *   • the abstention threshold counts distinct contributors;
 *   • each company counts ONCE per option, so a company with strong opinions
 *     and many decisions cannot become the majority on its own;
 *   • the dominant option must itself have enough distinct backers;
 *   • the sentence reports companies, which is now what was measured.
 *
 * Rows whose contributor is unknown — written before migration 144 — cannot be
 * attributed to a company, so they are not counted. Fail-closed: the
 * alternative is a claim about companies built from rows that name none.
 */
export async function getPeerSignal(input: {
  decisionType: string;
  lifecycleStage: string;
  marketCategory?: string | null;
  minSampleSize?: number;
}): Promise<PeerSignal | null> {
  const minSample = input.minSampleSize ?? PEER_SIGNAL_MIN_SAMPLE;

  const clauses = ['decision_type = ?', 'product_lifecycle_stage = ?'];
  const args: unknown[] = [input.decisionType, input.lifecycleStage];
  if (input.marketCategory) {
    clauses.push('market_category = ?');
    args.push(input.marketCategory);
  }

  const result = await query(
    `SELECT option_chosen_category, outcome_direction, contributor_hash
       FROM decision_patterns
      WHERE ${clauses.join(' AND ')}`,
    args,
  );

  const rows = (result.rows as Array<Record<string, unknown>>)
    .filter((r) => r.contributor_hash != null);

  const contributors = new Set(rows.map((r) => String(r.contributor_hash)));

  // One vote per company per option. A company that made the same call eight
  // times is one company that made that call, and counting its rows would let
  // it outvote seven others.
  const byOption = new Map<string, { backers: Set<string>; positive: Set<string> }>();
  for (const r of rows) {
    const option = String(r.option_chosen_category);
    const who = String(r.contributor_hash);
    const entry = byOption.get(option) ?? { backers: new Set<string>(), positive: new Set<string>() };
    entry.backers.add(who);
    if (r.outcome_direction === 'positive') entry.positive.add(who);
    byOption.set(option, entry);
  }

  // Dominant = the option most COMPANIES chose (ties broken by more of them
  // seeing a positive outcome).
  let dominantOption = '';
  let best = { total: 0, positive: 0 };
  for (const [option, entry] of byOption) {
    const total = entry.backers.size;
    const positive = entry.positive.size;
    if (total > best.total || (total === best.total && positive > best.positive)) {
      dominantOption = option;
      best = { total, positive };
    }
  }

  // THE CLAIM'S OWN POPULATION IS WHAT HAS TO CLEAR THE BAR. The sentence says
  // "N companies that chose X saw...", so the companies that chose X are what
  // must be numerous enough — not the cohort that happened to be queried. A
  // cohort of six split five ways says nothing worth telling a seventh.
  //
  // This subsumes a cohort-size check rather than sitting beside one: if five
  // companies chose X then at least five contributed. A second threshold that
  // could never fire would read like a guard and guard nothing.
  if (best.total < minSample) return null; // abstain

  const positiveRate = best.total > 0 ? best.positive / best.total : 0;
  const pct = Math.round(positiveRate * 100);
  const stage = input.lifecycleStage.replace(/_/g, ' ');
  const summary =
    `${best.total} compan${best.total === 1 ? 'y' : 'ies'} at your stage (${stage}) that chose ` +
    `"${dominantOption.replace(/_/g, ' ')}" saw a positive outcome ${pct}% of the time.`;

  return {
    sampleSize: contributors.size,
    decisionType: input.decisionType,
    lifecycleStage: input.lifecycleStage,
    dominantOption,
    dominantOptionCount: best.total,
    positiveRate,
    summary,
  };
}

export async function getPatternStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  avgAccuracy: number | null;
}> {
  const totalResult = await query('SELECT COUNT(*) as count FROM decision_patterns', []);
  const total = (totalResult.rows[0] as Record<string, number>)?.count ?? 0;

  const typeResult = await query(
    'SELECT decision_type, COUNT(*) as count FROM decision_patterns GROUP BY decision_type', []
  );
  const byType: Record<string, number> = {};
  for (const row of typeResult.rows) {
    const r = row as Record<string, unknown>;
    byType[r.decision_type as string] = r.count as number;
  }

  const accResult = await query(
    'SELECT AVG(scenario_accuracy_score) as avg FROM decision_patterns WHERE scenario_accuracy_score IS NOT NULL', []
  );
  const avgAccuracy = (accResult.rows[0] as Record<string, number | null>)?.avg ?? null;

  return { total, byType, avgAccuracy };
}
