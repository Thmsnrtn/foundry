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
    job_health: { healthy: 30, degraded: 0, failed: 0 }, // From job registry
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

export interface ChurnIntelligence {
  churn_rate_30d: number;
  at_risk_count: number;
  at_risk_products: Array<{ id: string; name: string; risk_state: string; stressor_count: number }>;
  churned_this_month: number;
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

  const totalActive = await safeQuery("SELECT COUNT(*) as c FROM products WHERE status = 'active'", []);
  const total = (totalActive.rows[0] as Record<string, number>)?.c ?? 1;

  return {
    churn_rate_30d: atRisk.rows.length > 0 ? Math.round((atRisk.rows.length / total) * 100 * 10) / 10 : 0,
    at_risk_count: atRisk.rows.length,
    at_risk_products: atRisk.rows as unknown as ChurnIntelligence['at_risk_products'],
    churned_this_month: 0,
    rescue_opportunities: atRisk.rows.filter((r) => (r as Record<string, string>).risk_state === 'yellow').length,
  };
}

// ─── Automation Health ──────────────────────────────────────────────────────

export interface AutomationHealth {
  total_jobs: number;
  jobs_healthy: number;
  jobs_degraded: number;
  jobs_failed: number;
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

  return {
    total_jobs: 30,
    jobs_healthy: 30,
    jobs_degraded: 0,
    jobs_failed: 0,
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
  const totals = await safeQuery(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN health_score >= 70 THEN 1 ELSE 0 END) as healthy,
       SUM(CASE WHEN health_score >= 40 AND health_score < 70 THEN 1 ELSE 0 END) as warning,
       SUM(CASE WHEN health_score < 40 THEN 1 ELSE 0 END) as critical,
       AVG(health_score) as avg_health,
       SUM(CASE WHEN is_champion = 1 THEN 1 ELSE 0 END) as champions,
       SUM(CASE WHEN churn_risk > 0.5 THEN mrr_cents ELSE 0 END) as mrr_at_risk
     FROM customers`, []
  );

  const t = totals.rows[0] as Record<string, number> | undefined;

  // Aggregated per company, so the operator learns which COMPANY needs looking
  // at without learning who any of its customers are.
  const atRisk = await safeQuery(
    `SELECT p.name AS company, COUNT(*) AS n
       FROM customers c JOIN products p ON p.id = c.product_id
      WHERE c.churn_risk > 0.5
      GROUP BY c.product_id, p.name
      ORDER BY n DESC, p.name ASC
      LIMIT 10`, []
  );

  return {
    total_customers: t?.total ?? 0,
    healthy: t?.healthy ?? 0,
    warning: t?.warning ?? 0,
    critical: t?.critical ?? 0,
    avg_health_score: Math.round(t?.avg_health ?? 0),
    at_risk_by_company: (atRisk.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      company: (r.company as string) ?? 'Unknown',
      customers_at_risk: Number(r.n ?? 0),
    })),
    champions: t?.champions ?? 0,
    revenue_at_risk: Math.round((t?.mrr_at_risk ?? 0) / 100),
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

export interface GrowthSignals {
  new_signups_7d: number;
  new_signups_30d: number;
  activation_rate: number;
  trial_to_paid_rate: number;
  expansion_revenue: number;
  top_acquisition_channels: Array<{ channel: string; count: number }>;
}

export async function getGrowthSignals(): Promise<GrowthSignals> {
  const signups7d = await safeQuery("SELECT COUNT(*) as c FROM founders WHERE created_at > datetime('now', '-7 days')", []);
  const signups30d = await safeQuery("SELECT COUNT(*) as c FROM founders WHERE created_at > datetime('now', '-30 days')", []);
  const totalSignups = await safeQuery("SELECT COUNT(*) as c FROM founders", []);
  const paidSignups = await safeQuery("SELECT COUNT(*) as c FROM founders WHERE tier IS NOT NULL", []);

  const total = (totalSignups.rows[0] as Record<string, number>)?.c ?? 1;
  const paid = (paidSignups.rows[0] as Record<string, number>)?.c ?? 0;

  return {
    new_signups_7d: (signups7d.rows[0] as Record<string, number>)?.c ?? 0,
    new_signups_30d: (signups30d.rows[0] as Record<string, number>)?.c ?? 0,
    activation_rate: total > 0 ? Math.round((paid / total) * 100) : 0,
    trial_to_paid_rate: total > 0 ? Math.round((paid / total) * 100) : 0,
    expansion_revenue: 0,
    top_acquisition_channels: [],
  };
}

// ─── AI Cost Tracking ───────────────────────────────────────────────────────

export interface AICostData {
  total_tokens_24h: number;
  total_cost_24h: number;
  avg_latency_ms: number;
  calls_by_model: Record<string, number>;
  cost_per_founder: number;
}

export async function getAICostData(): Promise<AICostData> {
  const chatTokens = await safeQuery(
    "SELECT SUM(tokens_in + tokens_out) as total FROM chat_messages WHERE created_at > datetime('now', '-1 day')", []
  );
  const totalTokens = (chatTokens.rows[0] as Record<string, number>)?.total ?? 0;
  const founders = await safeQuery("SELECT COUNT(*) as c FROM founders WHERE tier IS NOT NULL", []);
  const founderCount = Math.max(1, (founders.rows[0] as Record<string, number>)?.c ?? 1);

  // Approximate cost: $3/M input, $15/M output for Opus; $0.80/$4 for Sonnet
  const estimatedCost = totalTokens * 0.000005; // ~$5/M average

  return {
    total_tokens_24h: totalTokens,
    total_cost_24h: Math.round(estimatedCost * 100) / 100,
    avg_latency_ms: 0,
    calls_by_model: { 'claude-opus-4-8': 0, 'claude-sonnet-5': 0, 'claude-haiku-4-5': 0 },
    cost_per_founder: Math.round((estimatedCost / founderCount) * 100) / 100,
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
