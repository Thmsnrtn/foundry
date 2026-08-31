// =============================================================================
// FOUNDRY — Strategic Intelligence Dashboard
// Synthesis, competitor profiles, AI P&L, and experiment portfolio overview.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductByOwner } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  generateStrategicSynthesis,
  getLatestSynthesis,
  getCompetitorProfiles,
} from '../../services/strategy/synthesis.js';
import {
  getAICompanyPL,
  getBudgetUtilization,
  getAgentCostBreakdown,
} from '../../services/financial/economics.js';
import { getExperimentSummary } from '../../services/scp/experiments.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const agentStrategyRoutes = new Hono<AuthEnv>();

// ─── GET /products/:id/agents/strategy ───────────────────────────────────────

agentStrategyRoutes.get('/products/:id/agents/strategy', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');

  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  const ctx = await getLayoutContext(founder, 'agents-strategy', 'Strategic Intelligence', productId);

  const [synthesis, pl, budget, agentBreakdown, expSummary, competitors] = await Promise.all([
    getLatestSynthesis(productId),
    getAICompanyPL(productId, 30),
    getBudgetUtilization(productId),
    getAgentCostBreakdown(productId, 30),
    getExperimentSummary(productId),
    getCompetitorProfiles(productId),
  ]);

  const content = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
      <h2 style="margin:0;">Strategic Intelligence</h2>
      <form method="POST" action="/products/${productId}/agents/strategy/synthesize">
        <button type="submit" class="btn btn-primary btn-sm">Generate New Synthesis</button>
      </form>
    </div>

    ${synthesisCard(synthesis)}
    ${plCard(pl, budget, agentBreakdown)}
    ${experimentPortfolioCard(expSummary, productId)}
    ${competitorCards(competitors)}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /products/:id/agents/strategy/synthesize ───────────────────────────

agentStrategyRoutes.post('/products/:id/agents/strategy/synthesize',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');

  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  try {
    await generateStrategicSynthesis(productId);
  } catch (err) {
    console.error('[STRATEGY] Synthesis failed:', err);
  }

  return c.redirect(`/products/${productId}/agents/strategy`);
});

// ─── UI Components ────────────────────────────────────────────────────────────

function synthesisCard(synthesis: Awaited<ReturnType<typeof getLatestSynthesis>>) {
  if (!synthesis) {
    return html`
      <div class="card">
        <h3>Strategic Synthesis</h3>
        <p class="text-muted" style="color:#6b7280;">No synthesis generated yet. Click "Generate New Synthesis" to create one.</p>
      </div>`;
  }

  const generatedAt = new Date(synthesis.generated_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  const priorityColors: Record<string, string> = {
    high: '#dc2626',
    medium: '#d97706',
    low: '#059669',
  };

  return html`
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h3 style="margin:0;">Latest Strategic Synthesis</h3>
        <span style="color:#6b7280;font-size:13px;">Generated ${generatedAt}</span>
      </div>

      ${synthesis.ceo_decision_needed ? html`
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:1rem;">
          <strong style="color:#92400e;">CEO Decision Required:</strong>
          <span style="color:#78350f;margin-left:8px;">${synthesis.ceo_decision_needed}</span>
        </div>` : ''}

      <div style="margin-bottom:1.5rem;">
        <h4 style="color:#374151;font-size:14px;font-weight:600;margin-bottom:0.75rem;">Top Opportunities</h4>
        ${synthesis.top_opportunities.length > 0 ? html`
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${synthesis.top_opportunities.map((opp) => html`
              <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#f9fafb;border-radius:6px;border-left:3px solid ${priorityColors[opp.priority] ?? '#6b7280'};">
                <div style="flex:1;">
                  <div style="font-weight:500;font-size:14px;">${opp.opportunity}</div>
                  <div style="color:#6b7280;font-size:12px;margin-top:2px;">
                    <span>Agent: ${opp.agent}</span>
                    <span style="margin-left:10px;">Impact: ${opp.impact}</span>
                  </div>
                </div>
                <span style="font-size:11px;font-weight:600;color:${priorityColors[opp.priority] ?? '#6b7280'};text-transform:uppercase;">${opp.priority}</span>
              </div>`)}
          </div>` : html`<p style="color:#6b7280;font-size:14px;">No opportunities identified.</p>`}
      </div>

      <div style="margin-bottom:1.5rem;">
        <h4 style="color:#374151;font-size:14px;font-weight:600;margin-bottom:0.75rem;">Recommended Priorities</h4>
        ${synthesis.recommended_priorities.length > 0 ? html`
          <ol style="margin:0;padding-left:1.25rem;">
            ${synthesis.recommended_priorities.map((p) => html`
              <li style="margin-bottom:8px;">
                <strong>${p.priority}</strong>
                <span style="color:#6b7280;font-size:13px;margin-left:6px;">— ${p.description}</span>
                <div style="color:#9ca3af;font-size:12px;margin-top:2px;">Owners: ${p.owners.join(', ')} · Impact: ${p.expected_impact}</div>
              </li>`)}
          </ol>` : html`<p style="color:#6b7280;font-size:14px;">No priorities set.</p>`}
      </div>

      <details>
        <summary style="cursor:pointer;font-weight:600;color:#2563eb;font-size:14px;">Full Synthesis</summary>
        <div class="prose" style="white-space:pre-wrap;font-size:14px;line-height:1.6;margin-top:1rem;padding:1rem;background:#f9fafb;border-radius:6px;color:#1f2937;">${synthesis.full_synthesis}</div>
      </details>
    </div>`;
}

function plCard(
  pl: Awaited<ReturnType<typeof getAICompanyPL>>,
  budget: Awaited<ReturnType<typeof getBudgetUtilization>>,
  agentBreakdown: Awaited<ReturnType<typeof getAgentCostBreakdown>>,
) {
  // NULL when no cost was recorded, which used to render as "0.0%" ROI for a
  // company whose agents had not run.
  const roiPct = pl.attributed_roi === null ? null : (pl.attributed_roi * 100).toFixed(1);
  const roiColor = pl.attributed_roi === null ? '#6b7280'
    : pl.attributed_roi >= 1 ? '#059669' : pl.attributed_roi >= 0 ? '#d97706' : '#dc2626';
  const budgetBarColor = budget.status === 'critical' ? '#dc2626' : budget.status === 'warning' ? '#d97706' : '#059669';
  const budgetPct = Math.min(100, budget.utilization_pct).toFixed(1);

  return html`
    <div class="card">
      <h3>AI Company P&amp;L (Last 30 Days)</h3>
      <p style="font-size:12px;color:#6b7280;margin:-4px 0 12px;">
        Costs are measured: token and integration spend actually incurred.
        Revenue is <strong>attributed</strong> — Foundry's own estimate of what
        its actions produced, weighted by the confidence that estimate carried,
        and reconciled against no invoice or payment. Every figure below that
        combines the two is a measured cost compared with an estimate.
      </p>
      <div class="metrics-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem;">
        <div class="metric-card">
          <span class="metric-value" style="color:#059669;">$${pl.attributed_revenue.total_usd.toFixed(2)}</span>
          <span class="metric-label">Attributed Revenue (estimated)</span>
        </div>
        <div class="metric-card">
          <span class="metric-value" style="color:#dc2626;">$${pl.costs.total_usd.toFixed(2)}</span>
          <span class="metric-label">Total Costs</span>
        </div>
        <div class="metric-card">
          <span class="metric-value" style="color:${pl.attributed_profit_usd >= 0 ? '#059669' : '#dc2626'};">$${pl.attributed_profit_usd.toFixed(2)}</span>
          <span class="metric-label">Attributed minus cost</span>
        </div>
        <div class="metric-card">
          <span class="metric-value" style="color:${roiColor};">${roiPct === null ? 'not measured' : roiPct + '%'}</span>
          <span class="metric-label">Attributed ROI</span>
        </div>
        <div class="metric-card">
          <span class="metric-value" style="color:${pl.attributed_revenue_covers_cost ? '#059669' : '#dc2626'};">${pl.attributed_revenue_covers_cost ? 'Yes' : 'No'}</span>
          <span class="metric-label">Attributed revenue covers cost</span>
        </div>
      </div>

      <div style="margin-bottom:1.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:600;color:#374151;">Monthly Budget: $${budget.budget_usd.toFixed(0)}</span>
          <span style="font-size:13px;color:${budgetBarColor};font-weight:600;">$${budget.spent_usd.toFixed(2)} (${budgetPct}%)</span>
        </div>
        <div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;">
          <div style="background:${budgetBarColor};height:100%;width:${budgetPct}%;transition:width 0.3s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <span style="font-size:11px;color:#9ca3af;">${budget.days_remaining_in_month} days remaining</span>
          <span style="font-size:11px;color:#9ca3af;">Projected: $${budget.projected_month_total.toFixed(2)}</span>
        </div>
      </div>

      ${agentBreakdown.length > 0 ? html`
        <h4 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:0.75rem;">Per-Agent Breakdown</h4>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #e5e7eb;color:#6b7280;">
              <th style="text-align:left;padding:4px 8px;">Agent</th>
              <th style="text-align:right;padding:4px 8px;">Cost</th>
              <th style="text-align:right;padding:4px 8px;">Attributed Revenue</th>
              <th style="text-align:right;padding:4px 8px;">Attributed ROI</th>
            </tr>
          </thead>
          <tbody>
            ${agentBreakdown.map((a) => html`
              <tr style="border-bottom:1px solid #f3f4f6;">
                <td style="padding:6px 8px;font-weight:500;">${a.agent_name}</td>
                <td style="padding:6px 8px;text-align:right;color:#dc2626;">$${a.total_cost_usd.toFixed(3)}</td>
                <td style="padding:6px 8px;text-align:right;color:#059669;">$${a.attributed_revenue_usd.toFixed(2)}</td>
                <td style="padding:6px 8px;text-align:right;color:${a.attributed_roi === null ? '#6b7280' : a.attributed_roi >= 0 ? '#059669' : '#dc2626'};">${a.attributed_roi === null ? 'not measured' : (a.attributed_roi * 100).toFixed(0) + '%'}</td>
              </tr>`)}
          </tbody>
        </table>` : html`<p style="color:#6b7280;font-size:14px;">No agent cost data yet.</p>`}
    </div>`;
}

function experimentPortfolioCard(
  summary: Awaited<ReturnType<typeof getExperimentSummary>>,
  productId: string,
) {
  return html`
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h3 style="margin:0;">Experiment Portfolio</h3>
        <a href="/products/${productId}/agents/experiments" style="font-size:13px;color:#2563eb;">View All →</a>
      </div>
      <div class="metrics-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:1rem;margin-bottom:1rem;">
        <div class="metric-card">
          <span class="metric-value">${summary.total_hypotheses}</span>
          <span class="metric-label">Hypotheses</span>
        </div>
        <div class="metric-card">
          <span class="metric-value" style="color:#d97706;">${summary.pending_approval}</span>
          <span class="metric-label">Pending Approval</span>
        </div>
        <div class="metric-card">
          <span class="metric-value" style="color:#2563eb;">${summary.running}</span>
          <span class="metric-label">Running</span>
        </div>
        <div class="metric-card">
          <span class="metric-value" style="color:#059669;">${summary.completed}</span>
          <span class="metric-label">Completed</span>
        </div>
      </div>

      ${summary.recent_win ? html`
        <div style="background:rgba(78,204,163,0.1);border:1px solid rgba(78,204,163,0.3);border-radius:6px;padding:10px 14px;">
          <strong style="color:#065f46;font-size:13px;">Recent Win:</strong>
          <span style="color:#047857;font-size:13px;margin-left:6px;">${summary.recent_win.name}</span>
          <span style="color:#6b7280;font-size:12px;margin-left:8px;">
            ${summary.recent_win.effect_size === null
              ? html`effect size not recorded — on ${summary.recent_win.metric}`
              : html`${summary.recent_win.effect_size > 0 ? '+' : ''}${(summary.recent_win.effect_size * 100).toFixed(1)}% on ${summary.recent_win.metric}`}
          </span>
        </div>` : ''}
    </div>`;
}

function competitorCards(competitors: Awaited<ReturnType<typeof getCompetitorProfiles>>) {
  if (competitors.length === 0) {
    return html`
      <div class="card">
        <h3>Competitor Intelligence</h3>
        <p class="text-muted" style="color:#6b7280;">No competitor profiles yet.</p>
      </div>`;
  }

  const threatColors: Record<string, string> = {
    high: '#dc2626',
    medium: '#d97706',
    low: '#059669',
  };

  return html`
    <div class="card">
      <h3>Competitor Intelligence</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
        ${competitors.map((c) => html`
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;border-top:3px solid ${threatColors[c.threat_level] ?? '#6b7280'};">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <strong style="font-size:15px;">${c.name}</strong>
              <span style="font-size:11px;font-weight:700;color:${threatColors[c.threat_level] ?? '#6b7280'};text-transform:uppercase;background:#f3f4f6;padding:2px 8px;border-radius:4px;">${c.threat_level} threat</span>
            </div>
            ${c.url ? html`<a href="${c.url}" target="_blank" style="font-size:12px;color:#2563eb;">${c.url}</a>` : ''}

            ${c.our_advantages.length > 0 ? html`
              <div style="margin-top:10px;">
                <div style="font-size:12px;font-weight:600;color:#059669;margin-bottom:4px;">Our Advantages</div>
                <ul style="margin:0;padding-left:1.1rem;font-size:12px;color:#374151;">
                  ${c.our_advantages.map((a) => html`<li>${a}</li>`)}
                </ul>
              </div>` : ''}

            ${c.their_advantages.length > 0 ? html`
              <div style="margin-top:8px;">
                <div style="font-size:12px;font-weight:600;color:#dc2626;margin-bottom:4px;">Their Advantages</div>
                <ul style="margin:0;padding-left:1.1rem;font-size:12px;color:#374151;">
                  ${c.their_advantages.map((a) => html`<li>${a}</li>`)}
                </ul>
              </div>` : ''}

            ${c.recommended_response ? html`
              <div style="margin-top:8px;padding:8px;background:rgba(255,179,71,0.1);border-radius:4px;font-size:12px;color:var(--text-muted);">
                <strong>Response:</strong> ${c.recommended_response}
              </div>` : ''}

            ${c.last_scanned_at ? html`
              <div style="margin-top:8px;font-size:11px;color:#9ca3af;">
                Scanned ${new Date(c.last_scanned_at).toLocaleDateString()}
              </div>` : ''}
          </div>`)}
      </div>
    </div>`;
}

// ─── Flat redirect: /agents/strategy → /products/:id/agents/strategy ─────────
// Allows nav link to use /agents/strategy without knowing product ID.

agentStrategyRoutes.get('/agents/strategy', async (c) => {
  const founder = c.get('founder');
  const ctx = await import('./_shared.js').then(m => m.getLayoutContext(founder, 'agents-strategy', 'Strategy'));
  if (!ctx.productId) return c.redirect('/dashboard');
  return c.redirect(`/products/${ctx.productId}/agents/strategy`);
});

agentStrategyRoutes.post('/agents/strategy/synthesize',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await import('./_shared.js').then(m => m.getLayoutContext(founder, 'agents-strategy', 'Strategy'));
  if (!ctx.productId) return c.redirect('/dashboard');
  return c.redirect(`/products/${ctx.productId}/agents/strategy/synthesize`, 307);
});
