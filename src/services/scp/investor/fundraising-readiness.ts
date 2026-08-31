// =============================================================================
// FOUNDRY — Fundraising Readiness Assessment
// Scores startup readiness across 5 dimensions, generates gap recommendations.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { ratePoints } from '../../ai/measured.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FundraisingReadiness {
  target_round: 'pre_seed' | 'seed' | 'series_a' | 'series_b';
  overall_score: number;
  scores: {
    traction: number;
    team: number;
    market: number;
    unit_economics: number;
    narrative: number;
  };
  gaps: Array<{
    dimension: string;
    gap: string;
    recommendation: string;
    urgency: 'high' | 'medium' | 'low';
  }>;
  ready_to_raise: boolean;
  estimated_weeks_to_ready: number | null;
}

// ─── Round multipliers (higher round = higher bar) ────────────────────────────

const ROUND_MULTIPLIERS: Record<FundraisingReadiness['target_round'], number> = {
  pre_seed: 0.5,
  seed: 1.0,
  series_a: 2.0,
  series_b: 3.5,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── Algorithmic Scoring ──────────────────────────────────────────────────────

interface ProductData {
  mrr_cents: number | null;
  mrr_growth_pct: number | null;
  churn_rate: number | null;
  customer_count: number | null;
  activation_rate: number | null;
  d30_retention: number | null;
  dna_completion_pct: number | null;
  has_cto: boolean;
  has_advisors: boolean;
  has_key_hires: boolean;
  has_icp_defined: boolean;
  has_competitive_section: boolean;
  has_positioning: boolean;
  has_cohort_data: boolean;
  has_cac_tracked: boolean;
  has_hypothesis_tested: boolean;
  lifecycle_state: string | null;
}

function scoreTraction(data: ProductData, mult: number): number {
  let points = 0;
  const mrr = data.mrr_cents !== null ? data.mrr_cents / 100 : 0;
  const mrrThreshold = 10000 * mult; // $10k seed threshold, scaled
  if (mrr >= mrrThreshold) points += 2;
  else if (mrr >= mrrThreshold / 2) points += 1;

  const growthThreshold = 15 / mult; // 15%/mo seed, lower for series A
  if ((data.mrr_growth_pct ?? 0) >= growthThreshold) points += 2;
  else if ((data.mrr_growth_pct ?? 0) >= growthThreshold / 2) points += 1;

  const churnThreshold = 3 * mult; // 3% max for seed, higher tolerance for pre-seed
  if (data.churn_rate !== null && data.churn_rate <= churnThreshold) points += 2;
  else if (data.churn_rate !== null && data.churn_rate <= churnThreshold * 2) points += 1;

  const customerThreshold = 10 * mult;
  if ((data.customer_count ?? 0) >= customerThreshold) points += 2;
  else if ((data.customer_count ?? 0) >= customerThreshold / 2) points += 1;

  const retentionThreshold = 40 / mult;
  if ((data.d30_retention ?? 0) >= retentionThreshold) points += 2;
  else if ((data.d30_retention ?? 0) >= retentionThreshold / 2) points += 1;

  // Max raw = 10
  return clamp((points / 10) * 10, 0, 10);
}

function scoreTeam(data: ProductData): number {
  let points = 0;
  if (data.has_cto) points += 3;
  if (data.has_advisors) points += 1;
  if (data.has_key_hires) points += 1;
  // CEO assumed present (they're using Foundry)
  points += 2; // CEO baseline
  // Cap at 7 if no CTO
  const rawMax = data.has_cto ? 7 : 4;
  return clamp((points / rawMax) * 10, 0, 10);
}

function scoreMarket(data: ProductData): number {
  let points = 0;
  if (data.has_competitive_section) points += 2;
  if (data.has_icp_defined) points += 2;
  if (data.has_positioning) points += 2;
  // Max 6 points → scale to 10
  return clamp((points / 6) * 10, 0, 10);
}

function scoreUnitEconomics(data: ProductData): number {
  let points = 0;
  if ((data.activation_rate ?? 0) >= 30) points += 2;
  else if ((data.activation_rate ?? 0) >= 15) points += 1;
  if (data.has_cohort_data) points += 2;
  if (data.has_cac_tracked) points += 2;
  // Bonus for good activation
  if ((data.activation_rate ?? 0) >= 50) points += 2;
  // Max 8 → scale to 10
  return clamp((points / 8) * 10, 0, 10);
}

function scoreNarrative(data: ProductData): number {
  let points = 0;
  const dna = data.dna_completion_pct ?? 0;
  if (dna >= 60) points += 2;
  else if (dna >= 30) points += 1;
  if (data.has_hypothesis_tested) points += 2;
  // Story arc: lifecycle indicates clear direction
  if (data.lifecycle_state && data.lifecycle_state !== 'setup') points += 2;
  if (dna >= 80) points += 2; // strong DNA = strong narrative
  // Max 8 → scale to 10
  return clamp((points / 8) * 10, 0, 10);
}

// ─── assessFundraisingReadiness ───────────────────────────────────────────────

export async function assessFundraisingReadiness(
  productId: string,
  targetRound: FundraisingReadiness['target_round']
): Promise<FundraisingReadiness> {
  const mult = ROUND_MULTIPLIERS[targetRound];

  // Load metrics — two snapshots, because growth needs a previous level to
  // compare against and there is no growth column to read.
  let metricsRow: Record<string, unknown> = {};
  let mrrGrowthPct: number | null = null;
  try {
    const metricsResult = await query(
      'SELECT * FROM metric_snapshots WHERE product_id=? ORDER BY snapshot_date DESC LIMIT 2',
      [productId]
    );
    if (metricsResult.rows.length > 0) {
      metricsRow = metricsResult.rows[0] as Record<string, unknown>;
    }
    // ...AND THE THRESHOLD IT IS SCORED AGAINST IS 15%/MONTH. The two
    // snapshots are consecutive rows, which for a daily reporter is yesterday,
    // so a company growing 0.5% a day — about 16% a month, over the bar —
    // scored zero of the two points and was told "growth: 0.5%/mo" in an
    // investor-readiness assessment. The rate is monthly-equivalent, from the
    // gap between the two dates.
    const prior = metricsResult.rows[1] as Record<string, unknown> | undefined;
    const now = metricsRow.mrr_cents == null ? null : Number(metricsRow.mrr_cents);
    const then = prior?.mrr_cents == null ? null : Number(prior.mrr_cents);
    const gapDays = (Date.parse(`${String(metricsRow.snapshot_date)}T00:00:00Z`)
      - Date.parse(`${String(prior?.snapshot_date)}T00:00:00Z`)) / 86_400_000;
    if (now !== null && then !== null && then > 0
      && Number.isFinite(gapDays) && gapDays > 0) {
      mrrGrowthPct = ((now / then) ** (30.44 / gapDays) - 1) * 100;
    }
  } catch { /* ok */ }

  // Customers counted where they actually live, across both stores. There is
  // no customer count on a metric snapshot.
  let customerCount: number | null = null;
  try {
    const { getCompanyCustomers } = await import('../../institution/company-customers.js');
    customerCount = (await getCompanyCustomers(productId)).length;
  } catch { /* ok */ }

  // Load DNA
  let dnaCompletion = 0;
  let hasICP = false;
  let hasCompetitive = false;
  let hasPositioning = false;
  let hasHypothesisTested = false;
  try {
    const dnaResult = await query(
      'SELECT * FROM product_dna WHERE product_id=? LIMIT 1',
      [productId]
    );
    if (dnaResult.rows.length > 0) {
      // FIVE MORE COLUMNS THAT DO NOT EXIST, IN THE SAME ASSESSMENT.
      //
      // `target_customer`, `competitors`, `positioning`, `core_hypothesis` and
      // `hypothesis_validated` have never been columns on `product_dna`. Read
      // off a `SELECT *` row they are `undefined`, so all four flags were FALSE
      // for every company that has ever run this — six of the ten points on the
      // narrative dimension and two on the traction dimension, withheld from
      // everybody, in an assessment of whether they are ready to raise.
      //
      // The real fields are `icp_description`, `competitive_landscape` and
      // `positioning_statement`. There is no hypothesis on the DNA at all: a
      // tested hypothesis is one in the `hypotheses` table that has reached a
      // terminal status, which is what "tested" means — including 'disproven'
      // and 'inconclusive', because a hypothesis that failed was still tested.
      const dnaRow = dnaResult.rows[0] as Record<string, unknown>;
      dnaCompletion = (dnaRow.completion_pct as number) ?? 0;
      const filled = (v: unknown) => !!(v && String(v).trim().length > 20);
      hasICP = filled(dnaRow.icp_description);
      hasCompetitive = filled(dnaRow.competitive_landscape);
      hasPositioning = filled(dnaRow.positioning_statement);
    }
  } catch { /* ok */ }

  try {
    const testedResult = await query(
      `SELECT COUNT(*) AS cnt FROM hypotheses
        WHERE product_id = ? AND status IN ('completed','disproven','inconclusive')`,
      [productId],
    );
    hasHypothesisTested = Number((testedResult.rows[0] as Record<string, unknown>)?.cnt ?? 0) > 0;
  } catch { /* an unreadable table is not a hypothesis nobody tested */ }

  // Load lifecycle state (has_cto, advisors, etc.)
  let lifecycleState: string | null = null;
  try {
    const lsResult = await query(
      'SELECT company_lifecycle_state FROM products WHERE id=?',
      [productId]
    );
    if (lsResult.rows.length > 0) {
      lifecycleState = (lsResult.rows[0] as Record<string, unknown>).company_lifecycle_state as string ?? null;
    }
  } catch { /* ok */ }

  // Load team info (from product or founders table)
  let hasCTO = false;
  let hasAdvisors = false;
  let hasKeyHires = false;
  try {
    const teamResult = await query(
      `SELECT role FROM team_members WHERE product_id=? AND status='active'`,
      [productId]
    );
    const roles = teamResult.rows.map((r) => ((r as Record<string, unknown>).role as string ?? '').toLowerCase());
    hasCTO = roles.some((r) => r.includes('cto') || r.includes('chief technology'));
    hasAdvisors = roles.some((r) => r.includes('advisor'));
    hasKeyHires = roles.length >= 3;
  } catch { /* ok */ }

  // Load cohort data existence
  let hasCohortData = false;
  try {
    const cohortResult = await query(
      'SELECT COUNT(*) as cnt FROM cohorts WHERE product_id=?',
      [productId]
    );
    hasCohortData = ((cohortResult.rows[0] as Record<string, unknown>)?.cnt as number) > 0;
  } catch { /* ok */ }

  // Load CAC tracking
  let hasCACTracked = false;
  try {
    // `cac_cents` is not on `metric_snapshots` and never was — CAC is recorded
    // on `unit_economics_snapshots.cac`. This query raised, the catch swallowed
    // it, and every company was reported to an investor-readiness score as not
    // tracking customer acquisition cost, including the ones that do.
    const cacResult = await query(
      `SELECT COUNT(*) as cnt FROM unit_economics_snapshots
       WHERE product_id=? AND cac IS NOT NULL LIMIT 1`,
      [productId]
    );
    hasCACTracked = ((cacResult.rows[0] as Record<string, unknown>)?.cnt as number) > 0;
  } catch { /* ok */ }

  const data: ProductData = {
    mrr_cents: metricsRow.mrr_cents as number | null,
    // `mrr_growth_pct` AND `customer_count` ARE NOT COLUMNS on
    // `metric_snapshots` and never have been. Read off a `SELECT *` row, they
    // were `undefined` forever, so the growth and customer tests in
    // `scoreTraction` could never award their four points to anybody. Growth is
    // computed here from two snapshots of the level; the customer count comes
    // from the accessor that actually knows, across both customer stores.
    mrr_growth_pct: mrrGrowthPct,
    churn_rate: ratePoints(metricsRow.churn_rate),
    customer_count: customerCount,
    // POINTS, NOT FRACTIONS — every threshold below is written in percentage
    // points. And `d30_retention` is not a column: the real one is
    // `day_30_retention`, so this read `undefined` and scored zero for every
    // company that has ever reported retention.
    activation_rate: ratePoints(metricsRow.activation_rate),
    d30_retention: ratePoints(metricsRow.day_30_retention),
    dna_completion_pct: dnaCompletion,
    has_cto: hasCTO,
    has_advisors: hasAdvisors,
    has_key_hires: hasKeyHires,
    has_icp_defined: hasICP,
    has_competitive_section: hasCompetitive,
    has_positioning: hasPositioning,
    has_cohort_data: hasCohortData,
    has_cac_tracked: hasCACTracked,
    has_hypothesis_tested: hasHypothesisTested,
    lifecycle_state: lifecycleState,
  };

  // 2. Score each dimension algorithmically
  const scores = {
    traction: parseFloat(scoreTraction(data, mult).toFixed(1)),
    team: parseFloat(scoreTeam(data).toFixed(1)),
    market: parseFloat(scoreMarket(data).toFixed(1)),
    unit_economics: parseFloat(scoreUnitEconomics(data).toFixed(1)),
    narrative: parseFloat(scoreNarrative(data).toFixed(1)),
  };

  const overall_score = parseFloat(
    ((scores.traction + scores.team + scores.market + scores.unit_economics + scores.narrative) / 5).toFixed(1)
  );

  // 3. Generate gap recommendations using Claude (brief, targeted)
  const lowScores = Object.entries(scores)
    .filter(([, v]) => v < 7)
    .map(([k, v]) => `${k}: ${v}/10`)
    .join(', ');

  const systemPrompt = `You are a startup fundraising advisor. Generate concise, actionable gap recommendations.
Return only a JSON array. Be specific and honest.`;

  const userPrompt = `For a ${targetRound.replace('_', ' ')} fundraise, generate gap recommendations for these low-scoring dimensions: ${lowScores || 'none'}.

Scores context:
- Traction: ${scores.traction}/10 (MRR: ${data.mrr_cents !== null ? '$' + (data.mrr_cents / 100).toLocaleString() : 'N/A'}, growth: ${data.mrr_growth_pct ?? 'N/A'}%/mo)
- Team: ${scores.team}/10 (has CTO: ${data.has_cto}, advisors: ${data.has_advisors})
- Market: ${scores.market}/10 (ICP defined: ${data.has_icp_defined}, competitive moat: ${data.has_competitive_section})
- Unit Economics: ${scores.unit_economics}/10 (activation: ${data.activation_rate ?? 'N/A'}%, cohort data: ${data.has_cohort_data})
- Narrative: ${scores.narrative}/10 (DNA completion: ${dnaCompletion}%, hypothesis tested: ${data.has_hypothesis_tested})

Return a JSON array (max 5 items):
[
  {
    "dimension": "traction|team|market|unit_economics|narrative",
    "gap": "specific gap description",
    "recommendation": "concrete action to close the gap",
    "urgency": "high|medium|low"
  }
]

If all scores are >= 7, return an empty array [].`;

  let gaps: FundraisingReadiness['gaps'] = [];
  try {
    const gapResponse = await callSonnet(systemPrompt, userPrompt, 1000, productId);
    gaps = parseJSONResponse<FundraisingReadiness['gaps']>(gapResponse.content);
  } catch {
    // Fallback: generate basic gaps from low scores
    for (const [dimension, score] of Object.entries(scores)) {
      if (score < 5) {
        gaps.push({
          dimension,
          gap: `${dimension} score is ${score}/10, below the ${targetRound} bar`,
          recommendation: `Focus on improving ${dimension} metrics before approaching investors`,
          urgency: score < 3 ? 'high' : 'medium',
        });
      }
    }
  }

  const ready_to_raise = overall_score >= 7.0;
  const estimated_weeks_to_ready = ready_to_raise
    ? null
    : Math.round(((7.0 - overall_score) / 0.5) * 2); // rough estimate: 0.5 point gain per 2 weeks

  const result: FundraisingReadiness = {
    target_round: targetRound,
    overall_score,
    scores,
    gaps,
    ready_to_raise,
    estimated_weeks_to_ready,
  };

  // 4. INSERT into fundraising_scores
  await query(
    `INSERT INTO fundraising_scores
       (id, product_id, target_round, overall_score, scores_json, gaps_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      productId,
      targetRound,
      overall_score,
      JSON.stringify(scores),
      JSON.stringify(gaps),
    ]
  );

  return result;
}

// ─── getLatestReadinessScore ──────────────────────────────────────────────────

export async function getLatestReadinessScore(
  productId: string,
  targetRound: string
): Promise<FundraisingReadiness | null> {
  const result = await query(
    `SELECT * FROM fundraising_scores
     WHERE product_id=? AND target_round=?
     ORDER BY generated_at DESC LIMIT 1`,
    [productId, targetRound]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as Record<string, unknown>;
  const scores = parseJSON<FundraisingReadiness['scores']>(row.scores_json as string, {
    traction: 0,
    team: 0,
    market: 0,
    unit_economics: 0,
    narrative: 0,
  });
  const gaps = parseJSON<FundraisingReadiness['gaps']>(row.gaps_json as string, []);
  const overall_score = row.overall_score as number;
  return {
    target_round: row.target_round as FundraisingReadiness['target_round'],
    overall_score,
    scores,
    gaps,
    ready_to_raise: overall_score >= 7.0,
    estimated_weeks_to_ready:
      overall_score >= 7.0 ? null : Math.round(((7.0 - overall_score) / 0.5) * 2),
  };
}
