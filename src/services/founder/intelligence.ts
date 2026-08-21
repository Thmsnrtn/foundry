// =============================================================================
// FOUNDRY — Founder Intelligence Service
// Complete business intelligence for the founder. Replicates AcreOS's founder
// intelligence layer, tailored to Foundry's data model.
// =============================================================================

import { query } from '../../db/client.js';
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
 * The registry has NINETY jobs, and migration 172 gave every one of them a way
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

const FOUNDER_EMAIL = 'thmsnrtn@gmail.com';

export function isFounder(email: string): boolean {
  return email.toLowerCase() === FOUNDER_EMAIL;
}

// ─── Pulse: 5-Minute Health Scan ────────────────────────────────────────────

export interface PulseData {
  status: 'healthy' | 'warning' | 'critical';
  mrr: number;
  mrr_delta_pct: number;
  active_products: number;
  active_founders: number;
  founders_this_month: number;
  churn_this_month: number;
  active_stressors: number;
  critical_stressors: number;
  pending_decisions: number;
  job_health: { healthy: number; degraded: number; failed: number };
  system_uptime: string;
  last_audit_run: string | null;
  alerts: Array<{ severity: string; message: string }>;
}

export async function getPulse(): Promise<PulseData> {
  const [
    foundersResult, productsResult, stressorsResult, decisionsResult,
    metricsResult, priorMetricsResult, recentFounders, recentChurn
  ] = await Promise.all([
    query("SELECT COUNT(*) as c FROM founders WHERE tier IS NOT NULL", []),
    query("SELECT COUNT(*) as c FROM products WHERE status = 'active'", []),
    query("SELECT severity, COUNT(*) as c FROM stressor_history WHERE status = 'active' GROUP BY severity", []),
    query("SELECT COUNT(*) as c FROM decisions WHERE status = 'pending'", []),
    query("SELECT SUM(new_mrr_cents + expansion_mrr_cents - contraction_mrr_cents - churned_mrr_cents) as total FROM metric_snapshots WHERE snapshot_date >= date('now', '-30 days')", []),
    query("SELECT SUM(new_mrr_cents + expansion_mrr_cents - contraction_mrr_cents - churned_mrr_cents) as total FROM metric_snapshots WHERE snapshot_date >= date('now', '-60 days') AND snapshot_date < date('now', '-30 days')", []),
    query("SELECT COUNT(*) as c FROM founders WHERE created_at > datetime('now', '-30 days')", []),
    query("SELECT COUNT(*) as c FROM founders WHERE tier IS NULL AND created_at < datetime('now', '-7 days')", []),
  ]);

  const jobs = await jobHealthCounts();
  const activeFounders = (foundersResult.rows[0] as Record<string, number>)?.c ?? 0;
  const activeProducts = (productsResult.rows[0] as Record<string, number>)?.c ?? 0;
  const pendingDecisions = (decisionsResult.rows[0] as Record<string, number>)?.c ?? 0;
  const foundersThisMonth = (recentFounders.rows[0] as Record<string, number>)?.c ?? 0;
  const churnThisMonth = (recentChurn.rows[0] as Record<string, number>)?.c ?? 0;

  const currentMRR = ((metricsResult.rows[0] as Record<string, number>)?.total ?? 0) / 100;
  const priorMRR = ((priorMetricsResult.rows[0] as Record<string, number>)?.total ?? 0) / 100;
  const mrrDelta = priorMRR > 0 ? ((currentMRR - priorMRR) / priorMRR) * 100 : 0;

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
  if (mrrDelta < -10) alerts.push({ severity: 'warning', message: `MRR declined ${Math.abs(mrrDelta).toFixed(1)}% this month` });

  const status = criticalStressors > 0 ? 'critical' : alerts.length > 0 ? 'warning' : 'healthy';

  return {
    status,
    mrr: Math.round(currentMRR),
    mrr_delta_pct: Math.round(mrrDelta * 10) / 10,
    active_products: activeProducts,
    active_founders: activeFounders,
    founders_this_month: foundersThisMonth,
    churn_this_month: churnThisMonth,
    active_stressors: totalStressors,
    critical_stressors: criticalStressors,
    pending_decisions: pendingDecisions,
    // Was `{ healthy: 30, degraded: 0, failed: 0 }` under a comment claiming it
    // came from the job registry. It did not; nothing was read.
    job_health: {
      healthy: jobs.healthy, degraded: jobs.neverReported, failed: jobs.failing,
    },
    system_uptime: formatUptime(process.uptime()),
    last_audit_run: null,
    alerts,
  };
}

// ─── MRR Intelligence ───────────────────────────────────────────────────────

export interface MRRIntelligence {
  current_mrr: number;
  mrr_30d_ago: number;
  mrr_trend: 'growing' | 'flat' | 'declining';
  growth_rate_pct: number;
  arr: number;
  by_tier: Record<string, { count: number; mrr: number }>;
  mrr_history: Array<{ date: string; mrr: number }>;
  forecast_3m: number;
  forecast_6m: number;
}

export async function getMRRIntelligence(): Promise<MRRIntelligence> {
  const tiers = await safeQuery(
    'SELECT tier, COUNT(*) as c FROM founders WHERE tier IS NOT NULL GROUP BY tier', []
  );

  const byTier: Record<string, { count: number; mrr: number }> = {};
  let totalMRR = 0;
  const tierPricing: Record<string, number> = { solo: 79, growth: 199, investor_ready: 399 };

  for (const row of tiers.rows as unknown as Array<Record<string, unknown>>) {
    const tier = row.tier as string;
    const count = row.c as number;
    const mrr = count * (tierPricing[tier] ?? 0);
    byTier[tier] = { count, mrr };
    totalMRR += mrr;
  }

  // Historical MRR from metric snapshots (aggregate across all products)
  const history = await safeQuery(
    `SELECT snapshot_date, SUM(new_mrr_cents + expansion_mrr_cents - contraction_mrr_cents - churned_mrr_cents) as mrr
     FROM metric_snapshots WHERE snapshot_date > date('now', '-90 days')
     GROUP BY snapshot_date ORDER BY snapshot_date`, []
  );

  const mrrHistory = (history.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    date: r.snapshot_date as string,
    mrr: ((r.mrr as number) ?? 0) / 100,
  }));

  // Simple growth rate from last 2 months
  const twoMonthsAgo = await safeQuery(
    'SELECT COUNT(*) as c, tier FROM founders WHERE tier IS NOT NULL AND created_at < datetime("now", "-30 days") GROUP BY tier', []
  );
  let priorMRR = 0;
  for (const row of twoMonthsAgo.rows as unknown as Array<Record<string, unknown>>) {
    priorMRR += (row.c as number) * (tierPricing[row.tier as string] ?? 0);
  }

  const growthRate = priorMRR > 0 ? ((totalMRR - priorMRR) / priorMRR) * 100 : 0;
  const monthlyGrowthDecimal = growthRate / 100;
  const trend = growthRate > 2 ? 'growing' : growthRate < -2 ? 'declining' : 'flat';

  return {
    current_mrr: totalMRR,
    mrr_30d_ago: priorMRR,
    mrr_trend: trend,
    growth_rate_pct: Math.round(growthRate * 10) / 10,
    arr: totalMRR * 12,
    by_tier: byTier,
    mrr_history: mrrHistory,
    forecast_3m: Math.round(totalMRR * Math.pow(1 + monthlyGrowthDecimal, 3)),
    forecast_6m: Math.round(totalMRR * Math.pow(1 + monthlyGrowthDecimal, 6)),
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
     WHERE ls.risk_state IN ('yellow', 'red') AND p.status = 'active'
     ORDER BY ls.risk_state DESC LIMIT 20`, []
  );

  // COUNTED, NOT MEASURED OFF THE PAGE. The same predicate as the list above,
  // without the limit that exists only so a card fits.
  const totals = await safeQuery(
    `SELECT
       (SELECT COUNT(*) FROM products WHERE status = 'active') AS active,
       (SELECT COUNT(*) FROM products p JOIN lifecycle_state ls ON p.id = ls.product_id
         WHERE ls.risk_state IN ('yellow','red') AND p.status = 'active') AS at_risk,
       (SELECT COUNT(*) FROM products p JOIN lifecycle_state ls ON p.id = ls.product_id
         WHERE ls.risk_state = 'yellow' AND p.status = 'active') AS yellow`, []);

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
  auto_execute_rate: number;
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
    auto_execute_rate: total > 0 ? Math.round((autoCount / total) * 100) : 100,
    recent_actions: (recentActions.rows as unknown as Array<Record<string, string>>).map((r) => ({
      action: r.action_type, outcome: r.outcome ?? 'completed', timestamp: r.created_at,
    })),
  };
}

// ─── Customer Health Overview ───────────────────────────────────────────────

export interface CustomerHealthOverview {
  total_customers: number;
  healthy: number;
  warning: number;
  critical: number;
  avg_health_score: number;
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
    avg_health: scored.length
      ? scored.reduce((sum, c) => sum + (c.healthScore ?? 0), 0) / scored.length : 0,
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
    avg_health_score: Math.round(t.avg_health),
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

export interface Forecast {
  current_mrr: number;
  runway_months: number;
  break_even_month: string | null;
  projections: Array<{ month: string; mrr: number; customers: number }>;
}

export async function getForecast(): Promise<Forecast> {
  const mrr = await getMRRIntelligence();

  const projections: Array<{ month: string; mrr: number; customers: number }> = [];
  const monthlyGrowth = mrr.growth_rate_pct / 100;
  const totalCustomers = Object.values(mrr.by_tier).reduce((s, t) => s + t.count, 0);
  let runningMRR = mrr.current_mrr;
  let runningCustomers = totalCustomers;

  for (let i = 1; i <= 12; i++) {
    runningMRR = Math.round(runningMRR * (1 + monthlyGrowth));
    runningCustomers = Math.round(runningCustomers * (1 + monthlyGrowth * 0.8));
    const date = new Date();
    date.setMonth(date.getMonth() + i);
    projections.push({
      month: date.toISOString().slice(0, 7),
      mrr: runningMRR,
      customers: runningCustomers,
    });
  }

  return {
    current_mrr: mrr.current_mrr,
    runway_months: 999, // SaaS with low burn
    break_even_month: null,
    projections,
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
- MRR: $${pulse.mrr} (${pulse.mrr_delta_pct > 0 ? '+' : ''}${pulse.mrr_delta_pct}% MoM)
- Active founders: ${pulse.active_founders}, products: ${pulse.active_products}
- New founders this month: ${pulse.founders_this_month}
- ${pulse.active_stressors} active stressors (${pulse.critical_stressors} critical)
- ${pulse.pending_decisions} decisions pending
- At-risk products: ${churn.at_risk_count}
- Auto-execute rate: ${automation.auto_execute_rate}%
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

export interface WellbeingData {
  energy_score: number;
  stress_signals: string[];
  days_since_break: number;
  override_count_7d: number;
  burnout_trajectory: 'improving' | 'stable' | 'declining';
  recommendation: string | null;
}

export async function getWellbeing(founderId: string): Promise<WellbeingData> {
  const health = await safeQuery('SELECT * FROM founder_health WHERE founder_id = ?', [founderId]);
  const h = health.rows[0] as Record<string, unknown> | undefined;

  const motivation = (h?.motivation_score as number) ?? 50;
  const engagement = (h?.engagement_trend as string) ?? 'stable';

  // Compute energy score
  let energy = 70;
  const stressSignals: string[] = [];

  if (motivation < 30) { energy -= 25; stressSignals.push('Low motivation score'); }
  else if (motivation < 50) { energy -= 10; }
  if (engagement === 'declining') { energy -= 15; stressSignals.push('Declining engagement'); }
  if (engagement === 'critical') { energy -= 30; stressSignals.push('Critical engagement drop'); }

  const runway = (h?.personal_runway_months as number) ?? null;
  if (runway !== null && runway < 3) { energy -= 15; stressSignals.push(`Only ${runway} months runway`); }

  energy = Math.max(0, Math.min(100, energy));

  // Burnout trajectory from snapshots
  const snapshots = await safeQuery(
    'SELECT motivation_score FROM founder_health_snapshots WHERE founder_id = ? ORDER BY snapshot_date DESC LIMIT 5',
    [founderId]
  );
  const scores = (snapshots.rows as unknown as Array<Record<string, number>>).map((s) => s.motivation_score ?? 50);
  let trajectory: 'improving' | 'stable' | 'declining' = 'stable';
  if (scores.length >= 3) {
    const recent = scores.slice(0, 2);
    const older = scores.slice(2);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    if (recentAvg > olderAvg + 5) trajectory = 'improving';
    if (recentAvg < olderAvg - 5) trajectory = 'declining';
  }

  let recommendation: string | null = null;
  if (energy < 40) recommendation = 'Your energy is low. Consider delegating decisions and taking a break.';
  else if (stressSignals.length > 0) recommendation = 'Some stress signals detected. Review your workload.';

  return {
    energy_score: energy,
    stress_signals: stressSignals,
    days_since_break: 0, // Would track from activity gaps
    override_count_7d: 0,
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
  /** Actually recorded spend, summed from `cost_events`. */
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
  // The canonical spend ledger: real amounts, every cost type.
  const spend = await safeQuery(
    `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM cost_events
      WHERE created_at > datetime('now', '-1 day')`, []);
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
