// =============================================================================
// FOUNDRY — Customer Intelligence Dashboard
// Customer lifecycle stages, health scoring, at-risk view, agent notes.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import type { HtmlContent } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  getLifecycleSummary,
  getCustomersByStage,
  getAtRiskCustomers,
  getCustomer,
  type CustomerRecord,
} from '../../services/customer/intelligence.js';
import { getRules } from '../../services/customer/lifecycle.js';
import { getFallingCustomers, FALLING_HEALTH_POINTS, TREND_WINDOW_DAYS } from '../../services/institution/company-customers.js';

export const agentCustomerRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function healthBg(score: number): string {
  if (score >= 70) return '#dcfce7';
  if (score >= 40) return '#fef3c7';
  return '#fee2e2';
}

function stageBadge(stage: string): string {
  const map: Record<string, [string, string]> = {
    visitor:   ['#6b7280', '#f3f4f6'],
    trial:     ['#3b82f6', '#dbeafe'],
    activated: ['#8b5cf6', '#ede9fe'],
    paying:    ['#22c55e', '#dcfce7'],
    at_risk:   ['#ef4444', '#fee2e2'],
    churned:   ['#9ca3af', '#f3f4f6'],
    expansion: ['#f59e0b', '#fef3c7'],
    advocate:  ['#06b6d4', '#cffafe'],
  };
  const [color, bg] = map[stage] ?? ['#6b7280', '#f3f4f6'];
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase">${stage}</span>`;
}

function fmtMRR(cents: number): string {
  if (cents === 0) return '—';
  return `$${(cents / 100).toFixed(0)}/mo`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function healthBar(score: number, width = 80): string {
  const color = healthColor(score);
  return `<div style="display:flex;align-items:center;gap:6px">
    <div style="width:${width}px;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">
      <div style="width:${Math.round(score)}%;height:100%;background:${color};border-radius:3px"></div>
    </div>
    <span style="font-size:11px;color:${color};font-weight:600">${Math.round(score)}</span>
  </div>`;
}

// ─── GET /agents/customers ────────────────────────────────────────────────────

agentCustomerRoutes.get('/agents/customers', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents-customers', 'Customer Intelligence');

  if (!ctx.productId) return c.redirect('/dashboard');
  const productId = ctx.productId;

  const [summary, atRisk, allCustomers, rules, falling] = await Promise.all([
    getLifecycleSummary(productId),
    getAtRiskCustomers(productId),
    getCustomersByStage(productId),
    getRules(productId),
    // Customers moving the wrong way, whatever their current score. Read from
    // `customer_health_snapshots`, which every health refresh has been writing
    // and nothing had ever read.
    getFallingCustomers(productId),
  ]);
  const byId = new Map(
    (allCustomers as CustomerRecord[]).map((c) => [String(c.id), c]));

  const stageOrder = ['trial', 'activated', 'paying', 'expansion', 'at_risk', 'churned', 'visitor', 'advocate'];
  const stageLabels: Record<string, string> = {
    trial: 'Trial', activated: 'Activated', paying: 'Paying',
    expansion: 'Expansion', at_risk: 'At Risk', churned: 'Churned',
    visitor: 'Visitor', advocate: 'Advocate',
  };

  const totalMRR = summary.total_mrr_cents / 100;

  const body = html`
    <div style="max-width:1100px;margin:0 auto;padding:24px 16px">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
        <div>
          <h1 style="font-size:22px;font-weight:700;color:#111;margin:0">Customer Intelligence</h1>
          <p style="color:#6b7280;margin:4px 0 0;font-size:14px">Lifecycle stages, health scores, and agent-driven interventions</p>
        </div>
        <a href="/agents/customers/rules" style="background:#111;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Lifecycle Rules</a>
      </div>

      <!-- Summary stats -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;margin-bottom:4px">Total Customers</div>
          <div style="font-size:28px;font-weight:700;color:#111">${summary.total}</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;margin-bottom:4px">Avg Health</div>
          <div style="font-size:28px;font-weight:700;color:${healthColor(summary.avg_health)}">${Math.round(summary.avg_health)}</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;margin-bottom:4px">At Risk</div>
          <div style="font-size:28px;font-weight:700;color:#ef4444">${summary.at_risk_count}</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;margin-bottom:4px">MRR Tracked</div>
          <div style="font-size:28px;font-weight:700;color:#111">$${Math.round(totalMRR)}</div>
        </div>
      </div>

      <!-- Lifecycle funnel -->
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:24px">
        <h2 style="font-size:14px;font-weight:700;color:#111;margin:0 0 16px">Lifecycle Pipeline</h2>
        <div style="display:flex;gap:8px;align-items:flex-end">
          ${stageOrder.map(stage => {
            const count = summary.by_stage[stage] ?? 0;
            const pct = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
            const [color] = (stage === 'at_risk' ? ['#ef4444'] : stage === 'paying' ? ['#22c55e'] : stage === 'churned' ? ['#9ca3af'] : ['#3b82f6']);
            const barH = Math.max(4, pct * 1.5);
            return html`<div style="flex:1;text-align:center">
              <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:4px">${count}</div>
              <div style="height:${barH}px;background:${color};border-radius:4px;opacity:0.8"></div>
              <div style="font-size:10px;color:#6b7280;margin-top:4px">${stageLabels[stage] ?? stage}</div>
            </div>`;
          })}
        </div>
      </div>

      <!-- At-risk table -->
      ${atRisk.length > 0 ? html`
      <div style="background:#fff;border:1px solid #fca5a5;border-radius:8px;padding:20px;margin-bottom:24px">
        <h2 style="font-size:14px;font-weight:700;color:#dc2626;margin:0 0 16px">⚠ At-Risk Customers (${atRisk.length})</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #e5e7eb">
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Customer</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Stage</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Health</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Last Active</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">MRR</th>
            </tr>
          </thead>
          <tbody>
            ${atRisk.map((c: CustomerRecord) => html`
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px 12px">
                <div style="font-weight:600;color:#111">${c.account_name ?? c.external_customer_id}</div>
                ${c.email ? html`<div style="font-size:11px;color:#9ca3af">${c.email}</div>` : ''}
              </td>
              <td style="padding:10px 12px">${stageBadge(c.stage)}</td>
              <td style="padding:10px 12px">${healthBar(c.health_score)}</td>
              <td style="padding:10px 12px;color:#6b7280">${timeAgo(c.last_active_at)}</td>
              <td style="padding:10px 12px;color:#374151">${fmtMRR(c.mrr_cents)}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>` : ''}

      <!-- Falling, whatever the current score -->
      ${falling.length > 0 ? html`
      <div style="background:#fff;border:1px solid #fcd34d;border-radius:8px;padding:20px;margin-bottom:24px">
        <h2 style="font-size:14px;font-weight:700;color:#b45309;margin:0 0 6px">
          ↓ Falling (${falling.length})</h2>
        <p style="font-size:12px;color:#6b7280;margin:0 0 16px">
          Health dropping ${FALLING_HEALTH_POINTS} points or more over the last
          ${TREND_WINDOW_DAYS} days, and which part of the score moved most. Some of these are still above the at-risk
          line — that is the point of showing them: a customer on the way down is
          easier to keep than one already gone.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #e5e7eb">
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Customer</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Was</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Now</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Change</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Over</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">What moved</th>
            </tr>
          </thead>
          <tbody>
            ${falling.map((t) => {
              const c = byId.get(t.customerId);
              return html`
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px 12px;font-weight:600;color:#111">
                ${c ? (c.account_name ?? c.external_customer_id) : t.customerId}</td>
              <td style="padding:10px 12px;color:#6b7280">${Math.round(t.earliestScore)}</td>
              <td style="padding:10px 12px;color:#111">${Math.round(t.latestScore)}</td>
              <td style="padding:10px 12px;color:#b45309;font-weight:600">${t.deltaPoints}</td>
              <td style="padding:10px 12px;color:#6b7280">${t.daysObserved} days</td>
              <td style="padding:10px 12px;color:#6b7280">${t.largestDrop === null
                ? 'not recorded'
                : `${t.largestDrop.component} ${t.largestDrop.deltaPoints}`}</td>
            </tr>`;
            })}
          </tbody>
        </table>
      </div>` : ''}

      <!-- All customers table -->
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:24px">
        <h2 style="font-size:14px;font-weight:700;color:#111;margin:0 0 16px">All Customers (${allCustomers.length})</h2>
        ${allCustomers.length === 0 ? html`
          <div style="text-align:center;padding:40px;color:#9ca3af">
            <div style="font-size:32px;margin-bottom:8px">👥</div>
            <div>No customers yet. Connect Stripe to start tracking.</div>
            <a href="/agents/integrations" style="color:#3b82f6;text-decoration:none;font-size:13px">Set up integrations →</a>
          </div>` : html`
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #e5e7eb">
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Customer</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Stage</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Health</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">MRR</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Last Active</th>
              <th style="text-align:left;padding:8px 12px;font-weight:600;color:#6b7280">Plan</th>
            </tr>
          </thead>
          <tbody>
            ${allCustomers.map((c: CustomerRecord) => html`
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px 12px">
                <div style="font-weight:600;color:#111">${c.account_name ?? c.external_customer_id}</div>
                ${c.email ? html`<div style="font-size:11px;color:#9ca3af">${c.email}</div>` : ''}
              </td>
              <td style="padding:10px 12px">${stageBadge(c.stage)}</td>
              <td style="padding:10px 12px">${healthBar(c.health_score, 60)}</td>
              <td style="padding:10px 12px;color:#374151">${fmtMRR(c.mrr_cents)}</td>
              <td style="padding:10px 12px;color:#6b7280">${timeAgo(c.last_active_at)}</td>
              <td style="padding:10px 12px;color:#374151">${c.plan ?? '—'}</td>
            </tr>`)}
          </tbody>
        </table>`}
      </div>

      <!-- Lifecycle rules -->
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px">
        <h2 style="font-size:14px;font-weight:700;color:#111;margin:0 0 16px">Lifecycle Automation Rules (${rules.filter(r => r.enabled).length} active)</h2>
        ${rules.length === 0 ? html`<div style="color:#9ca3af;font-size:13px">No rules configured.</div>` : html`
        <div style="display:flex;flex-direction:column;gap:8px">
          ${rules.map(r => html`
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:${r.enabled ? '#f9fafb' : '#f3f4f6'};border-radius:6px;border:1px solid ${r.enabled ? '#e5e7eb' : '#d1d5db'}">
            <div>
              <div style="font-weight:600;color:${r.enabled ? '#111' : '#9ca3af'};font-size:13px">${r.name}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px">
                Trigger: <strong>${r.trigger_event}</strong> → ${r.action_agent} ${r.action_type} (Level ${r.authority_level})
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:11px;color:#9ca3af">${r.times_triggered} triggers</div>
              <div style="font-size:11px;color:${r.enabled ? '#22c55e' : '#9ca3af'}">${r.enabled ? '● Active' : '○ Disabled'}</div>
            </div>
          </div>`)}
        </div>`}
      </div>

    </div>`;

  return c.html(dashboardLayout(ctx, body as unknown as HtmlContent));
});

// ─── GET /agents/customers/rules ─────────────────────────────────────────────

agentCustomerRoutes.get('/agents/customers/rules', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents-customers', 'Lifecycle Rules');
  if (!ctx.productId) return c.redirect('/agents/customers');

  const rules = await getRules(ctx.productId);

  const body = html`
    <div style="max-width:900px;margin:0 auto;padding:24px 16px">
      <div style="margin-bottom:20px">
        <a href="/agents/customers" style="color:#6b7280;text-decoration:none;font-size:13px">← Customer Intelligence</a>
        <h1 style="font-size:22px;font-weight:700;color:#111;margin:8px 0 0">Lifecycle Rules</h1>
      </div>
      ${rules.map(r => html`
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div>
            <div style="font-weight:700;font-size:14px;color:#111">${r.name}</div>
            ${r.description ? html`<div style="color:#6b7280;font-size:12px;margin-top:2px">${r.description}</div>` : ''}
            <div style="margin-top:8px;font-size:12px;color:#374151">
              <span style="background:#f3f4f6;padding:2px 8px;border-radius:4px;margin-right:6px">Trigger: ${r.trigger_event}</span>
              <span style="background:#f3f4f6;padding:2px 8px;border-radius:4px;margin-right:6px">Agent: ${r.action_agent}</span>
              <span style="background:#f3f4f6;padding:2px 8px;border-radius:4px">Level ${r.authority_level}</span>
            </div>
          </div>
          <div style="text-align:right;font-size:12px;color:#6b7280">
            <div>${r.times_triggered} triggered</div>
            <div style="color:${r.enabled ? '#22c55e' : '#9ca3af'}">${r.enabled ? 'Active' : 'Disabled'}</div>
          </div>
        </div>
      </div>`)}
    </div>`;

  return c.html(dashboardLayout(ctx, body as unknown as HtmlContent));
});
