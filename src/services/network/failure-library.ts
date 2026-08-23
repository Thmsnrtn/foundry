// =============================================================================
// FOUNDRY — Network Intelligence: Failure Pattern Library
// Pattern-matches each product against known failure precursors.
// No cross-product data is leaked — each product is evaluated independently
// against the anonymized pattern library.
// =============================================================================

import { query } from '../../db/client.js';
import { ratePoints } from '../ai/measured.js';
import { getFinancialPosition } from '../financial/position.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PatternMatch {
  pattern: {
    id: string;
    pattern_name: string;
    description: string;
    category: string;
    severity: string;
    warning_signals: string[];
    mitigation_actions: string[];
  };
  match_score: number;
  matched_signals: string[];
  days_until_typical_failure: number | null;
  recommended_actions: string[];
}

interface FailurePatternRow {
  id: string;
  pattern_name: string;
  description: string;
  category: string;
  warning_signals_json: string;
  typical_lead_time_days: number | null;
  mitigation_actions_json: string;
  match_criteria_json: string;
  severity: string;
  created_at: string;
}

interface MatchCriteria {
  churn_rate_gt?: number;
  nps_lt?: number;
  mrr_growth_lt?: number;
  mrr_growth_lt_weeks?: number;
  runway_months_lt?: number;
  no_fundraising_activity?: boolean;
  activation_declining_weeks?: number;
  active_stressor_count_gt?: number;
  risk_state?: string[];
}

// ─── Seed Default Failure Patterns ───────────────────────────────────────────

/**
 * Seeds the failure_patterns table with well-known startup failure patterns.
 * Safe to call repeatedly — uses INSERT OR IGNORE.
 *
 * THESE ARE EDITORIAL, AND FOUR OF THEM USED TO SAY OTHERWISE. The library
 * ships with Foundry: it is received startup practice about shapes worth
 * watching, written by hand, and NOT derived from any company's data — not this
 * company's, not the benchmark pool's, not the network's. Nothing measures a
 * lead time and nothing counts how often a pattern was followed by the failure
 * it names.
 *
 * Four descriptions stated frequencies as if something had counted them:
 *
 *   "typically see churn double within 60 days"
 *   "most companies in this pattern see negative MRR growth within 8 weeks"
 *   "the most common failure mode for B2B SaaS at the $10k-50k MRR range"
 *   "NPS captures the deterioration 60-90 days before it hits revenue"
 *
 * A founder reads those on a card headed with their own match score, beside
 * signals drawn from their own metrics — which is exactly the context that makes
 * a rule of thumb read as a finding about their company. The direction each one
 * describes is worth saying; the number was never measured, so it is not said.
 *
 * `typical_lead_time_days` stays, because a rule of thumb about how much warning
 * a shape usually gives is useful — and the card that renders it now says which
 * kind of number it is.
 */
export async function seedDefaultPatterns(): Promise<void> {
  const existing = await query('SELECT COUNT(*) as cnt FROM failure_patterns', []);
  const count = (existing.rows[0] as Record<string, number>).cnt;
  if (count > 0) return;

  const now = new Date().toISOString();

  const patterns: Array<{
    id: string;
    pattern_name: string;
    description: string;
    category: string;
    warning_signals: string[];
    typical_lead_time_days: number | null;
    mitigation_actions: string[];
    match_criteria: MatchCriteria;
    severity: string;
  }> = [
    {
      id: 'fp_churn_precursor',
      pattern_name: 'Churn Precursor',
      description: 'Elevated churn combined with low NPS is a shape that tends to precede accelerating revenue loss: the customers most likely to leave are already telling you, and the rate is already moving. Left alone it usually gets worse rather than better.',
      category: 'churn_spike',
      warning_signals: [
        'Churn rate exceeds 8% monthly',
        'NPS below 6',
        'Support ticket volume increasing',
        'Feature adoption declining in churned cohorts',
      ],
      typical_lead_time_days: 45,
      mitigation_actions: [
        'Launch immediate exit-interview campaign for churned accounts',
        'Identify top 10 at-risk accounts and schedule proactive calls',
        'Review onboarding completion for recent cohorts',
        'Introduce a "success milestone" check-in at day 30',
      ],
      match_criteria: { churn_rate_gt: 8, nps_lt: 6 },
      severity: 'high',
    },
    {
      id: 'fp_growth_plateau_pre_stall',
      pattern_name: 'Growth Plateau Pre-Stall',
      description: 'Sustained near-zero MRR growth over multiple weeks is what a growth stall looks like from inside it. Flat is not stable: churn continues while new business does not, so the same trajectory tends to turn negative rather than hold.',
      category: 'growth_stall',
      warning_signals: [
        'MRR growth below 2% for 3+ consecutive weeks',
        'New logo count flat',
        'Expansion revenue not offsetting churn',
        'Sales cycle lengthening',
      ],
      typical_lead_time_days: 56,
      mitigation_actions: [
        'Audit the top-of-funnel for qualification leaks',
        'Review expansion playbook — are you capturing upsell opportunities?',
        'Run a win/loss analysis on the last 10 deals',
        'Consider a pricing experiment to accelerate close rates',
      ],
      match_criteria: { mrr_growth_lt: 2, mrr_growth_lt_weeks: 3 },
      severity: 'medium',
    },
    {
      id: 'fp_runway_crisis',
      pattern_name: 'Runway Crisis',
      description: 'Less than 6 months of runway with no active fundraising is among the most critical failure patterns. Companies in this position have limited ability to respond to unexpected headwinds.',
      category: 'runway_crisis',
      warning_signals: [
        'Runway below 6 months',
        'No fundraising scores or investor updates in 90 days',
        'Burn rate increasing quarter-over-quarter',
        'MRR growth insufficient to reach profitability',
      ],
      typical_lead_time_days: 90,
      mitigation_actions: [
        'Begin investor outreach immediately — do not wait',
        'Model a default alive scenario: what cuts achieve profitability?',
        'Prioritise revenue-generating experiments over product expansion',
        'Engage existing investors for bridge options',
      ],
      match_criteria: { runway_months_lt: 6, no_fundraising_activity: true },
      severity: 'critical',
    },
    {
      id: 'fp_pmf_drift',
      pattern_name: 'PMF Drift',
      description: 'Activation rate declining over 4+ weeks suggests that the product is losing alignment with user expectations — often triggered by ICP drift, feature bloat, or a shifted competitive landscape.',
      category: 'product_drift',
      warning_signals: [
        'Activation rate declining 4+ consecutive weeks',
        'Time-to-value increasing',
        'Onboarding drop-off at new steps',
        'User interviews surface confusion about core value prop',
      ],
      typical_lead_time_days: 60,
      mitigation_actions: [
        'Conduct 5 customer interviews with recently activated users',
        'Map the activation funnel and identify the biggest drop-off step',
        'Review recent feature additions — have any complicated the core flow?',
        'Revisit ICP definition: has your best-fit customer profile shifted?',
      ],
      match_criteria: { activation_declining_weeks: 4 },
      severity: 'medium',
    },
    {
      id: 'fp_founder_burnout_signal',
      pattern_name: 'Founder Burnout Signal',
      description: 'Multiple simultaneous stressors combined with elevated operational risk state is a leading indicator of founder burnout. Decision quality degrades before founders self-identify the problem.',
      category: 'team_fracture',
      warning_signals: [
        '3+ active stressors simultaneously',
        'Risk state elevated or critical',
        'Decision latency increasing',
        'Agent signals repeatedly flagging the same unresolved issues',
      ],
      typical_lead_time_days: 30,
      mitigation_actions: [
        'Delegate one active stressor to a team member or advisor',
        'Schedule a structured "CEO day off" within the next 14 days',
        'Review the stressor list and close or defer anything non-critical',
        'Consider engaging a founder coach or peer accountability group',
      ],
      match_criteria: { active_stressor_count_gt: 2, risk_state: ['red', 'yellow'] },
      severity: 'high',
    },
    {
      id: 'fp_retention_floor_collapse',
      pattern_name: 'Retention Floor Collapse',
      description: 'Day-30 retention falling below cohort floor signals a fundamental engagement problem. Retention is a leading indicator of LTV and referral rates — both compound negatively if unchecked.',
      category: 'churn_spike',
      warning_signals: [
        'Day-30 retention below 15%',
        'NPS declining',
        'Feature usage breadth narrowing in retained cohorts',
        'Activation completions not translating to weekly active users',
      ],
      typical_lead_time_days: 40,
      mitigation_actions: [
        'Identify the "aha moment" and streamline the path to it',
        'Implement a day-7 and day-14 re-engagement sequence',
        'Survey users who activated but did not return after week 1',
        'Audit notification and email touchpoints for quality and relevance',
      ],
      match_criteria: { churn_rate_gt: 10, nps_lt: 5 },
      severity: 'high',
    },
    {
      id: 'fp_cac_payback_spiral',
      pattern_name: 'CAC Payback Spiral',
      description: 'When churn is high and growth is flat, Customer Acquisition Cost payback periods extend indefinitely. Companies in this pattern are effectively paying to acquire customers they will lose before recovering the cost.',
      category: 'growth_stall',
      warning_signals: [
        'Churn rate above 6%',
        'MRR growth below 3%',
        'Marketing spend increasing without corresponding revenue',
        'CAC payback period extending quarter-over-quarter',
      ],
      typical_lead_time_days: 75,
      mitigation_actions: [
        'Pause paid acquisition until churn is under control',
        'Focus exclusively on retention and expansion for 60 days',
        'Model unit economics at current churn rate — is the business viable?',
        'Identify highest-LTV customer segment and double down on that channel only',
      ],
      match_criteria: { churn_rate_gt: 6, mrr_growth_lt: 3 },
      severity: 'medium',
    },
    {
      id: 'fp_icp_fragmentation',
      pattern_name: 'ICP Fragmentation',
      description: 'Serving too many different customer types simultaneously degrades product quality for all of them. This pattern manifests as declining NPS across segments and increasing support complexity.',
      category: 'product_drift',
      warning_signals: [
        'NPS varies widely across customer segments',
        'Feature requests pulling in divergent directions',
        'Support volume growing faster than user count',
        'Onboarding requires heavy customisation per customer type',
      ],
      typical_lead_time_days: 90,
      mitigation_actions: [
        'Run a cohort analysis: which customer type has the highest LTV and NPS?',
        'Formally narrow ICP to the top 1-2 segments',
        'Communicate ICP focus to sales and marketing',
        'Create a "not our customer" definition and use it to gracefully decline poor-fit leads',
      ],
      match_criteria: { nps_lt: 5, active_stressor_count_gt: 1 },
      severity: 'medium',
    },
    {
      id: 'fp_seed_to_growth_stall',
      pattern_name: 'Seed-to-Growth Stall',
      description: 'Exhausting seed capital before reaching a repeatable growth motion is a well-known way to stall at the transition to Series A: the money runs out while the thing that would raise the next round is still being looked for.',
      category: 'growth_stall',
      warning_signals: [
        'MRR growth declining 3+ consecutive months',
        'Sales cycle lengthening without conversion improvements',
        'Runway under 9 months',
        'No scalable customer acquisition channel identified',
      ],
      typical_lead_time_days: 120,
      mitigation_actions: [
        'Document your three best-fit customers in detail — find 10 more exactly like them',
        'Define one repeatable motion (outbound, PLG, or partnerships) and run 90-day experiments',
        'Do not hire additional headcount until one channel shows >30% month-over-month growth',
        'Engage a Series A advisor to benchmark your metrics against current investor expectations',
      ],
      match_criteria: { mrr_growth_lt: 5, runway_months_lt: 9 },
      severity: 'high',
    },
    {
      id: 'fp_nps_freefall',
      pattern_name: 'NPS Freefall',
      description: 'A rapidly declining NPS is one of the shapes most often cited as preceding churn. Customers rarely leave silently, and sentiment tends to move before revenue does — which is the whole reason to watch it.',
      category: 'churn_spike',
      warning_signals: [
        'NPS below 0 or declining >10 points over 60 days',
        'Negative reviews appearing on G2/Capterra',
        'Support escalations increasing',
        'Renewal conversations becoming adversarial',
      ],
      typical_lead_time_days: 70,
      mitigation_actions: [
        'Close the loop on every detractor personally within 48 hours',
        'Identify the top 3 reasons for detractor scores and build a 30-day fix plan',
        'Launch a "fix what is broken" sprint — stop new features until NPS stabilises',
        'Consider a customer advisory board to rebuild trust with vocal users',
      ],
      match_criteria: { nps_lt: 0 },
      severity: 'critical',
    },
  ];

  for (const p of patterns) {
    await query(
      `INSERT OR IGNORE INTO failure_patterns
       (id, pattern_name, description, category, warning_signals_json,
        typical_lead_time_days, mitigation_actions_json, match_criteria_json, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id,
        p.pattern_name,
        p.description,
        p.category,
        JSON.stringify(p.warning_signals),
        p.typical_lead_time_days,
        JSON.stringify(p.mitigation_actions),
        JSON.stringify(p.match_criteria),
        p.severity,
        now,
      ],
    );
  }
}

// ─── Pattern Matching Engine ──────────────────────────────────────────────────

interface ProductState {
  churn_rate: number | null;
  nps_score: number | null;
  activation_rate: number | null;
  mrr_growth_rate: number | null;
  mrr_growth_weeks: number; // weeks below threshold
  runway_months: number | null;
  has_fundraising_activity: boolean;
  activation_declining_weeks: number;
  active_stressor_count: number;
  risk_state: string;
}

/** Exposed for the test that holds the runway to being a measurement. */
export async function __loadProductStateForTest(productId: string): Promise<ProductState> {
  return loadProductState(productId);
}

async function loadProductState(productId: string): Promise<ProductState> {
  const [snapshotsResult, stressorsResult, lifecycleResult, fundraisingResult] = await Promise.all([
    query(
      `SELECT new_mrr_cents, churn_rate, activation_rate, nps_score, snapshot_date
       FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 8`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) as cnt FROM stressor_history WHERE product_id = ? AND status = 'active'`,
      [productId],
    ),
    query(
      `SELECT risk_state FROM lifecycle_state WHERE product_id = ?`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) as cnt FROM fundraising_scores WHERE product_id = ? AND generated_at > datetime('now', '-90 days')`,
      [productId],
    ),
  ]);

  const snapshots = snapshotsResult.rows as Array<Record<string, unknown>>;
  const latest = snapshots[0] ?? null;
  const oldest = snapshots[Math.min(snapshots.length - 1, 7)] ?? null;

  // MRR growth rate (latest vs 4-week-ago snapshot)
  let mrr_growth_rate: number | null = null;
  const compare = snapshots[3] ?? null;
  if (latest && compare) {
    const lMrr = (latest.new_mrr_cents as number | null) ?? 0;
    const cMrr = (compare.new_mrr_cents as number | null) ?? 0;
    if (cMrr > 0) mrr_growth_rate = ((lMrr - cMrr) / cMrr) * 100;
  }

  // Count weeks where MRR growth was below 2%
  let mrr_growth_weeks = 0;
  for (let i = 0; i < Math.min(snapshots.length - 1, 6); i++) {
    const curr = (snapshots[i]?.new_mrr_cents as number | null) ?? 0;
    const prev = (snapshots[i + 1]?.new_mrr_cents as number | null) ?? 0;
    if (prev > 0 && ((curr - prev) / prev) * 100 < 2) mrr_growth_weeks++;
  }

  // Count weeks where activation rate was declining
  let activation_declining_weeks = 0;
  for (let i = 0; i < Math.min(snapshots.length - 1, 6); i++) {
    const curr = (snapshots[i]?.activation_rate as number | null) ?? null;
    const prev = (snapshots[i + 1]?.activation_rate as number | null) ?? null;
    if (curr !== null && prev !== null && curr < prev) activation_declining_weeks++;
  }

  // A RUNWAY THAT WAS THE CONSTANT 8, FOR EVERY COMPANY.
  //
  // The old estimate was `min(24, (mrr * 2) / (mrr / 4))`. The "burn" it
  // divided by was the same MRR figure it divided, so the MRR cancels and the
  // expression is 8 — always, for every company with any revenue at all, and
  // null for every company without. Two failure patterns key on it: one asks
  // for runway under 6 months and could therefore NEVER match, and the other
  // asks for under 9 and therefore ALWAYS matched. A founder was shown "8" as
  // an estimate of how long their cash lasts.
  //
  // Foundry cannot derive a cash balance. Migration 181 settled that: it is a
  // fact about a bank account, so it is STATED by the founder, dated, and
  // attributed — and absent, runway is unknown. This reads that one source and
  // says nothing when there is nothing to say, which leaves both thresholds
  // unfired rather than one permanently on.
  const position = await getFinancialPosition(productId);
  const runway_months = position !== null && position.monthlyBurnCents > 0
    ? position.cashOnHandCents / position.monthlyBurnCents
    : null;

  const active_stressor_count = (stressorsResult.rows[0] as Record<string, number>)?.cnt ?? 0;
  const risk_state = (lifecycleResult.rows[0] as Record<string, string>)?.risk_state ?? 'green';
  const has_fundraising_activity = ((fundraisingResult.rows[0] as Record<string, number>)?.cnt ?? 0) > 0;

  // PERCENTAGE POINTS, BECAUSE THE CRITERIA ARE WRITTEN IN THEM.
  // `match_criteria: { churn_rate_gt: 8 }` means eight per cent, and
  // `churn_rate` is stored as a 0–1 fraction — so `0.08 > 8` was false and no
  // failure pattern keyed on churn could ever match, for any company. The
  // library looked like it was working: it matched on the other criteria and
  // simply never fired on this one. `nps_score` is already on its own -100..100
  // scale and is left alone.
  return {
    churn_rate: ratePoints(latest?.churn_rate),
    nps_score: (latest?.nps_score as number | null) ?? null,
    activation_rate: ratePoints(latest?.activation_rate),
    mrr_growth_rate,
    mrr_growth_weeks,
    runway_months,
    has_fundraising_activity,
    activation_declining_weeks,
    active_stressor_count,
    risk_state,
  };
}

function evaluatePattern(
  criteria: MatchCriteria,
  state: ProductState,
): { score: number; matched_signals: string[] } {
  const signals: string[] = [];
  let hits = 0;
  let total = 0;

  if (criteria.churn_rate_gt !== undefined) {
    total++;
    if (state.churn_rate !== null && state.churn_rate > criteria.churn_rate_gt) {
      hits++;
      signals.push(`Churn rate ${state.churn_rate.toFixed(1)}% exceeds ${criteria.churn_rate_gt}% threshold`);
    }
  }
  if (criteria.nps_lt !== undefined) {
    total++;
    if (state.nps_score !== null && state.nps_score < criteria.nps_lt) {
      hits++;
      signals.push(`NPS score ${state.nps_score.toFixed(0)} below threshold of ${criteria.nps_lt}`);
    }
  }
  if (criteria.mrr_growth_lt !== undefined) {
    total++;
    if (state.mrr_growth_rate !== null && state.mrr_growth_rate < criteria.mrr_growth_lt) {
      hits++;
      const weeks = criteria.mrr_growth_lt_weeks ?? 1;
      if (state.mrr_growth_weeks >= weeks) {
        signals.push(`MRR growth ${state.mrr_growth_rate.toFixed(1)}% below ${criteria.mrr_growth_lt}% for ${state.mrr_growth_weeks} weeks`);
      } else {
        signals.push(`MRR growth ${state.mrr_growth_rate.toFixed(1)}% below ${criteria.mrr_growth_lt}% threshold`);
      }
    }
  }
  if (criteria.runway_months_lt !== undefined) {
    total++;
    if (state.runway_months !== null && state.runway_months < criteria.runway_months_lt) {
      hits++;
      signals.push(`Estimated runway ${state.runway_months.toFixed(0)} months below ${criteria.runway_months_lt}-month threshold`);
    }
  }
  if (criteria.no_fundraising_activity) {
    total++;
    if (!state.has_fundraising_activity) {
      hits++;
      signals.push('No fundraising activity recorded in the last 90 days');
    }
  }
  if (criteria.activation_declining_weeks !== undefined) {
    total++;
    if (state.activation_declining_weeks >= criteria.activation_declining_weeks) {
      hits++;
      signals.push(`Activation rate declining for ${state.activation_declining_weeks} consecutive weeks`);
    }
  }
  if (criteria.active_stressor_count_gt !== undefined) {
    total++;
    if (state.active_stressor_count > criteria.active_stressor_count_gt) {
      hits++;
      signals.push(`${state.active_stressor_count} active stressors (threshold: >${criteria.active_stressor_count_gt})`);
    }
  }
  if (criteria.risk_state && criteria.risk_state.length > 0) {
    total++;
    if (criteria.risk_state.includes(state.risk_state)) {
      hits++;
      signals.push(`Risk state is "${state.risk_state}"`);
    }
  }

  const score = total > 0 ? hits / total : 0;
  return { score, matched_signals: signals };
}

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scans all failure patterns against the current product state.
 * Returns matches with score > 0.4, sorted by severity then score.
 * Persists results to pattern_matches (upsert).
 */
export async function scanForFailurePatterns(productId: string): Promise<PatternMatch[]> {
  await seedDefaultPatterns();

  const [patternsResult, state] = await Promise.all([
    query('SELECT * FROM failure_patterns ORDER BY created_at', []),
    loadProductState(productId),
  ]);

  const patterns = patternsResult.rows as unknown as FailurePatternRow[];
  const matches: PatternMatch[] = [];
  const now = new Date().toISOString();

  for (const p of patterns) {
    let criteria: MatchCriteria = {};
    try {
      criteria = JSON.parse(p.match_criteria_json) as MatchCriteria;
    } catch {
      continue;
    }

    const { score, matched_signals } = evaluatePattern(criteria, state);
    if (score < 0.4) continue;

    let warning_signals: string[] = [];
    let mitigation_actions: string[] = [];
    try {
      warning_signals = JSON.parse(p.warning_signals_json) as string[];
      mitigation_actions = JSON.parse(p.mitigation_actions_json) as string[];
    } catch {
      // leave empty
    }

    const matchId = `pm_${productId}_${p.id}`;
    await query(
      `INSERT INTO pattern_matches
       (id, product_id, failure_pattern_id, match_score, matched_signals_json,
        first_detected_at, last_checked_at, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'monitoring')
       ON CONFLICT(id) DO UPDATE SET
         match_score = excluded.match_score,
         matched_signals_json = excluded.matched_signals_json,
         last_checked_at = excluded.last_checked_at`,
      [matchId, productId, p.id, score, JSON.stringify(matched_signals), now, now],
    );

    matches.push({
      pattern: {
        id: p.id,
        pattern_name: p.pattern_name,
        description: p.description,
        category: p.category,
        severity: p.severity,
        warning_signals,
        mitigation_actions,
      },
      match_score: Math.round(score * 100) / 100,
      matched_signals,
      days_until_typical_failure: p.typical_lead_time_days,
      recommended_actions: mitigation_actions.slice(0, 3),
    });
  }

  matches.sort((a, b) => {
    const sDiff = (SEVERITY_ORDER[b.pattern.severity] ?? 0) - (SEVERITY_ORDER[a.pattern.severity] ?? 0);
    return sDiff !== 0 ? sDiff : b.match_score - a.match_score;
  });

  return matches;
}

/**
 * Returns currently active (unresolved) pattern matches for a product.
 */
export async function getActivePatternMatches(productId: string): Promise<PatternMatch[]> {
  const result = await query(
    `SELECT pm.*, fp.pattern_name, fp.description, fp.category, fp.severity,
            fp.warning_signals_json, fp.mitigation_actions_json, fp.typical_lead_time_days
     FROM pattern_matches pm
     JOIN failure_patterns fp ON fp.id = pm.failure_pattern_id
     WHERE pm.product_id = ? AND pm.resolved_at IS NULL
     ORDER BY pm.first_detected_at DESC`,
    [productId],
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    let warning_signals: string[] = [];
    let mitigation_actions: string[] = [];
    let matched_signals: string[] = [];
    try { warning_signals = JSON.parse(r.warning_signals_json as string) as string[]; } catch { /* empty */ }
    try { mitigation_actions = JSON.parse(r.mitigation_actions_json as string) as string[]; } catch { /* empty */ }
    try { matched_signals = JSON.parse(r.matched_signals_json as string) as string[]; } catch { /* empty */ }

    return {
      pattern: {
        id: r.failure_pattern_id as string,
        pattern_name: r.pattern_name as string,
        description: r.description as string,
        category: r.category as string,
        severity: r.severity as string,
        warning_signals,
        mitigation_actions,
      },
      match_score: r.match_score as number,
      matched_signals,
      days_until_typical_failure: (r.typical_lead_time_days as number | null) ?? null,
      recommended_actions: mitigation_actions.slice(0, 3),
    };
  });
}

/**
 * Mark a pattern match as resolved with a given outcome.
 */
export async function resolvePattern(
  matchId: string,
  outcome: 'avoided' | 'occurred',
  ownerId: string,
): Promise<void> {
  await query(
    `UPDATE pattern_matches SET resolved_at = datetime('now'), outcome = ?
     WHERE id = ? AND product_id IN (SELECT id FROM products WHERE owner_id = ?)`,
    [outcome, matchId, ownerId],
  );
}

/**
 * Returns all failure patterns in the library.
 */
export async function getAllFailurePatterns(): Promise<FailurePatternRow[]> {
  await seedDefaultPatterns();
  const result = await query('SELECT * FROM failure_patterns ORDER BY severity DESC, pattern_name', []);
  return result.rows as unknown as FailurePatternRow[];
}
