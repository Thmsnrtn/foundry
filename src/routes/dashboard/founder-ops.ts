// =============================================================================
// FOUNDRY — Founder Operations Dashboard
// Locked to thmsnrtn@gmail.com. Pulls real AcreOS business data.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  isFounder, getPulse, getMRRIntelligence, getChurnIntelligence,
  getAutomationHealth, getCustomerHealthOverview, getWellbeing,
  getGrowthSignals, getAICostData, generateMorningBriefing,
} from '../../services/founder/intelligence.js';

const FOUNDER_EMAIL = 'thmsnrtn@gmail.com';

export const founderOpsRoutes = new Hono<AuthEnv>();

// ─── Founder Ops Dashboard ──────────────────────────────────────────────────

founderOpsRoutes.get('/founder-ops', async (c) => {
  const founder = c.get('founder');
  if (!isFounder(founder.email)) return c.redirect('/dashboard');

  const ctx = await getLayoutContext(founder, 'founder-ops', 'Founder Ops');

  // Fetch all intelligence data in parallel — wrapped to prevent 500 if tables are missing
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };

  const defaultPulse = { status: 'healthy' as const, mrr: 0, mrr_delta_pct: 0, active_products: 0, active_founders: 0, founders_this_month: 0, churn_this_month: 0, active_stressors: 0, critical_stressors: 0, pending_decisions: 0, job_health: { healthy: 0, degraded: 0, failed: 0 }, system_uptime: '0h', last_audit_run: null, alerts: [] };
  const defaultMRR = { current_mrr: 0, mrr_30d_ago: 0, mrr_trend: 'flat' as const, growth_rate_pct: 0, arr: 0, by_tier: {}, mrr_history: [], forecast_3m: 0, forecast_6m: 0 };
  const defaultChurn = { churn_rate_30d: 0, at_risk_count: 0, at_risk_products: [], churned_this_month: 0, rescue_opportunities: 0 };
  const defaultAutomation = { total_jobs: 0, jobs_healthy: 0, jobs_degraded: 0, jobs_failed: 0, auto_decisions_24h: 0, escalated_decisions_24h: 0, auto_execute_rate: 0, recent_actions: [] };
  const defaultHealth = { total_customers: 0, healthy: 0, warning: 0, critical: 0, avg_health_score: 0, top_at_risk: [], champions: 0, revenue_at_risk: 0 };
  const defaultWellbeing = { energy_score: 70, stress_signals: [], days_since_break: 0, override_count_7d: 0, burnout_trajectory: 'stable' as const, recommendation: null };
  const defaultGrowth = { new_signups_7d: 0, new_signups_30d: 0, activation_rate: 0, trial_to_paid_rate: 0, expansion_revenue: 0, top_acquisition_channels: [] };
  const defaultAICost = { total_tokens_24h: 0, total_cost_24h: 0, avg_latency_ms: 0, calls_by_model: {}, cost_per_founder: 0 };

  const [pulse, mrr, churn, automation, customerHealth, wellbeing, growth, aiCost] = await Promise.all([
    safe(getPulse, defaultPulse),
    safe(getMRRIntelligence, defaultMRR),
    safe(getChurnIntelligence, defaultChurn),
    safe(getAutomationHealth, defaultAutomation),
    safe(getCustomerHealthOverview, defaultHealth),
    safe(() => getWellbeing(founder.id), defaultWellbeing),
    safe(getGrowthSignals, defaultGrowth),
    safe(getAICostData, defaultAICost),
  ]);

  // Activation funnel — last 30 days (Phase 5.2).
  const funnel = await safe(async () => {
    const { getFunnelReadout } = await import('../../services/telemetry/funnel.js');
    return getFunnelReadout(new Date(Date.now() - 30 * 86_400_000).toISOString());
  }, [] as Awaited<ReturnType<typeof import('../../services/telemetry/funnel.js').getFunnelReadout>>);

  const products = await query("SELECT * FROM products WHERE owner_id = ? AND status = 'active'", [founder.id]).catch(() => ({ rows: [] }));
  const pendingDecisions = await query(
    `SELECT d.*, p.name as product_name FROM decisions d JOIN products p ON d.product_id = p.id WHERE d.status = 'pending' ORDER BY d.created_at ASC LIMIT 10`, []).catch(() => ({ rows: [] }));

  const statusColor = pulse.status === 'healthy' ? '#059669' : pulse.status === 'warning' ? '#d97706' : '#dc2626';
  const statusIcon = pulse.status === 'healthy' ? '&#10004;' : pulse.status === 'warning' ? '&#9888;' : '&#9888;';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const content = html`
    <!-- Hero -->
    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);color:white;padding:1.5rem;border-radius:12px;margin-bottom:1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h1 style="color:white;margin:0;">${greeting}</h1>
          <p style="color:#94a3b8;margin:0.25rem 0 0;">
            <span style="color:${statusColor};font-weight:600;">${statusIcon} ${pulse.status.toUpperCase()}</span>
            ${pulse.alerts.length === 0 ? ' — Everything is running smoothly' : ` — ${pulse.alerts.length} item(s) need attention`}
          </p>
        </div>
        <div style="text-align:right;font-size:0.8rem;color:#64748b;">
          Uptime: ${pulse.system_uptime}<br/>
          ${pulse.job_health.healthy} jobs healthy
        </div>
      </div>
    </div>

    <!-- KPI Row -->
    <div class="dashboard-grid" style="margin-bottom:1.5rem;">
      ${kpiCard('MRR', '$' + mrr.current_mrr.toLocaleString(), mrr.growth_rate_pct > 0 ? '+' + mrr.growth_rate_pct + '%' : mrr.growth_rate_pct + '%')}
      ${kpiCard('ARR', '$' + mrr.arr.toLocaleString(), null)}
      ${kpiCard('Founders', pulse.active_founders.toString(), pulse.founders_this_month > 0 ? '+' + pulse.founders_this_month + ' this mo' : null)}
      ${kpiCard('At Risk', churn.at_risk_count.toString(), churn.at_risk_count > 0 ? '$' + customerHealth.revenue_at_risk + ' MRR' : 'None')}
    </div>

    <!-- Two-column layout -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">

      <!-- Subscription Breakdown -->
      <div class="card">
        <h3>Revenue by Tier</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.75rem;">
          ${tierCard('Solo', mrr.by_tier.solo?.count ?? 0, '$' + (mrr.by_tier.solo?.mrr ?? 0))}
          ${tierCard('Growth', mrr.by_tier.growth?.count ?? 0, '$' + (mrr.by_tier.growth?.mrr ?? 0))}
          ${tierCard('Investor-Ready', mrr.by_tier.investor_ready?.count ?? 0, '$' + (mrr.by_tier.investor_ready?.mrr ?? 0))}
          ${tierCard('Forecast 3mo', 0, '$' + mrr.forecast_3m.toLocaleString())}
        </div>
      </div>

      <!-- Customer Health -->
      <div class="card">
        <h3>Customer Health</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-top:0.75rem;">
          <div style="text-align:center;padding:0.5rem;background:#dcfce7;border-radius:6px;">
            <div style="font-size:1.25rem;font-weight:700;color:#059669;">${customerHealth.healthy}</div>
            <div style="font-size:0.7rem;color:#059669;">Healthy</div>
          </div>
          <div style="text-align:center;padding:0.5rem;background:#fef9c3;border-radius:6px;">
            <div style="font-size:1.25rem;font-weight:700;color:#d97706;">${customerHealth.warning}</div>
            <div style="font-size:0.7rem;color:#d97706;">Warning</div>
          </div>
          <div style="text-align:center;padding:0.5rem;background:#fee2e2;border-radius:6px;">
            <div style="font-size:1.25rem;font-weight:700;color:#dc2626;">${customerHealth.critical}</div>
            <div style="font-size:0.7rem;color:#dc2626;">Critical</div>
          </div>
        </div>
        <div style="margin-top:0.75rem;font-size:0.8rem;color:#6b7280;">
          Avg health: ${customerHealth.avg_health_score}/100 | Champions: ${customerHealth.champions} | Revenue at risk: $${customerHealth.revenue_at_risk}
        </div>
      </div>
    </div>

    <!-- Alerts -->
    ${pulse.alerts.length > 0 ? html`
    <div class="card" style="margin-bottom:1.5rem;border-left:4px solid ${statusColor};">
      <h3>Attention Required</h3>
      ${pulse.alerts.map((a) => html`
        <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;gap:0.5rem;">
          <span class="badge ${a.severity === 'critical' ? 'badge-critical' : 'badge-watch'}">${a.severity}</span>
          <span style="font-size:0.87rem;">${a.message}</span>
        </div>`)}
    </div>` : ''}

    <!-- Churn Risk Products -->
    ${churn.at_risk_products.length > 0 ? html`
    <div class="card" style="margin-bottom:1.5rem;">
      <h3>At-Risk Products</h3>
      <table style="width:100%;font-size:0.87rem;margin-top:0.5rem;">
        <thead><tr style="text-align:left;border-bottom:1px solid #e5e7eb;">
          <th style="padding:0.5rem;">Product</th><th>Risk State</th><th>Stressors</th></tr></thead>
        <tbody>
        ${churn.at_risk_products.map((p) => html`
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:0.5rem;font-weight:600;">${p.name}</td>
            <td><span class="badge ${p.risk_state === 'red' ? 'badge-critical' : 'badge-watch'}">${p.risk_state}</span></td>
            <td>${p.stressor_count} active</td>
          </tr>`)}
        </tbody>
      </table>
    </div>` : ''}

    <!-- Decisions Inbox -->
    ${pendingDecisions.rows.length > 0 ? html`
    <div class="card" style="margin-bottom:1.5rem;">
      <h3>Decisions Inbox (${pendingDecisions.rows.length})</h3>
      ${(pendingDecisions.rows as unknown as Array<Record<string, string>>).map((d) => html`
        <div style="padding:0.75rem 0;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <span class="badge badge-watch" style="font-size:0.7rem;">${d.category} / Gate ${d.gate}</span>
              <span style="font-size:0.8rem;color:#6b7280;margin-left:0.5rem;">${(d as any).product_name}</span>
              <div style="font-weight:600;margin-top:0.25rem;">${d.what}</div>
              <div style="font-size:0.8rem;color:#6b7280;margin-top:0.15rem;">${d.why_now}</div>
            </div>
            <div style="display:flex;gap:0.25rem;flex-shrink:0;">
              <form method="POST" action="/api/founder/intelligence/decisions-inbox/${d.id}/approve" style="display:inline;">
                <button type="submit" class="btn btn-primary btn-sm" style="font-size:0.75rem;padding:0.25rem 0.5rem;">Approve</button>
              </form>
              <form method="POST" action="/api/founder/intelligence/decisions-inbox/${d.id}/reject" style="display:inline;">
                <button type="submit" class="btn btn-secondary btn-sm" style="font-size:0.75rem;padding:0.25rem 0.5rem;">Reject</button>
              </form>
            </div>
          </div>
        </div>`)}
    </div>` : ''}

    <!-- Activation Funnel (last 30 days) -->
    ${funnel.length > 0 && (funnel[0]?.count ?? 0) > 0 ? html`
    <div class="card" style="margin-bottom:1.5rem;">
      <h3>Activation Funnel <span style="font-size:0.75rem;color:#6b7280;font-weight:400;">· last 30 days</span></h3>
      <div style="margin-top:0.75rem;">
        ${funnel.map((row) => {
          const pct = Math.round(row.fromTop * 100);
          const stepPct = Math.round(row.fromPrev * 100);
          return html`
          <div style="display:flex;align-items:center;gap:0.75rem;padding:0.3rem 0;">
            <div style="width:150px;font-size:0.8rem;color:#374151;text-transform:capitalize;">${row.step.replace(/_/g, ' ')}</div>
            <div style="flex:1;background:#f3f4f6;border-radius:4px;height:18px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:#6366f1;"></div>
            </div>
            <div style="width:120px;text-align:right;font-size:0.78rem;color:#6b7280;">
              ${row.count} · ${pct}%${row.step !== 'signup' ? ` <span style="color:#9ca3af;">(${stepPct}% step)</span>` : ''}
            </div>
          </div>`;
        })}
      </div>
    </div>` : ''}

    <!-- Two-column: Automation + Growth -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">
      <div class="card">
        <h3>Automation Health</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
          ${metricBadge('Auto-Execute Rate', automation.auto_execute_rate + '%')}
          ${metricBadge('Auto Decisions (24h)', automation.auto_decisions_24h)}
          ${metricBadge('Escalated (24h)', automation.escalated_decisions_24h)}
          ${metricBadge('Jobs Running', automation.total_jobs)}
        </div>
      </div>

      <div class="card">
        <h3>Growth Signals</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
          ${metricBadge('Signups (7d)', growth.new_signups_7d)}
          ${metricBadge('Signups (30d)', growth.new_signups_30d)}
          ${metricBadge('Activation Rate', growth.activation_rate + '%')}
          ${metricBadge('Trial → Paid', growth.trial_to_paid_rate + '%')}
        </div>
      </div>
    </div>

    <!-- Two-column: AI Cost + Wellbeing -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">
      <div class="card">
        <h3>AI Cost Efficiency</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
          ${metricBadge('Tokens (24h)', aiCost.total_tokens_24h.toLocaleString())}
          ${metricBadge('Cost (24h)', '$' + aiCost.total_cost_24h)}
          ${metricBadge('Cost/Founder', '$' + aiCost.cost_per_founder)}
          ${metricBadge('Models', Object.keys(aiCost.calls_by_model).length)}
        </div>
      </div>

      <div class="card" style="border-left:4px solid ${wellbeing.energy_score > 60 ? '#059669' : wellbeing.energy_score > 35 ? '#d97706' : '#dc2626'};">
        <h3>Founder Wellbeing</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
          ${metricBadge('Energy Score', wellbeing.energy_score + '/100')}
          ${metricBadge('Trajectory', wellbeing.burnout_trajectory)}
          ${metricBadge('Stress Signals', wellbeing.stress_signals.length)}
          ${metricBadge('Overrides (7d)', wellbeing.override_count_7d)}
        </div>
        ${wellbeing.recommendation ? html`<p style="font-size:0.8rem;color:#d97706;margin-top:0.5rem;">${wellbeing.recommendation}</p>` : ''}
      </div>
    </div>

    <!-- Products Table -->
    <div class="card" style="margin-bottom:1.5rem;">
      <h3>Products</h3>
      <table style="width:100%;font-size:0.87rem;margin-top:0.5rem;">
        <thead><tr style="text-align:left;border-bottom:1px solid #e5e7eb;">
          <th style="padding:0.5rem;">Product</th><th>Sector</th><th>Stage</th><th>Risk</th><th>Actions</th>
        </tr></thead>
        <tbody>
        ${(products.rows as unknown as Array<Record<string, string>>).map((p) => html`
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:0.5rem;font-weight:600;">${p.name}</td>
            <td style="font-size:0.8rem;">${p.sector_profile ?? 'b2b_saas'}</td>
            <td><span class="badge badge-watch">${p.growth_stage ?? 'pre_launch'}</span></td>
            <td>—</td>
            <td><a href="/dashboard" style="font-size:0.8rem;">View</a></td>
          </tr>`)}
        </tbody>
      </table>
    </div>

    <!-- Quick Actions -->
    <div class="card">
      <h3>Quick Actions</h3>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">
        <a href="https://dashboard.stripe.com" class="btn btn-secondary btn-sm" target="_blank">Stripe</a>
        <a href="/api/founder-ops/export" class="btn btn-secondary btn-sm">Export All Data</a>
        <a href="/api/founder/intelligence/morning-briefing" class="btn btn-secondary btn-sm" target="_blank">Morning Briefing</a>
        <a href="/settings" class="btn btn-secondary btn-sm">Settings</a>
      </div>
    </div>
  `;

  return c.html(dashboardLayout({ ...ctx, founderEmail: founder.email }, content));
});

// ─── API Endpoints (founder-only) ───────────────────────────────────────────

founderOpsRoutes.get('/api/founder-ops/metrics', async (c) => {
  const founder = c.get('founder');
  if (!isFounder(founder.email)) return c.json({ error: 'Forbidden' }, 403);

  const [pulse, mrr, churn] = await Promise.all([getPulse(), getMRRIntelligence(), getChurnIntelligence()]);
  return c.json({ pulse, mrr, churn });
});

founderOpsRoutes.get('/api/founder-ops/stripe-dashboard', async (c) => {
  const founder = c.get('founder');
  if (!isFounder(founder.email)) return c.json({ error: 'Forbidden' }, 403);
  return c.redirect('https://dashboard.stripe.com');
});

founderOpsRoutes.get('/api/founder-ops/export', async (c) => {
  const founder = c.get('founder');
  if (!isFounder(founder.email)) return c.json({ error: 'Forbidden' }, 403);

  const [founders, products, decisions, stressors, metrics] = await Promise.all([
    query('SELECT id, email, tier, created_at FROM founders', []),
    query('SELECT id, name, sector_profile, growth_stage, status FROM products', []),
    query('SELECT id, product_id, what, status, gate FROM decisions ORDER BY created_at DESC LIMIT 100', []),
    query("SELECT id, product_id, stressor_name, severity, status FROM stressor_history WHERE status = 'active'", []),
    query('SELECT * FROM metric_snapshots ORDER BY snapshot_date DESC LIMIT 50', []),
  ]);

  return c.json({
    exported_at: new Date().toISOString(),
    founders: founders.rows,
    products: products.rows,
    recent_decisions: decisions.rows,
    active_stressors: stressors.rows,
    recent_metrics: metrics.rows,
  });
});


// ─── HTML Helpers ───────────────────────────────────────────────────────────

function kpiCard(label: string, value: string, delta: string | null, prefix = '', suffix = '') {
  return html`
  <div class="card" style="padding:1rem;text-align:center;">
    <div style="font-size:0.8rem;color:#6b7280;margin-bottom:0.25rem;">${label}</div>
    <div style="font-size:1.5rem;font-weight:700;">${prefix}${value}${suffix}</div>
    ${delta ? html`<div style="font-size:0.75rem;color:${delta.startsWith('+') ? '#059669' : delta.startsWith('-') ? '#dc2626' : '#6b7280'};">${delta}</div>` : ''}
  </div>`;
}

function tierCard(name: string, count: number, price: string) {
  return html`
  <div style="padding:0.75rem;background:#f9fafb;border-radius:8px;text-align:center;">
    <div style="font-weight:600;font-size:0.87rem;">${name}</div>
    <div style="font-size:1.25rem;font-weight:700;margin:0.25rem 0;">${count}</div>
    <div style="font-size:0.75rem;color:#6b7280;">${price}/mo</div>
  </div>`;
}

function metricBadge(label: string, value: unknown) {
  return html`
  <div style="padding:0.5rem 0.75rem;background:#f3f4f6;border-radius:6px;">
    <div style="font-size:0.7rem;color:#6b7280;">${label}</div>
    <div style="font-weight:600;">${value}</div>
  </div>`;
}
