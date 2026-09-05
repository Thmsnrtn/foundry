// =============================================================================
// FOUNDRY — Founder Intelligence Service
// Complete business intelligence for the founder. Replicates AcreOS's founder
// intelligence layer, tailored to Foundry's data model.
// =============================================================================

import { getOwnerEmail } from '../../lib/instance-posture.js';
import { realCompany, query } from '../../db/client.js';
import { callOpus, callSonnet } from '../ai/client.js';
import { nanoid } from 'nanoid';

/** Safe query wrapper — returns empty result if table doesn't exist */
async function safeQuery(sql: string, args: unknown[] = []): Promise<{ rows: unknown[] }> {
  try {
    return await query(sql, args);
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    if (msg.includes('no such table') || msg.includes('no such column')) {
      return { rows: [] };
    }
    throw err;
  }
}

/**
 * How the scheduler's jobs are actually doing, from what was recorded.
 *
 * TWO CALLERS HAD THE SAME FOUR HARDCODED NUMBERS. `getPulse` returned
 * `{ healthy: 30, degraded: 0, failed: 0 }` under the comment "From job
 * registry", and `getAutomationHealth` returned `total_jobs: 30,
 * jobs_healthy: 30, jobs_degraded: 0, jobs_failed: 0`. Neither read anything.
 * The registry has EIGHTY-NINE jobs (it had ninety until migration 183 removed
 * a nightly sweep over a table nobody could write to), and migration 172 gave
 * every one of them a way
 * to say when it stops — `src/index.ts` records success and failure around each
 * registry job, and the founder's Letter already renders the failing ones.
 *
 * So the founder was told the truth and the OPERATOR — the person who would fix
 * a broken job — was told a constant. Computed once here so the two surfaces
 * cannot disagree again.
 *
 * `neverReported` is not `healthy`. A job with no health row has never been
 * observed, and `loop-health.ts` explains why that cannot be told apart from a
 * deployment which has not had its first tick.
 */
async function jobHealthCounts(): Promise<{
  total: number; healthy: number; failing: number; neverReported: number;
}> {
  const { JOB_REGISTRY } = await import('../../jobs/index.js');
  const names = Object.keys(JOB_REGISTRY);
  const rows = await safeQuery('SELECT job_name, consecutive_failures FROM job_health', []);
  const observed = new Map<string, number>();
  for (const row of rows.rows as unknown as Array<Record<string, unknown>>) {
    observed.set(String(row.job_name), Number(row.consecutive_failures ?? 0));
  }
  const failing = names.filter((n) => (observed.get(n) ?? 0) > 0).length;
  const neverReported = names.filter((n) => !observed.has(n)).length;
  return {
    total: names.length,
    healthy: names.length - failing - neverReported,
    failing,
    neverReported,
  };
}

/**
 * ONE DEFINITION, IN DEPLOYMENT CONFIGURATION, NOT FOUR IN SOURCE.
 *
 * This literal appeared in four files, and this comparison is the only thing
 * standing between a session and the platform-operator surface — which performs
 * deliberately unscoped writes across every tenant. An authorization boundary
 * compiled into source cannot be changed without a release, and silently
 * redirects the owner to /dashboard if his verified primary address ever
 * differs from the string somebody typed.
 *
 * `getOwnerEmail` reads deployment configuration and defaults to the historic
 * literal, so behaviour is unchanged and the value now has one home.
 */
export function isFounder(email: string): boolean {
  return email.trim().toLowerCase() === getOwnerEmail();
}

// ─── Pulse: 5-Minute Health Scan ────────────────────────────────────────────

/**
 * TWO DIFFERENT BUSINESSES' MONEY WERE BOTH CALLED `mrr`.
 *
 * `PulseData.mrr` summed `metric_snapshots` across every product — that is the
 * reported MRR MOVEMENT of the customer COMPANIES Foundry operates, added up.
 * `MRRIntelligence.current_mrr` is Foundry's own subscription revenue. Both
 * went out of `/api/founder/executive-dashboard` in one object, as `pulse.mrr`
 * and `mrr.current_mrr`, and an alert read "MRR declined 14% this month" about
 * whichever one the reader assumed.
 *
 * They are not the same quantity, not the same company, and not even the same
 * KIND of quantity: one is a level, the other is a sum of movements. The
 * portfolio number is worth having — it is what the operator of a portfolio
 * would want — so it keeps its meaning and loses the name that was not its own.
 */
export interface PulseData {
  status: 'healthy' | 'warning' | 'critical';
  /** Net reported MRR movement across ALL operated companies over 30 days —
   *  new + expansion - contraction - churned, each term summed over the rows
   *  that reported it. Not Foundry's revenue, and a movement rather than a
   *  level. NULL when no company reported any movement in the window: a
   *  portfolio that reported nothing did not move by zero. */
  portfolio_mrr_movement_30d: number | null;
  /** How that movement compares with the preceding 30 days. NULL when the
   *  preceding window reported nothing to compare against. */
  portfolio_mrr_movement_delta_pct: number | null;
  active_products: number;
  active_founders: number;
  founders_this_month: number;
  /** Founders who signed up more than a week ago and never subscribed. NOT
   *  churn — they never paid, so they cannot have left — and not scoped to a
   *  month. It was called `churn_this_month`. Real founder churn is not
   *  derivable: `tier` is set to NULL when a subscription is deleted
   *  (`billing/stripe.ts`) and nothing records when. */
  signups_never_converted: number;
  active_stressors: number;
  critical_stressors: number;
  pending_decisions: number;
  job_health: { healthy: number; degraded: number; failed: number };
  system_uptime: string;
  last_audit_run: string | null;
  alerts: Array<{ severity: string; message: string }>;
}

export async function getPulse(): Promise<PulseData> {
  // Lifted out of the batch below because it interpolates the reality
  // predicate: a template literal sitting between two plain-string queries put
  // `decisions.status = 'pending'` inside the vocabulary scanner's window for
  // `stressor_history`, and it reported a violation neither line contains.
  const realProductCount = query(
    `SELECT COUNT(*) as c FROM products WHERE status = 'active' AND standing = 'earned' AND ${realCompany()}`, []);

  const [
    foundersResult, productsResult, stressorsResult, decisionsResult,
    metricsResult, priorMetricsResult, recentFounders, recentChurn
  ] = await Promise.all([
    query("SELECT COUNT(*) as c FROM founders WHERE tier IS NOT NULL", []),
    realProductCount,
    query("SELECT severity, COUNT(*) as c FROM stressor_history WHERE status = 'active' GROUP BY severity", []),
    query("SELECT COUNT(*) as c FROM decisions WHERE status = 'pending'", []),
    // A ROW-WISE SUM DROPS EVERY ROW THAT DID NOT REPORT ALL FOUR. Migration 202
    // made the movement columns nullable, and `a + b - c - d` is NULL when any
    // one of them is — so `SUM(...)` silently skipped every company that
    // reported, say, new business and churn but nothing about expansion. The
    // number that came out was not smaller for a reason anyone could see.
    //
    // Summed TERM BY TERM instead: each is the total of what was reported for
    // that movement, and a company that reported nothing contributes nothing.
    // `reported` counts the rows behind it, so "no movement" and "nobody told
    // us" stay different answers.
    query(`SELECT COALESCE(SUM(new_mrr_cents), 0) + COALESCE(SUM(expansion_mrr_cents), 0)
                - COALESCE(SUM(contraction_mrr_cents), 0) - COALESCE(SUM(churned_mrr_cents), 0) AS total,
                COUNT(new_mrr_cents) + COUNT(expansion_mrr_cents)
                + COUNT(contraction_mrr_cents) + COUNT(churned_mrr_cents) AS reported
             FROM metric_snapshots m
             WHERE m.snapshot_date >= date('now', '-30 days')
               AND EXISTS (SELECT 1 FROM products p WHERE p.id = m.product_id
                             AND p.standing = 'earned' AND ${realCompany('p')})`, []),
    query(`SELECT COALESCE(SUM(new_mrr_cents), 0) + COALESCE(SUM(expansion_mrr_cents), 0)
                - COALESCE(SUM(contraction_mrr_cents), 0) - COALESCE(SUM(churned_mrr_cents), 0) AS total,
                COUNT(new_mrr_cents) + COUNT(expansion_mrr_cents)
                + COUNT(contraction_mrr_cents) + COUNT(churned_mrr_cents) AS reported
             FROM metric_snapshots m
            WHERE m.snapshot_date >= date('now', '-60 days')
              AND m.snapshot_date <  date('now', '-30 days')
              AND EXISTS (SELECT 1 FROM products p WHERE p.id = m.product_id
                            AND p.standing = 'earned' AND ${realCompany('p')})`, []),
    query("SELECT COUNT(*) as c FROM founders WHERE created_at > datetime('now', '-30 days')", []),
    query("SELECT COUNT(*) as c FROM founders WHERE tier IS NULL AND created_at < datetime('now', '-7 days')", []),
  ]);

  const jobs = await jobHealthCounts();
  const auditRow = (await safeQuery('SELECT MAX(created_at) AS last FROM audit_scores', []))
    .rows[0] as Record<string, unknown> | undefined;
  const lastAudit = auditRow?.last == null ? null : String(auditRow.last);
  const activeFounders = (foundersResult.rows[0] as Record<string, number>)?.c ?? 0;
  const activeProducts = (productsResult.rows[0] as Record<string, number>)?.c ?? 0;
  const pendingDecisions = (decisionsResult.rows[0] as Record<string, number>)?.c ?? 0;
  const foundersThisMonth = (recentFounders.rows[0] as Record<string, number>)?.c ?? 0;
  const neverConverted = (recentChurn.rows[0] as Record<string, number>)?.c ?? 0;

  const currentRow = metricsResult.rows[0] as Record<string, number> | undefined;
  const priorRow = priorMetricsResult.rows[0] as Record<string, number> | undefined;
  // Null when no company reported any movement in the window: a portfolio that
  // reported nothing did not move by zero.
  const currentMRR = Number(currentRow?.reported ?? 0) === 0
    ? null : Number(currentRow?.total ?? 0) / 100;
  const priorMRR = Number(priorRow?.reported ?? 0) === 0
    ? null : Number(priorRow?.total ?? 0) / 100;
  const mrrDelta = currentMRR !== null && priorMRR !== null && priorMRR > 0
    ? ((currentMRR - priorMRR) / priorMRR) * 100
    : null;

  let criticalStressors = 0;
  let totalStressors = 0;
  for (const row of stressorsResult.rows as unknown as Array<Record<string, unknown>>) {
    const count = row.c as number;
    totalStressors += count;
    if (row.severity === 'critical') criticalStressors = count;
  }

  // Alerts
  const alerts: Array<{ severity: string; message: string }> = [];
  if (criticalStressors > 0) alerts.push({ severity: 'critical', message: `${criticalStressors} critical stressor(s) active` });
  if (pendingDecisions > 5) alerts.push({ severity: 'warning', message: `${pendingDecisions} decisions pending review` });
  // NAMES WHOSE MONEY IT IS. "MRR declined 14%" beside Foundry's own MRR card
  // read as Foundry's revenue falling; it is the operated companies' reported
  // movement, which is a different alarm with a different response.
  if (mrrDelta !== null && mrrDelta < -10) {
    alerts.push({
      severity: 'warning',
      message: `Reported MRR movement across operated companies is down ${Math.abs(mrrDelta).toFixed(1)}% on the prior 30 days`,
    });
  }

  const status = criticalStressors > 0 ? 'critical' : alerts.length > 0 ? 'warning' : 'healthy';

  return {
    status,
    portfolio_mrr_movement_30d: currentMRR === null ? null : Math.round(currentMRR),
    portfolio_mrr_movement_delta_pct: mrrDelta === null ? null : Math.round(mrrDelta * 10) / 10,
    active_products: activeProducts,
    active_founders: activeFounders,
    founders_this_month: foundersThisMonth,
    signups_never_converted: neverConverted,
    active_stressors: totalStressors,
    critical_stressors: criticalStressors,
    pending_decisions: pendingDecisions,
    // Was `{ healthy: 30, degraded: 0, failed: 0 }` under a comment claiming it
    // came from the job registry. It did not; nothing was read.
    job_health: {
      healthy: jobs.healthy, degraded: jobs.neverReported, failed: jobs.failing,
    },
    system_uptime: formatUptime(process.uptime()),
    // THE MIRROR IMAGE OF EVERY OTHER DEFECT HERE. This was a hardcoded null
    // while `audit_scores` has a real writer (`audit/engine.ts`) and a
    // `created_at`. The fact existed and was thrown away, which is the same
    // failure as inventing one — the operator could not tell "never audited"
    // from "not looked up".
    last_audit_run: lastAudit,
    alerts,
  };
}

// ─── MRR Intelligence ───────────────────────────────────────────────────────

/**
 * FOUNDRY'S OWN SUBSCRIPTION REVENUE — from founders who are actually paying.
 *
 * Two things were wrong here, in opposite directions.
 *
 * REVENUE WAS COUNTED BEFORE ANYONE PAID. The Stripe webhook sets
 * `founders.tier` on `customer.subscription.created` including while the
 * subscription's status is `trialing` — that is the very branch that records
 * `trial_ends_at`. So a founder three days into the fourteen-day card-upfront
 * trial (migration 077), who has paid nothing and may never, counted at full
 * list price in `current_mrr`, in `arr`, in `by_tier`, and in every forecast
 * compounded from them. They are counted separately now, as what they are.
 *
 * AND A SERIES ABOUT OTHER COMPANIES WAS PLOTTED AS FOUNDRY'S HISTORY.
 * `mrr_history` summed `metric_snapshots` across all products: the customer
 * COMPANIES' reported MRR movement, not Foundry's revenue and not a level.
 * Renamed rather than deleted, because the portfolio series is worth having.
 * Foundry's own MRR history does not exist at all — nothing records a
 * founder's tier over time, only its current value.
 *
 * These are LIST prices. Stripe holds what is actually billed, and discounts,
 * coupons and annual plans are invisible from here.
 */
export interface MRRIntelligence {
  /** Founders on a paid tier whose trial has ended or who never had one,
   *  at list price. */
  current_mrr: number;
  /** Founders inside a trial window, and what they would be worth at list
   *  price if every one of them converted. Never added to `current_mrr`. */
  trialing: { count: number; list_price_mrr: number };
  /**
   * NULL, BECAUSE FOUNDRY'S OWN REVENUE HISTORY IS NOT RECORDED ANYWHERE.
   *
   * This used to be "today's roster, filtered to founders who signed up more
   * than thirty days ago, priced at today's tiers". That set is a SUBSET of the
   * set behind `current_mrr` — a founder who cancelled has no tier and is
   * absent from both — so `prior <= total` always held and the growth rate was
   * arithmetically incapable of being negative. The trend badge could say
   * 'growing' or 'flat' and never 'declining', and the forecasts compounded a
   * rate that could only point one way.
   *
   * A level thirty days ago needs a record made thirty days ago.
   * `founders.tier` holds one value and no history, and nothing else in the
   * schema keeps Foundry's own subscription state over time.
   */
  mrr_30d_ago: number | null;
  mrr_trend: 'growing' | 'flat' | 'declining' | 'unknown';
  growth_rate_pct: number | null;
  arr: number;
  by_tier: Record<string, { count: number; mrr: number }>;
  /** The OPERATED COMPANIES' reported MRR movement by snapshot date — not
   *  Foundry's revenue history, which is not recorded anywhere. */
  portfolio_mrr_movement_history: Array<{ date: string; movement: number }>;
  /** Null when there is no growth rate to compound. */
  forecast_3m: number | null;
  forecast_6m: number | null;
}

export async function getMRRIntelligence(): Promise<MRRIntelligence> {
  // PAYING AND TRIALING SPLIT AT THE SOURCE, not netted off afterwards. A
  // trial window that has not ended means nothing has been charged yet.
  const tiers = await safeQuery(
    `SELECT tier,
            SUM(CASE WHEN trial_ends_at IS NULL OR trial_ends_at <= datetime('now')
                     THEN 1 ELSE 0 END) AS paying,
            SUM(CASE WHEN trial_ends_at > datetime('now') THEN 1 ELSE 0 END) AS trialing
       FROM founders WHERE tier IS NOT NULL GROUP BY tier`, []
  );

  const byTier: Record<string, { count: number; mrr: number }> = {};
  let totalMRR = 0;
  let trialingCount = 0;
  let trialingMRR = 0;
  // List prices, matching `billing/stripe.ts`. Stripe is what actually bills.
  const tierPricing: Record<string, number> = { solo: 79, growth: 199, investor_ready: 399 };

  for (const row of tiers.rows as unknown as Array<Record<string, unknown>>) {
    const tier = row.tier as string;
    const price = tierPricing[tier] ?? 0;
    const paying = Number(row.paying ?? 0);
    const trialing = Number(row.trialing ?? 0);
    byTier[tier] = { count: paying, mrr: paying * price };
    totalMRR += paying * price;
    trialingCount += trialing;
    trialingMRR += trialing * price;
  }

  // Historical MRR from metric snapshots (aggregate across all products)
  const history = await safeQuery(
    // Term by term, for the same reason as the pulse above: a row-wise sum
    // drops every snapshot that did not report all four movements.
    `SELECT snapshot_date,
            COALESCE(SUM(new_mrr_cents), 0) + COALESCE(SUM(expansion_mrr_cents), 0)
          - COALESCE(SUM(contraction_mrr_cents), 0) - COALESCE(SUM(churned_mrr_cents), 0) as mrr
     FROM metric_snapshots m WHERE m.snapshot_date > date('now', '-90 days')
       AND EXISTS (SELECT 1 FROM products p WHERE p.id = m.product_id AND p.standing = 'earned' AND ${realCompany('p')})
     GROUP BY snapshot_date ORDER BY snapshot_date`, []
  );

  const movementHistory = (history.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    date: r.snapshot_date as string,
    movement: ((r.mrr as number) ?? 0) / 100,
  }));

  // A GROWTH RATE THAT COULD NOT BE NEGATIVE.
  //
  // The prior level was computed as today's roster filtered to founders who
  // signed up more than thirty days ago, priced at today's tiers — a strict
  // SUBSET of the set behind `totalMRR`, since a founder who cancelled has no
  // tier and is missing from both. So `priorMRR <= totalMRR` always held: the
  // growth rate was arithmetically incapable of being negative, the trend badge
  // could never read 'declining', and the three- and six-month forecasts
  // compounded a rate that only pointed one way.
  //
  // Nothing records what Foundry's own MRR was thirty days ago. `founders.tier`
  // holds one value and no history. So the answer is that it is not known, and
  // the forecast built on it is not made.
  const priorMRR: number | null = null;
  const growthRate: number | null = null;
  const trend: MRRIntelligence['mrr_trend'] = 'unknown';

  return {
    current_mrr: totalMRR,
    trialing: { count: trialingCount, list_price_mrr: trialingMRR },
    mrr_30d_ago: priorMRR,
    mrr_trend: trend,
    growth_rate_pct: growthRate,
    arr: totalMRR * 12,
    by_tier: byTier,
    portfolio_mrr_movement_history: movementHistory,
    // A forecast is the growth rate compounded. There is no growth rate.
    forecast_3m: null,
    forecast_6m: null,
  };
}

// ─── Churn Intelligence ─────────────────────────────────────────────────────

/**
 * THE OPERATOR'S AT-RISK NUMBERS — none of which were churn.
 *
 * `churn_rate_30d` was at-risk companies over active companies. Nothing in
 * that query looks at time, so there was no 30-day window; and a company
 * flagged yellow or red is by definition still active, so a churn rate was
 * being computed entirely from companies that had not churned. It is renamed
 * to the question it actually answers.
 *
 * Worse, its numerator and `at_risk_count` and `rescue_opportunities` were all
 * `atRisk.rows.length` — the length of a list carrying `LIMIT 20`. With fifty
 * at-risk companies the headline card read "At Risk: 20", and the rate divided
 * a capped numerator by an uncapped denominator. The list is for the page; the
 * counts now come from a count.
 */
export interface ChurnIntelligence {
  /** Active companies flagged yellow or red, over all active companies.
   *  NULL when there are no active companies — the old code substituted a
   *  denominator of 1 rather than saying it had nothing to divide. */
  at_risk_share_pct: number | null;
  /** EVERY at-risk company, not the length of the capped list below. */
  at_risk_count: number;
  /** The worst twenty, for a page that has to fit. `at_risk_count` is the total. */
  at_risk_products: Array<{ id: string; name: string; risk_state: string; stressor_count: number }>;
  /** NULL BECAUSE NOTHING RECORDS WHEN A COMPANY CHURNED. Archiving happens in
   *  two places and neither leaves a churn date: `deprovisionSCP` moves
   *  `scp_status` and touches `updated_at`, which any other write also moves,
   *  and erasure archives the row — and an erasure is NOT a churn. A person
   *  exercising a deletion right and a customer leaving are different events,
   *  and counting the first as the second would be the worst kind of guess
   *  here. `0` claimed nobody left. */
  churned_this_month: number | null;
  /** Yellow-flagged companies: still reachable, not yet red. Counted over all
   *  of them rather than over the twenty that fit on the page. */
  rescue_opportunities: number;
}

export async function getChurnIntelligence(): Promise<ChurnIntelligence> {
  const atRisk = await safeQuery(
    `SELECT p.id, p.name, ls.risk_state, (SELECT COUNT(*) FROM stressor_history sh WHERE sh.product_id = p.id AND sh.status = 'active') as stressor_count
     FROM products p
     JOIN lifecycle_state ls ON p.id = ls.product_id
     WHERE ls.risk_state IN ('yellow', 'red') AND p.status = 'active' AND p.standing = 'earned'
     ORDER BY ls.risk_state DESC LIMIT 20`, []
  );

  // COUNTED, NOT MEASURED OFF THE PAGE. The same predicate as the list above,
  // without the limit that exists only so a card fits.
  const totals = await safeQuery(
    `SELECT
       (SELECT COUNT(*) FROM products WHERE status = 'active' AND standing = 'earned' AND ${realCompany()}) AS active,
       (SELECT COUNT(*) FROM products p JOIN lifecycle_state ls ON p.id = ls.product_id
         WHERE ls.risk_state IN ('yellow','red') AND p.status = 'active' AND p.standing = 'earned') AS at_risk,
       (SELECT COUNT(*) FROM products p JOIN lifecycle_state ls ON p.id = ls.product_id
         WHERE ls.risk_state = 'yellow' AND p.status = 'active' AND p.standing = 'earned') AS yellow`, []);

  const row = (totals.rows[0] ?? {}) as Record<string, unknown>;
  const active = Number(row.active ?? 0);
  const atRiskCount = Number(row.at_risk ?? 0);

  return {
    at_risk_share_pct: active === 0 ? null
      : Math.round((atRiskCount / active) * 100 * 10) / 10,
    at_risk_count: atRiskCount,
    at_risk_products: atRisk.rows as unknown as ChurnIntelligence['at_risk_products'],
    churned_this_month: null,
    rescue_opportunities: Number(row.yellow ?? 0),
  };
}

// ─── Automation Health ──────────────────────────────────────────────────────

export interface AutomationHealth {
  /** The scheduler's own registry size, not a number written here. */
  total_jobs: number;
  /** Registry jobs whose last recorded run succeeded. */
  jobs_healthy: number;
  /** Registry jobs with at least one consecutive failure right now. This is the
   *  operator-actionable number, and it was hardcoded to 0. */
  jobs_failing: number;
  /** Registry jobs with no health record at all — never observed, which is not
   *  the same fact as healthy. `loop-health.ts` explains why this cannot be
   *  told apart from a deployment that has not had its first tick. */
  jobs_never_reported: number;
  auto_decisions_24h: number;
  escalated_decisions_24h: number;
  /** NULL when no decision was made in the window: a rate over nothing.
   *  It defaulted to 100. */
  auto_execute_rate: number | null;
  recent_actions: Array<{ action: string; outcome: string; timestamp: string }>;
}

export async function getAutomationHealth(): Promise<AutomationHealth> {
  const autoDecisions = await safeQuery(
    "SELECT COUNT(*) as c FROM audit_log WHERE gate = 0 AND created_at > datetime('now', '-1 day')", []
  );
  const escalated = await safeQuery(
    "SELECT COUNT(*) as c FROM decisions WHERE status = 'pending' AND created_at > datetime('now', '-1 day')", []
  );
  const recentActions = await safeQuery(
    "SELECT action_type, outcome, created_at FROM audit_log WHERE gate <= 1 ORDER BY created_at DESC LIMIT 10", []
  );

  const autoCount = (autoDecisions.rows[0] as Record<string, number>)?.c ?? 0;
  const escalatedCount = (escalated.rows[0] as Record<string, number>)?.c ?? 0;
  const total = autoCount + escalatedCount;

  // Counted once, in `jobHealthCounts`, because this function and `getPulse`
  // carried the same four hardcoded numbers and would drift apart if fixed
  // twice.
  const jobs = await jobHealthCounts();

  return {
    total_jobs: jobs.total,
    jobs_healthy: jobs.healthy,
    jobs_failing: jobs.failing,
    jobs_never_reported: jobs.neverReported,
    auto_decisions_24h: autoCount,
    escalated_decisions_24h: escalatedCount,
    // NULL, NOT 100. "Auto-execute rate: 100%" was what an operator saw when
    // no decision had been made at all in the last day — the most reassuring
    // number on the panel, printed precisely when there was nothing to report.
    auto_execute_rate: total > 0 ? Math.round((autoCount / total) * 100) : null,
    recent_actions: (recentActions.rows as unknown as Array<Record<string, string>>).map((r) => ({
      // An action whose outcome was never written did not necessarily complete.
      action: r.action_type, outcome: r.outcome ?? 'not recorded', timestamp: r.created_at,
    })),
  };
}

// ─── Customer Health Overview ───────────────────────────────────────────────

export interface CustomerHealthOverview {
  total_customers: number;
  healthy: number;
  warning: number;
  critical: number;
  /** NULL when no customer has been scored. `0` was the worst possible score,
   *  printed for having measured nobody. */
  avg_health_score: number | null;
  /** WHICH COMPANIES NEED ATTENTION, NEVER WHICH OF THEIR CUSTOMERS.
   *
   * This was `Array<{ name: string; health: number; churn_risk: number }>` —
   * the ten most at-risk CUSTOMERS across every company on the platform, by
   * name, read with no product scope at all. The operator is Foundry's own
   * owner and legitimately administers the COMPANIES; a company's customers are
   * that company's, and `operator-pack.ts` already states the boundary and is
   * structurally held to it. This surface was the same rule's other
   * implementation, unenforced.
   *
   * Nothing rendered the names — `founder-ops` uses only the counts — so they
   * crossed the boundary into a clientless API response and no further. Removed
   * at the source rather than relying on nobody looking. */
  at_risk_by_company: Array<{ company: string; customers_at_risk: number }>;
  champions: number;
  revenue_at_risk: number;
}

export async function getCustomerHealthOverview(): Promise<CustomerHealthOverview> {
  // COUNTED OVER BOTH STORES, THROUGH THE ONE ACCESSOR. This aggregated
  // `customers` alone, so Foundry's own view of its platform excluded every
  // customer a company reported through the documented external API. A UNION
  // here would have double-counted anyone present in both stores, and
  // overstating is the error that flatters — so the deduplication rule is run
  // once, in `institution/company-customers.ts`, rather than copied into SQL.
  const { getAllCustomers, AT_RISK_CHURN_RISK, CHAMPION_MIN_HEALTH, CHAMPION_MAX_CHURN_RISK } =
    await import('../institution/company-customers.js');
  const all = await getAllCustomers();
  const scored = all.filter((c) => c.healthScore !== null);
  const t = {
    total: all.length,
    healthy: scored.filter((c) => (c.healthScore ?? 0) >= 70).length,
    warning: scored.filter((c) => (c.healthScore ?? 0) >= 40 && (c.healthScore ?? 0) < 70).length,
    critical: scored.filter((c) => (c.healthScore ?? 0) < 40).length,
    // NULL over an empty set. `0` here rendered as "Avg health: 0/100", which
    // is the worst possible score, printed when nobody had been scored at all.
    avg_health: scored.length
      ? scored.reduce((sum, c) => sum + (c.healthScore ?? 0), 0) / scored.length : null,
    champions: all.filter((c) => (c.healthScore ?? 0) > CHAMPION_MIN_HEALTH
      && c.churnRisk !== null && c.churnRisk < CHAMPION_MAX_CHURN_RISK).length,
    // The at-risk line for money uses the same threshold the departments act on,
    // rather than a second number written here.
    mrr_at_risk: all
      .filter((c) => c.churnRisk !== null && c.churnRisk > AT_RISK_CHURN_RISK)
      .reduce((sum, c) => sum + c.mrrCents, 0),
  };

  // Aggregated per company, so the operator learns which COMPANY needs looking
  // at without learning who any of its customers are. Company names come from
  // one query keyed by product id; the customers themselves never leave the
  // accessor as identities.
  const atRiskByProduct = new Map<string, number>();
  for (const c of all) {
    if (c.churnRisk === null || c.churnRisk <= AT_RISK_CHURN_RISK) continue;
    atRiskByProduct.set(c.productId, (atRiskByProduct.get(c.productId) ?? 0) + 1);
  }
  const productNames = new Map<string, string>();
  for (const row of (await safeQuery('SELECT id, name FROM products', [])).rows as
       unknown as Array<Record<string, unknown>>) {
    productNames.set(String(row.id), String(row.name ?? 'Unknown'));
  }

  return {
    total_customers: t.total,
    healthy: t.healthy,
    warning: t.warning,
    critical: t.critical,
    avg_health_score: t.avg_health === null ? null : Math.round(t.avg_health),
    at_risk_by_company: [...atRiskByProduct.entries()]
      .map(([productId, n]) => ({
        company: productNames.get(productId) ?? 'Unknown',
        customers_at_risk: n,
      }))
      .sort((a, b) => b.customers_at_risk - a.customers_at_risk
        || a.company.localeCompare(b.company))
      .slice(0, 10),
    champions: t.champions,
    revenue_at_risk: Math.round(t.mrr_at_risk / 100),
  };
}

// ─── Forecast ───────────────────────────────────────────────────────────────

/**
 * A PROJECTION, SAID TO BE ONE.
 *
 * `runway_months: 999` sat here under the comment `// SaaS with low burn` —
 * eighty-three years of runway, asserted by a code comment. Nothing in this
 * system records burn: there is no cost side to Foundry's own books beyond
 * `cost_events`, which is model spend alone. So runway is not a number that
 * can be got wrong here; it is a number that cannot be got at all.
 *
 * The projections stay, because a projection is an honest thing to publish as
 * long as it says it is one. Two changes: they are only produced when the
 * growth rate they compound is itself measured — projecting from a rate of
 * zero because nothing was known produced a flat line indistinguishable from a
 * forecast of no growth — and the separate customer series is gone. It applied
 * `monthlyGrowth * 0.8` to the founder count, and the 0.8 came from nowhere:
 * not a retention curve, not an observation, a coefficient someone typed.
 */
export interface Forecast {
  current_mrr: number;
  /** NULL: nothing records Foundry's burn, so runway cannot be derived. */
  runway_months: number | null;
  break_even_month: string | null;
  /** EMPTY when the growth rate is not measured — there is no 30-day-ago
   *  paying MRR to compare against. Compounding an unmeasured zero twelve
   *  times draws a flat line that looks like a finding. */
  projections: Array<{ month: string; mrr: number }>;
  /** What the projections were compounded from, so a reader can judge them. */
  /** Null: nothing records Foundry's own MRR at a past date. */
  projected_from: { monthly_growth_pct: number | null; measured: boolean };
}

export async function getForecast(): Promise<Forecast> {
  const mrr = await getMRRIntelligence();

  // `measured` was already the right idea, resting on a number that could not
  // be zero for the right reason: `mrr_30d_ago` was today's roster filtered by
  // signup date, so it was positive whenever Foundry had any customer at all,
  // and the twelve-month projection compounded a growth rate that was
  // arithmetically incapable of being negative.
  //
  // Nothing records what Foundry's own MRR was at any past date, so the rate is
  // null and the compounding loop below it was unreachable. A branch that
  // cannot run is not a feature waiting for data; it is code that will be read
  // as evidence the projection exists. When a level is recorded over time, the
  // projection comes back as a whole thing, against a history that is real.
  const measured = mrr.growth_rate_pct !== null;

  return {
    current_mrr: mrr.current_mrr,
    runway_months: null,
    break_even_month: null,
    projections: [],
    projected_from: { monthly_growth_pct: mrr.growth_rate_pct, measured },
  };
}

// ─── Morning Briefing ───────────────────────────────────────────────────────

export async function generateMorningBriefing(): Promise<string> {
  const pulse = await getPulse();
  const mrr = await getMRRIntelligence();
  const churn = await getChurnIntelligence();
  const automation = await getAutomationHealth();

  const prompt = `Write a CEO morning briefing (5 bullets, max 25 words each) for a SaaS platform.

Data:
- Foundry's own MRR: $${mrr.current_mrr}${mrr.growth_rate_pct === null ? ' (no recorded level 30d ago to compare against)' : ` (${mrr.growth_rate_pct > 0 ? '+' : ''}${mrr.growth_rate_pct}% vs 30d ago)`}
- Reported MRR movement across operated companies, last 30d: ${pulse.portfolio_mrr_movement_30d === null ? 'no company reported any movement' : `$${pulse.portfolio_mrr_movement_30d}${pulse.portfolio_mrr_movement_delta_pct === null ? ' (no prior window to compare)' : ` (${pulse.portfolio_mrr_movement_delta_pct > 0 ? '+' : ''}${pulse.portfolio_mrr_movement_delta_pct}% on the prior 30d)`}`}
- Active founders: ${pulse.active_founders}, products: ${pulse.active_products}
- New founders this month: ${pulse.founders_this_month}
- ${pulse.active_stressors} active stressors (${pulse.critical_stressors} critical)
- ${pulse.pending_decisions} decisions pending
- At-risk products: ${churn.at_risk_count}
- Auto-execute rate: ${automation.auto_execute_rate === null ? 'no decisions in the window' : `${automation.auto_execute_rate}%`}
- System uptime: ${pulse.system_uptime}

Format each bullet with an emoji:
1. Revenue status
2. Customer health
3. System/automation status
4. Risk summary
5. Recommended action for today`;

  // This briefing is about the PLATFORM, aggregated across every company, so
  // there is no customer product to charge it to. It is charged to Foundry's
  // own company instead of to nobody: Foundry is a company in this system, and
  // an unattributed model call is one no per-product ceiling can reach.
  const { resolveFoundryProductId } = await import('../system-identity.js');
  const { institutionSpend } = await import('../ai/client.js');
  // Foundry's own company when that identity exists; otherwise the institution,
  // said out loud. Before this, the fallback was `undefined`, which is the same
  // value a forgotten argument produces.
  const ownProductId = (await resolveFoundryProductId())
    ?? institutionSpend('platform-wide briefing before the Foundry company identity exists');

  const response = await callSonnet(
    'You are a COO writing a 30-second morning briefing for the CEO. Be specific, use numbers.',
    prompt, 512, ownProductId
  );

  return response.content;
}

// ─── Daily Digest ───────────────────────────────────────────────────────────

export async function generateDailyDigest(): Promise<{
  subject: string;
  content: string;
  data: { pulse: PulseData; mrr: MRRIntelligence; churn: ChurnIntelligence };
}> {
  const pulse = await getPulse();
  const mrr = await getMRRIntelligence();
  const churn = await getChurnIntelligence();

  const statusLabel = pulse.alerts.length === 0 ? 'All Clear' : `${pulse.alerts.length} item(s) need attention`;
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const subject = `Foundry Daily — ${date} — ${statusLabel}`;

  const briefing = await generateMorningBriefing();

  return { subject, content: briefing, data: { pulse, mrr, churn } };
}

// ─── Wellbeing Monitor ──────────────────────────────────────────────────────

/**
 * WHAT FOUNDRY HAS OBSERVED ABOUT THE PERSON — which is often nothing.
 *
 * This card carries a coloured left border on the operator page: green above
 * 60, amber above 35, red below. A founder with NO `founder_health` row at all
 * got `motivation = 50` and `engagement = 'stable'` by default, which produced
 * `energy_score: 70` — a GREEN card, "70/100", "Trajectory: stable", no stress
 * signals — about a person Foundry had never observed once.
 *
 * That is the worst version of this defect class, because of who reads it and
 * what they conclude. A founder seeing a green wellbeing card believes
 * something has been watching. A number assembled from three defaults is not
 * watching, and the reassurance is the harm.
 *
 * So every field here is null when its input is absent, and the card says it
 * has not observed rather than colouring itself green.
 */
export interface WellbeingData {
  /** NULL when nothing about this person has been recorded — no health row, or
   *  a row with none of the three inputs the score is built from. */
  energy_score: number | null;
  stress_signals: string[];
  /** NULL: nothing records founder activity gaps. This was `0` under a comment
   *  reading "Would track from activity gaps", which rendered as "you had a
   *  break today". */
  days_since_break: number | null;
  /** NULL, AND IT WOULD STILL BE NULL IF IT WERE WIRED UP. The store that
   *  answers this, `decision_quality_scores`, has no writer:
   *  `recordDecisionContext` is exported from `scp/founder/decision-tracker.ts`
   *  and called from nowhere, which is why the override rates over there are
   *  also permanently zero. `0` here told a founder they had not overridden
   *  Foundry once this week — a claim about that person's behaviour, drawn
   *  from a table nothing writes to. */
  override_count_7d: number | null;
  /** 'unknown' until there are enough snapshots to compare. It defaulted to
   *  'stable', which is a finding, not an absence of one. */
  burnout_trajectory: 'improving' | 'stable' | 'declining' | 'unknown';
  recommendation: string | null;
}

export async function getWellbeing(founderId: string): Promise<WellbeingData> {
  const health = await safeQuery('SELECT * FROM founder_health WHERE founder_id = ?', [founderId]);
  const h = health.rows[0] as Record<string, unknown> | undefined;

  // READ AS OBSERVED-OR-NOT, not as a value-or-default. The old code wrote
  // `?? 50` and `?? 'stable'` here, and those two substitutions are the whole
  // reason an unobserved founder scored 70.
  const motivation = h?.motivation_score == null ? null : Number(h.motivation_score);
  const runway = h?.personal_runway_months == null ? null : Number(h.personal_runway_months);

  // `engagement_trend` CANNOT BE READ AS AN OBSERVATION WHEN IT SAYS 'stable'.
  // Migration 006 gives the column `DEFAULT 'stable'`, so every row that has
  // ever been written for any other reason carries it, and a written default
  // is indistinguishable from a judgment that engagement is steady. It also
  // adjusts nothing — only 'declining' and 'critical' move the score — so
  // treating it as evidence would do nothing except make an unobserved founder
  // scoreable, which is the whole defect.
  const rawEngagement = h?.engagement_trend == null ? null : String(h.engagement_trend);
  const engagement = rawEngagement === 'stable' ? null : rawEngagement;

  const stressSignals: string[] = [];
  let energy: number | null = null;

  if (motivation !== null || engagement !== null || runway !== null) {
    // 70 is the starting point for a person we have SOMETHING on. It is not a
    // score for a person we have nothing on.
    energy = 70;
    if (motivation !== null) {
      if (motivation < 30) { energy -= 25; stressSignals.push('Low motivation score'); }
      else if (motivation < 50) { energy -= 10; }
    }
    if (engagement === 'declining') { energy -= 15; stressSignals.push('Declining engagement'); }
    if (engagement === 'critical') { energy -= 30; stressSignals.push('Critical engagement drop'); }
    if (runway !== null && runway < 3) { energy -= 15; stressSignals.push(`Only ${runway} months runway`); }
    energy = Math.max(0, Math.min(100, energy));
  }

  // Burnout trajectory from snapshots
  const snapshots = await safeQuery(
    'SELECT motivation_score FROM founder_health_snapshots WHERE founder_id = ? ORDER BY snapshot_date DESC LIMIT 5',
    [founderId]
  );
  const scores = (snapshots.rows as unknown as Array<Record<string, number>>)
    .map((s) => s.motivation_score).filter((v): v is number => v != null);
  let trajectory: WellbeingData['burnout_trajectory'] = 'unknown';
  if (scores.length >= 3) {
    const recent = scores.slice(0, 2);
    const older = scores.slice(2);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    trajectory = 'stable';
    if (recentAvg > olderAvg + 5) trajectory = 'improving';
    if (recentAvg < olderAvg - 5) trajectory = 'declining';
  }

  // NO RECOMMENDATION FROM NO OBSERVATION. Telling somebody to take a break
  // because a default said 70, or not telling them because it did, are both
  // advice about a person nothing has looked at.
  let recommendation: string | null = null;
  if (energy !== null && energy < 40) recommendation = 'Your energy is low. Consider delegating decisions and taking a break.';
  else if (stressSignals.length > 0) recommendation = 'Some stress signals detected. Review your workload.';

  return {
    energy_score: energy,
    stress_signals: stressSignals,
    days_since_break: null,
    override_count_7d: null,
    burnout_trajectory: trajectory,
    recommendation,
  };
}

// ─── Activity Timeline ──────────────────────────────────────────────────────

export async function getActivityTimeline(limit: number = 50): Promise<Array<{
  id: string; action: string; detail: string; gate: number; timestamp: string; category: string;
}>> {
  const result = await safeQuery(
    // `reasoning` is model-written narrative about a company's operations and
    // can quote its specifics. The operator needs to know WHAT happened WHERE,
    // which is what remains; the account of why belongs to the company whose
    // audit trail it is.
    'SELECT id, action_type, gate, created_at, product_id FROM audit_log ORDER BY created_at DESC LIMIT ?',
    [limit]
  );

  return (result.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    action: r.action_type as string,
    detail: r.reasoning as string,
    gate: r.gate as number,
    timestamp: r.created_at as string,
    category: categorizeAction(r.action_type as string),
  }));
}

// ─── Growth Signals ─────────────────────────────────────────────────────────

/**
 * WHAT FOUNDRY ACTUALLY RECORDS ABOUT ITS OWN GROWTH — and no more.
 *
 * This shape used to carry `activation_rate` and `trial_to_paid_rate` as two
 * separate fields computed by the SAME expression: paid founders over all
 * founders. The operator page printed them side by side as two independently
 * measured numbers, and they could never disagree, because they were one
 * number wearing two names.
 *
 * Neither was its label either. Nothing in this system records a founder
 * activating — there is no activation event to rate — and a trial conversion
 * whose denominator includes founders who never trialed is not a conversion
 * rate. So the pair is gone, and what is left is what the `founders` table can
 * actually answer:
 *
 *   `tier`             a paid tier is held, or it is not
 *   `trial_ends_at`    a trial window existed, or it did not (migration 077)
 *   `referred_by_code` the ONE acquisition fact captured at signup (073)
 *
 * NULL MEANS NOT MEASURED, never zero. A rate over an empty denominator is
 * unknown, and printing `0%` on a fresh install is a measurement claim about
 * founders who do not exist yet.
 */
export interface GrowthSignals {
  new_signups_7d: number;
  new_signups_30d: number;
  /** Founders holding a paid tier, over all founders. Named for what it is,
   *  which is neither activation nor a conversion rate. NULL with no founders. */
  paid_share_pct: number | null;
  /** Of the founders who ever had a trial window, the share now holding a
   *  tier. NULL when nobody has trialed: an unknown rate, not a zero one. */
  trial_to_paid_rate: number | null;
  /** NULL BECAUSE NO TIER CHANGE IS RECORDED ANYWHERE. A founder moving from
   *  growth to scale updates `founders.tier` in place and leaves no row behind
   *  — there is no history to difference, and no migration adds one. The `0`
   *  that used to sit here was read as a measured absence of expansion. */
  expansion_revenue: number | null;
  /** From `founders.referred_by_code`, the only attribution captured at
   *  signup. A founder without one is `unattributed`, NOT `direct`: arriving
   *  by an unrecorded route is not the same fact as arriving directly. */
  top_acquisition_channels: Array<{ channel: string; count: number }>;
}

export async function getGrowthSignals(): Promise<GrowthSignals> {
  const counts = await safeQuery(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at > datetime('now','-7 days')  THEN 1 ELSE 0 END) AS signups_7d,
            SUM(CASE WHEN created_at > datetime('now','-30 days') THEN 1 ELSE 0 END) AS signups_30d,
            SUM(CASE WHEN tier IS NOT NULL THEN 1 ELSE 0 END) AS paid,
            SUM(CASE WHEN trial_ends_at IS NOT NULL THEN 1 ELSE 0 END) AS trialed,
            SUM(CASE WHEN trial_ends_at IS NOT NULL AND tier IS NOT NULL THEN 1 ELSE 0 END) AS trialed_paid,
            SUM(CASE WHEN referred_by_code IS NOT NULL THEN 1 ELSE 0 END) AS referred
       FROM founders`, []);

  const row = (counts.rows[0] ?? {}) as Record<string, unknown>;
  const n = (key: string): number => Number(row[key] ?? 0);
  const total = n('total');
  const trialed = n('trialed');
  const referred = n('referred');

  // No founders means no channels to report. An empty list drawn from an empty
  // table would read as "we looked and found none" rather than "nobody yet".
  const channels = total === 0 ? [] : [
    { channel: 'referral', count: referred },
    { channel: 'unattributed', count: total - referred },
  ].filter((c) => c.count > 0).sort((a, b) => b.count - a.count);

  return {
    new_signups_7d: n('signups_7d'),
    new_signups_30d: n('signups_30d'),
    // Both denominators are checked rather than defaulted. The old code wrote
    // `?? 1` to avoid dividing by zero, which turned "no founders" into a real
    // denominator and reported a rate over an empty table.
    paid_share_pct: total === 0 ? null : Math.round((n('paid') / total) * 100),
    trial_to_paid_rate: trialed === 0 ? null : Math.round((n('trialed_paid') / trialed) * 100),
    expansion_revenue: null,
    top_acquisition_channels: channels,
  };
}

// ─── AI Cost Tracking ───────────────────────────────────────────────────────

export interface AICostData {
  total_tokens_24h: number;
  /** Reconciled spend from `ai_daily_spend` at global scope — the same ledger
   *  the daily ceiling is enforced against, and the only complete one. */
  total_cost_24h: number;
  /** NULL means NOT MEASURED, never zero. Nothing in this system records
   *  per-call latency, and a `0` here was rendered as a measurement. */
  avg_latency_ms: number | null;
  /** NULL for the same reason: no caller records which model was used.
   *  `logCost` takes `details`, and the agent runner passes `{tokens, session}`
   *  — the model is not in it. */
  calls_by_model: Record<string, number> | null;
  cost_per_founder: number;
}

/**
 * WHAT FOUNDRY'S OWN AI ACTUALLY COST, FROM WHAT WAS RECORDED.
 *
 * This estimated. It summed tokens from `chat_messages` — the founder-chat path
 * only — and multiplied by a hardcoded blended rate:
 *
 *     const estimatedCost = totalTokens * 0.000005; // ~$5/M average
 *
 * while `cost_events` held the real amounts, written by the AI client that
 * reserves against the spend ceilings before every dispatch. So the operator's
 * "Cost (24h)" badge was a guess derived from a proxy, standing next to a
 * ledger of what was actually spent.
 *
 * Two fields were worse than approximate. `avg_latency_ms: 0` and
 * `calls_by_model: { 'claude-opus-4-8': 0, ... }` are not measurements — nothing
 * records per-call latency, and no caller records the model. The dashboard
 * rendered the second as `Models: 3`, which is the count of keys in a hardcoded
 * object and would read as three models regardless of reality.
 *
 * THE RULE IS THIS SYSTEM'S OWN, stated in `institutional-economics.ts`:
 * measured-and-zero is not the same fact as not-measured. Both are null now,
 * and the surface says so rather than printing a number.
 */
export async function getAICostData(): Promise<AICostData> {
  // THE LEDGER THE CEILING ENFORCES AGAINST, which is the one that decides
  // whether Foundry may act at all.
  //
  // This read `cost_events` under a comment of mine calling it "the canonical
  // spend ledger: real amounts, every cost type". That was wrong, and correcting
  // it matters more than the number did. `cost_events` has ONE writer —
  // `scp/agents/base.ts`, fire-and-forget, for agent sessions only — so it
  // excludes founder chat, voice replies and every other model call. This same
  // function was already counting chat TOKENS while reporting no chat COST,
  // which is what a partial ledger beside a complete one looks like from the
  // outside.
  //
  // `ai/client.ts` reserves and settles every call, so `ai_daily_spend` is
  // complete and reconciled — including calls whose provider response was lost,
  // which expire at the full authorized amount rather than vanishing.
  //
  // SCOPE 'global' ONLY. The finish trigger writes the same amount to the
  // global, product and founder rows, so summing across scopes counts each call
  // up to three times.
  const spend = await safeQuery(
    `SELECT COALESCE(SUM(spent_cents), 0) / 100.0 AS total FROM ai_daily_spend
      WHERE scope = 'global' AND date >= date('now', '-1 day')`, []);
  const totalCost = Number((spend.rows[0] as Record<string, unknown>)?.total ?? 0);

  // Tokens from the two paths that record them, which do not overlap: agent
  // sessions log to `agent_cost_log`, founder chat to `chat_messages`.
  const agentTokens = await safeQuery(
    `SELECT COALESCE(SUM(tokens_input + tokens_output), 0) AS total FROM agent_cost_log
      WHERE logged_at > datetime('now', '-1 day')`, []);
  const chatTokens = await safeQuery(
    `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total FROM chat_messages
      WHERE created_at > datetime('now', '-1 day')`, []);
  const totalTokens = Number((agentTokens.rows[0] as Record<string, unknown>)?.total ?? 0)
    + Number((chatTokens.rows[0] as Record<string, unknown>)?.total ?? 0);

  const founders = await safeQuery("SELECT COUNT(*) as c FROM founders WHERE tier IS NOT NULL", []);
  const founderCount = Math.max(1, (founders.rows[0] as Record<string, number>)?.c ?? 1);

  return {
    total_tokens_24h: totalTokens,
    total_cost_24h: Math.round(totalCost * 100) / 100,
    // Not measured. Not zero.
    avg_latency_ms: null,
    calls_by_model: null,
    cost_per_founder: Math.round((totalCost / founderCount) * 100) / 100,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
}

function categorizeAction(actionType: string): string {
  if (actionType.includes('risk')) return 'risk';
  if (actionType.includes('audit')) return 'audit';
  if (actionType.includes('decision')) return 'decision';
  if (actionType.includes('stressor')) return 'stressor';
  if (actionType.includes('competitive')) return 'competitive';
  return 'system';
}
