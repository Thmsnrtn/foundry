// =============================================================================
// FOUNDRY — M&A Readiness Assessment
// Algorithmic scoring across 5 dimensions. No AI for scores — just rules.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { ratePoints } from '../../ai/measured.js';
import { getCompanyCustomers } from '../../institution/company-customers.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MAReadinessScore {
  id: string;
  overall_score: number; // 0-10
  revenue_quality_score: number;
  ip_clarity_score: number;
  team_retention_score: number;
  integration_complexity_score: number;
  /** NULL when Foundry knows of no paying customer for this company: the
   *  dimension is unmeasured, which is not the same as middling. It drops out
   *  of `overall_score` rather than contributing a stand-in. */
  customer_concentration_score: number | null;
  ready_to_be_acquired: boolean;
  key_gaps: string[];
  target_acquirer_profile: string;
  estimated_multiple_range: string;
  assessed_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function parseJSONSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ─── Dimension Scorers ────────────────────────────────────────────────────────

/** Exported for the units test: the churn band is compared in percentage
 *  points and the column is a fraction, which is only checkable by running it. */
export function scoreRevenueQuality(
  nrr: number | null,
  churnRate: number | null,
  mrrGrowthHistory: number[],
): number {
  let points = 0;

  // NRR: Net Revenue Retention
  if (nrr !== null) {
    if (nrr >= 110) points += 4;
    else if (nrr >= 100) points += 3;
    else if (nrr >= 90) points += 1;
  } else {
    points += 2; // neutral if unknown
  }

  // Churn. THE THRESHOLDS ARE PERCENTAGE POINTS AND THE COLUMN IS A FRACTION.
  //
  // `metric_snapshots.churn_rate` is stored 0–1 — the ingest validator pins it
  // with `z.number().min(0).max(1)` and every display path multiplies by 100.
  // Compared raw against 2/3/5, EVERY measured churn rate cleared the best
  // band, including a company churning 100% of its revenue a month, which
  // arrives here as 1.
  //
  // The tell was inside the branch. A MEASURED churn scored 3 of 3
  // unconditionally while an UNKNOWN one scored 1: the fallback and the
  // measurement disagreed about the arithmetic that follows, which is what a
  // units bug looks like from the outside. NRR two branches up is converted to
  // percentage points before its own 110/100/90 comparison, so churn was the
  // odd one out in its own function.
  //
  // `ratePoints` exists for exactly this and carries the same explanation.
  const churnPct = ratePoints(churnRate);
  if (churnPct !== null) {
    if (churnPct <= 2) points += 3;
    else if (churnPct <= 3) points += 2;
    else if (churnPct <= 5) points += 1;
  } else {
    points += 1;
  }

  // MRR growth consistency: at least 3 data points with positive growth
  if (mrrGrowthHistory.length >= 3) {
    const positiveMonths = mrrGrowthHistory.filter((g) => g > 0).length;
    const consistency = positiveMonths / mrrGrowthHistory.length;
    if (consistency >= 0.8) points += 3;
    else if (consistency >= 0.6) points += 2;
    else if (consistency >= 0.4) points += 1;
  } else {
    points += 1;
  }

  // Max raw = 10
  return clamp((points / 10) * 10, 0, 10);
}

function scoreIPClarity(companyAgeDays: number): number {
  // No way to auto-detect IP issues — use company age as proxy
  // Older companies are more likely to have cleaned up IP
  if (companyAgeDays >= 730) return 9.0; // 2+ years
  if (companyAgeDays >= 365) return 8.0; // 1-2 years
  if (companyAgeDays >= 180) return 7.0; // 6-12 months
  return 6.0; // Early stage — IP likely not formalized
}

function scoreTeamRetention(
  teamSize: number,
  companyAgeDays: number,
  vestingRecorded: boolean,
): number {
  let points = 0;

  // Larger teams = better distributed key-person risk
  if (teamSize >= 10) points += 3;
  else if (teamSize >= 5) points += 2;
  else if (teamSize >= 3) points += 1;

  // Company age as vesting proxy (founders approaching cliff = higher risk)
  if (companyAgeDays >= 365) points += 3; // past typical 1-year cliff
  else if (companyAgeDays >= 180) points += 2;
  else points += 1;

  // VESTING IS NOT RECORDED, so this branch is always the second one. Kept as
  // the conservative point rather than removed, because removing it would
  // rescale every company's historic score to hide a fact about Foundry's
  // records. The gap list says what is actually going on.
  if (vestingRecorded) points += 2;
  else points += 1;

  // Baseline: 2 for being in business
  points += 2;

  // Max raw = 10
  return clamp((points / 10) * 10, 0, 10);
}

function scoreIntegrationComplexity(integrationCount: number): number {
  // More integrations = more API-first = easier to integrate in M&A
  // Paradox: too many integrations can add complexity too — cap at 8
  if (integrationCount >= 10) return 8.0;
  if (integrationCount >= 5) return 7.0;
  if (integrationCount >= 2) return 6.0;
  if (integrationCount >= 1) return 5.0;
  return 4.0; // No integrations — uncertain acquirability
}

/**
 * Null when nothing is known about who pays this company.
 *
 * It used to return 5.0 for "no data" — a middling score, indistinguishable
 * from a company measured at moderate concentration, and it went into the
 * weighted average at the heaviest weight in the report. AN UNMEASURED
 * DIMENSION IS NOT A MIDDLING ONE.
 */
/** The largest customer's share of what this company's customers pay, banded.
 *
 *  NULL IN, NULL OUT, and there is no third branch. The version this replaces
 *  had one: when the share was unknown it estimated a score from the number of
 *  customers — 50+ customers scored 8.0, "many customers = lower concentration
 *  risk". That is a rule of thumb, and it was displayed beside four measured
 *  dimensions as if it were one of them. A share Foundry cannot compute is a
 *  dimension it did not measure. */
function scoreCustomerConcentration(topCustomerMrrPct: number | null): number | null {
  if (topCustomerMrrPct === null) return null;

  if (topCustomerMrrPct <= 10) return 9.0;
  if (topCustomerMrrPct <= 20) return 7.0;
  if (topCustomerMrrPct <= 30) return 5.0;
  if (topCustomerMrrPct <= 50) return 3.0;
  return 1.0; // Single customer risk
}

// ─── Gap Identification ───────────────────────────────────────────────────────

function identifyGaps(scores: {
  revenue_quality: number;
  ip_clarity: number;
  team_retention: number;
  integration_complexity: number;
  customer_concentration: number | null;
}): string[] {
  const gaps: string[] = [];

  if (scores.revenue_quality < 7) {
    gaps.push('Revenue quality needs improvement — target NRR > 110% and churn < 2% to attract premium acquirers');
  }
  if (scores.ip_clarity < 7) {
    gaps.push('IP clarity is low — ensure all code, patents, and trademarks are properly assigned to the company');
  }
  if (scores.team_retention < 7) {
    gaps.push('Team retention risk is elevated — ensure founders and key hires have proper vesting schedules');
  }
  // A gap in Foundry's records, stated as one. The team-retention score is
  // computed as though no vesting is in place because nothing here records
  // whether it is — and a founder reading a readiness report should be told
  // which of its findings are about their company and which are about what
  // this report can see.
  gaps.push('Vesting schedules are not tracked in Foundry, so team retention is scored without them — confirm founder and key-hire vesting separately before diligence');
  if (scores.integration_complexity < 7) {
    gaps.push('Limited integration ecosystem — building an API-first product and key integrations increases strategic value');
  }
  if (scores.customer_concentration === null) {
    // The same rule as the vesting line above: a gap in Foundry's records,
    // stated as one. A concentration score of 5 used to appear here as a
    // finding about the company when it was a finding about the data.
    gaps.push('Foundry knows of no paying customers for this company, so customer concentration is not scored — report your top-customer revenue share separately before diligence');
  } else if (scores.customer_concentration < 7) {
    gaps.push('Customer concentration risk — reduce dependency on top customers, target no single customer > 20% of MRR');
  }

  return gaps;
}

// ─── Acquirer Profile & Multiple Range ───────────────────────────────────────

function deriveAcquirerProfile(
  overall: number,
  revenueQuality: number,
  integrationScore: number,
  mrr: number,
): string {
  if (mrr >= 100000 && revenueQuality >= 7) {
    return 'Strategic acquirer (growth-stage tech company seeking recurring revenue and customer base)';
  }
  if (integrationScore >= 7) {
    return 'Platform company looking to expand ecosystem and reduce integration build cost';
  }
  if (overall >= 7) {
    return 'Vertical SaaS acquirer or PE-backed roll-up seeking proven product in your category';
  }
  return 'Acqui-hire or early-stage strategic buyer focused on technology and team';
}

function deriveMultipleRange(
  overall: number,
  revenueQuality: number,
  mrr: number,
): string {
  const arr = mrr * 12;

  if (arr < 100000) {
    return '1-3x ARR (pre-scale, primarily acqui-hire value)';
  }

  if (overall >= 8 && revenueQuality >= 8) {
    if (arr >= 1000000) return '8-15x ARR (premium: strong metrics, scale)';
    return '6-10x ARR (strong metrics, approaching scale)';
  }
  if (overall >= 7) {
    return '4-7x ARR (good profile, some gaps remain)';
  }
  if (overall >= 5) {
    return '2-5x ARR (below-average readiness, gaps suppress multiple)';
  }
  return '1-3x ARR (significant gaps — multiple is heavily discounted)';
}

// ─── assessMAReadiness ────────────────────────────────────────────────────────

export async function assessMAReadiness(productId: string): Promise<MAReadinessScore> {
  // ── 1. Load latest metrics snapshot ──
  let metricsRow: Record<string, unknown> = {};
  try {
    const res = await query(
      'SELECT * FROM metric_snapshots WHERE product_id=? ORDER BY snapshot_date DESC LIMIT 1',
      [productId]
    );
    if (res.rows.length > 0) metricsRow = res.rows[0] as Record<string, unknown>;
  } catch { /* ok */ }

  const mrr = metricsRow.mrr_cents != null ? (metricsRow.mrr_cents as number) / 100 : 0;
  const churnRate = metricsRow.churn_rate as number | null;

  // ── 2. Load historical MRR growth for consistency check ──
  // `mrr_growth_pct` is not a column and never has been. This query raised on
  // every call and the catch swallowed it, so the growth-consistency check
  // scored every company as having no history — silently, inside a readiness
  // report a founder takes to an acquirer. Growth comes from consecutive
  // snapshots, which is where it was always going to have to come from.
  const mrrGrowthHistory: number[] = [];
  try {
    const res = await query(
      `SELECT mrr_cents FROM metric_snapshots
       WHERE product_id=? AND mrr_cents IS NOT NULL
       ORDER BY snapshot_date DESC LIMIT 7`,
      [productId]
    );
    const series = (res.rows as unknown as Array<Record<string, unknown>>)
      .map((r) => Number(r.mrr_cents));
    for (let i = 0; i + 1 < series.length; i++) {
      const current = series[i];
      const prior = series[i + 1];
      // Growth from zero has no denominator. Skipping the period is honest;
      // calling it 100% would put a number in an acquirer's hands.
      if (prior > 0) mrrGrowthHistory.push(((current - prior) / prior) * 100);
    }
  } catch { /* ok */ }

  // ── 3. Compute NRR proxy ──
  //
  // The comment here read "use stored nrr if available, else derive". There is
  // no `nrr` column, so "available" was never true — and there was no `else`:
  // the query raised, the catch swallowed it, and `nrr` stayed null. Net
  // revenue retention contributes four of this report's points, and it scored
  // zero for every company that has ever run it, in a document a founder takes
  // to an acquirer.
  //
  // The components ARE recorded. NRR over a period is the revenue from
  // existing customers at the end divided by what it was at the start:
  // (start + expansion − contraction − churn) / start. `new_mrr_cents` is
  // deliberately excluded — new customers are acquisition, not retention, and
  // including them is how a company with heavy churn shows NRR above 100.
  let nrr: number | null = null;
  try {
    const res = await query(
      `SELECT mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents
         FROM metric_snapshots
        WHERE product_id=? ORDER BY snapshot_date DESC LIMIT 2`,
      [productId]
    );
    const rows = res.rows as unknown as Array<Record<string, unknown>>;
    const prior = rows[1];
    const latest = rows[0];
    const start = prior ? Number(prior.mrr_cents ?? 0) : 0;
    if (latest && start > 0) {
      const expansion = Number(latest.expansion_mrr_cents ?? 0);
      const contraction = Number(latest.contraction_mrr_cents ?? 0);
      const churned = Number(latest.churned_mrr_cents ?? 0);
      nrr = ((start + expansion - contraction - churned) / start) * 100;
    }
    // One snapshot, or a starting MRR of zero, leaves this null — which is
    // what `scoreRevenueQuality` already treats as "not known", distinct from
    // a company that genuinely retains nothing.
  } catch { /* ok */ }

  // ── 4. Company age (from products table) ──
  let companyAgeDays = 180; // default
  try {
    const res = await query(
      'SELECT created_at FROM products WHERE id=?',
      [productId]
    );
    if (res.rows.length > 0) {
      const createdAt = (res.rows[0] as Record<string, unknown>).created_at as string;
      const ageMs = Date.now() - new Date(createdAt).getTime();
      companyAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    }
  } catch { /* ok */ }

  // ── 5. Team size ──
  let teamSize = 1;
  // Never true: nothing in the schema records a vesting schedule. Named for
  // what it means — whether Foundry HAS the record — not for whether vesting
  // exists at the company, which Foundry has no way to know.
  const vestingRecorded = false;
  try {
    const res = await query(
      `SELECT COUNT(*) as cnt FROM team_members WHERE product_id=? AND status='active'`,
      [productId]
    );
    teamSize = Math.max(1, ((res.rows[0] as Record<string, unknown>)?.cnt as number) ?? 1);
    // FOUNDER VESTING IS NOT RECORDED ANYWHERE. `team_members` has no
    // `vesting_schedule` column and never has, so this query raised, the catch
    // swallowed it, and `hasFounderVesting` stayed false for every company —
    // scored as "no vesting in place" in a readiness report, which is a
    // finding about the company rather than about Foundry's records.
    //
    // Not knowing is not the same as knowing there is none. Left false here
    // only because the caller has nowhere to put "unknown"; the difference is
    // recorded in the report's own gap list rather than asserted as fact.
  } catch { /* ok */ }

  // ── 6. Integration count ──
  let integrationCount = 0;
  try {
    const res = await query(
      `SELECT COUNT(*) as cnt FROM integrations WHERE product_id=? AND status='active'`,
      [productId]
    );
    integrationCount = ((res.rows[0] as Record<string, unknown>)?.cnt as number) ?? 0;
  } catch { /* ok */ }

  // ── 7. Customer concentration, from the customers this company actually has ──
  //
  // A QUARTER OF THIS SCORE WAS A CONSTANT. `topCustomerMrrPct` was a hardcoded
  // `null` under a comment saying per-customer MRR is not in the schema, and
  // `customerCount` read `metric_snapshots.customer_count` — a column that has
  // never existed, so `?? 0` made it zero for every company. Both inputs dead
  // meant `scoreCustomerConcentration` returned exactly 5.0 every time, and it
  // carries weight 0.25 — joint-heaviest with revenue quality. A fifth of the
  // report's dimensions, shown to the founder with its own bar beside the
  // others, was a fixed number wearing the shape of a finding, on a page that
  // tells them whether they are ready to be acquired.
  //
  // Per-customer MRR IS in the schema, in both customer stores, and
  // `institution/company-customers.ts` is the accessor that reads both and
  // deduplicates. Concentration is what that data is for.
  const customers = await getCompanyCustomers(productId);
  const paying = customers.filter((c) => c.mrrCents > 0);
  const totalCustomerMrr = paying.reduce((sum, c) => sum + c.mrrCents, 0);
  // The largest customer's share of what the customers pay. Null when no
  // customer is known to pay anything — an unmeasured dimension, not a middling
  // one.
  const topCustomerMrrPct: number | null = totalCustomerMrr > 0
    ? (Math.max(...paying.map((c) => c.mrrCents)) / totalCustomerMrr) * 100
    : null;

  // ── 8. Score each dimension ──
  const revenue_quality_score = parseFloat(
    scoreRevenueQuality(nrr, churnRate, mrrGrowthHistory).toFixed(1)
  );
  const ip_clarity_score = parseFloat(
    scoreIPClarity(companyAgeDays).toFixed(1)
  );
  const team_retention_score = parseFloat(
    scoreTeamRetention(teamSize, companyAgeDays, vestingRecorded).toFixed(1)
  );
  const integration_complexity_score = parseFloat(
    scoreIntegrationComplexity(integrationCount).toFixed(1)
  );
  const concentrationRaw = scoreCustomerConcentration(topCustomerMrrPct);
  const customer_concentration_score = concentrationRaw === null
    ? null
    : parseFloat(concentrationRaw.toFixed(1));

  // A WEIGHTED AVERAGE OVER THE DIMENSIONS THAT WERE SCORED, renormalised.
  //
  // Customer concentration carries 0.25 — joint-heaviest — and was a constant
  // 5.0 for every company, because both of its inputs were dead. Now that it
  // can be genuinely absent, adding it as a zero would swing the overall score
  // down by a quarter for a company whose customers Foundry has simply never
  // been told about, and adding a middling 5.0 would call the unmeasured
  // average. The dimension drops out and the remaining weights renormalise —
  // the same rule this campaign applies to every other composite.
  const dimensions: Array<[number | null, number]> = [
    [revenue_quality_score, 0.25],
    [ip_clarity_score, 0.15],
    [team_retention_score, 0.20],
    [integration_complexity_score, 0.15],
    [customer_concentration_score, 0.25],
  ];
  const scored = dimensions.filter((d): d is [number, number] => d[0] !== null);
  const weightUsed = scored.reduce((sum, [, w]) => sum + w, 0);
  const overall_score = parseFloat(
    (scored.reduce((sum, [v, w]) => sum + v * w, 0) / weightUsed).toFixed(1));

  const ready_to_be_acquired = overall_score >= 7.0;

  const key_gaps = identifyGaps({
    revenue_quality: revenue_quality_score,
    ip_clarity: ip_clarity_score,
    team_retention: team_retention_score,
    integration_complexity: integration_complexity_score,
    customer_concentration: customer_concentration_score,
  });

  const target_acquirer_profile = deriveAcquirerProfile(
    overall_score,
    revenue_quality_score,
    integration_complexity_score,
    mrr,
  );

  const estimated_multiple_range = deriveMultipleRange(
    overall_score,
    revenue_quality_score,
    mrr,
  );

  const id = nanoid();
  const assessed_at = new Date().toISOString();

  await query(
    `INSERT INTO ma_readiness_scores
       (id, product_id, assessed_at, overall_score,
        revenue_quality_score, ip_clarity_score, team_retention_score,
        integration_complexity_score, customer_concentration_score,
        ready_to_be_acquired, key_gaps_json, target_acquirer_profile, estimated_multiple_range)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      assessed_at,
      overall_score,
      revenue_quality_score,
      ip_clarity_score,
      team_retention_score,
      integration_complexity_score,
      customer_concentration_score,
      ready_to_be_acquired ? 1 : 0,
      JSON.stringify(key_gaps),
      target_acquirer_profile,
      estimated_multiple_range,
    ]
  );

  return {
    id,
    overall_score,
    revenue_quality_score,
    ip_clarity_score,
    team_retention_score,
    integration_complexity_score,
    customer_concentration_score,
    ready_to_be_acquired,
    key_gaps,
    target_acquirer_profile,
    estimated_multiple_range,
    assessed_at,
  };
}

// ─── getLatestMAScore ─────────────────────────────────────────────────────────

export async function getLatestMAScore(productId: string): Promise<MAReadinessScore | null> {
  const res = await query(
    `SELECT * FROM ma_readiness_scores
     WHERE product_id=?
     ORDER BY assessed_at DESC LIMIT 1`,
    [productId]
  );
  if (res.rows.length === 0) return null;
  return rowToScore(res.rows[0] as Record<string, unknown>);
}

// ─── listMAScores ─────────────────────────────────────────────────────────────

export async function listMAScores(productId: string): Promise<MAReadinessScore[]> {
  const res = await query(
    `SELECT * FROM ma_readiness_scores
     WHERE product_id=?
     ORDER BY assessed_at DESC LIMIT 20`,
    [productId]
  );
  return res.rows.map((r) => rowToScore(r as Record<string, unknown>));
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToScore(row: Record<string, unknown>): MAReadinessScore {
  return {
    id: row.id as string,
    overall_score: row.overall_score as number,
    revenue_quality_score: row.revenue_quality_score as number,
    ip_clarity_score: row.ip_clarity_score as number,
    team_retention_score: row.team_retention_score as number,
    integration_complexity_score: row.integration_complexity_score as number,
    customer_concentration_score: (row.customer_concentration_score ?? null) as number | null,
    ready_to_be_acquired: (row.ready_to_be_acquired as number) === 1,
    key_gaps: parseJSONSafe<string[]>(row.key_gaps_json as string, []),
    target_acquirer_profile: (row.target_acquirer_profile as string) ?? '',
    estimated_multiple_range: (row.estimated_multiple_range as string) ?? '',
    assessed_at: row.assessed_at as string,
  };
}
