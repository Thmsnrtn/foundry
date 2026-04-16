// =============================================================================
// FOUNDRY — Insights Dashboard
// Revenue forecast, churn risk, benchmarks, proactive insights.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductByOwner, query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { forecastRevenue, assessChurnRisk, generateProactiveInsights } from '../../services/intelligence/predictions.js';
import { getBenchmarks } from '../../services/intelligence/benchmarks.js';
import { generateCaseStudy, generateInvestorReport } from '../../services/story/case-study-generator.js';

export const insightRoutes = new Hono<AuthEnv>();

// ─── Forecast & Risk ────────────────────────────────────────────────────────

insightRoutes.get('/products/:id/insights', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  const product = prodResult.rows[0] as Record<string, string>;
  const ctx = await getLayoutContext(founder, 'insights', 'Insights', productId, c);

  const [forecast, churnRisk, benchmarks, insights] = await Promise.all([
    forecastRevenue(productId),
    assessChurnRisk(productId),
    getBenchmarks(productId, product.market_category),
    generateProactiveInsights(productId),
  ]);

  const content = html`
    <h1>Insights</h1>

    <!-- Proactive Insights -->
    ${insights.length > 0 ? html`
    <div class="stagger" style="margin-bottom:1.5rem;">
      ${insights.map((i) => html`
        <div class="card" style="border-left:3px solid ${i.urgency === 'high' ? 'var(--color-danger)' : i.urgency === 'medium' ? 'var(--color-warning)' : 'var(--color-primary)'};">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <strong style="font-size:var(--text-base);">${i.title}</strong>
              <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:0.25rem;">${i.body}</p>
            </div>
            ${i.action ? html`<a href="${i.action.url}" class="btn btn-secondary btn-sm" style="flex-shrink:0;margin-left:1rem;">${i.action.label}</a>` : ''}
          </div>
        </div>
      `)}
    </div>` : ''}

    <div class="dashboard-grid">
      <!-- Revenue Forecast -->
      <div class="card">
        <h3>Revenue Forecast</h3>
        ${forecast ? html`
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;margin-bottom:1rem;">
            <div style="text-align:center;padding:0.75rem;background:var(--color-bg);border-radius:var(--radius-md);">
              <div style="font-size:1.2rem;font-weight:700;">$${(forecast.projected_mrr_30d / 100).toFixed(0)}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-muted);">30-Day</div>
            </div>
            <div style="text-align:center;padding:0.75rem;background:var(--color-bg);border-radius:var(--radius-md);">
              <div style="font-size:1.2rem;font-weight:700;">$${(forecast.projected_mrr_60d / 100).toFixed(0)}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-muted);">60-Day</div>
            </div>
            <div style="text-align:center;padding:0.75rem;background:var(--color-bg);border-radius:var(--radius-md);">
              <div style="font-size:1.2rem;font-weight:700;">$${(forecast.projected_mrr_90d / 100).toFixed(0)}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-muted);">90-Day</div>
            </div>
          </div>
          <div style="font-size:var(--text-sm);color:var(--color-text-muted);">
            <p>Growth rate: ${(forecast.net_growth_rate * 100).toFixed(1)}%/mo</p>
            ${forecast.months_to_target ? html`<p>Months to $10K MRR: ~${forecast.months_to_target}</p>` : ''}
            <p style="font-size:var(--text-xs);margin-top:0.5rem;">Confidence: ${forecast.confidence} (${forecast.assumptions[0]})</p>
          </div>
        ` : html`<p style="color:var(--color-text-muted);">Need 3+ metric snapshots for forecasting. <a href="/products/${productId}/revenue">Enter metrics</a>.</p>`}
      </div>

      <!-- Churn Risk -->
      <div class="card">
        <h3>Churn Risk Assessment</h3>
        <div style="text-align:center;margin-bottom:1rem;">
          <div style="font-size:1.5rem;font-weight:800;color:${churnRisk.overall_risk === 'critical' ? 'var(--color-danger)' : churnRisk.overall_risk === 'high' ? 'var(--color-warning)' : 'var(--color-success)'};">
            ${churnRisk.overall_risk.toUpperCase()}
          </div>
          <div style="font-size:var(--text-sm);color:var(--color-text-muted);">Risk score: ${churnRisk.risk_score}/100</div>
        </div>
        ${churnRisk.signals.map((s) => html`
          <div style="display:flex;justify-content:space-between;padding:0.35rem 0;font-size:var(--text-sm);border-bottom:1px solid var(--color-border-subtle);">
            <span style="color:${s.direction === 'negative' ? 'var(--color-danger)' : s.direction === 'positive' ? 'var(--color-success)' : 'var(--color-text-muted)'};">${s.signal}</span>
          </div>
        `)}
        ${churnRisk.recommended_actions.length > 0 ? html`
          <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--color-border);">
            <strong style="font-size:var(--text-sm);">Recommended:</strong>
            <ul style="font-size:var(--text-sm);color:var(--color-text-secondary);padding-left:1.25rem;margin-top:0.25rem;">
              ${churnRisk.recommended_actions.map((a) => html`<li>${a}</li>`)}
            </ul>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Benchmarks -->
    <div class="card">
      <h3>Peer Benchmarks ${product.market_category ? html`<span style="font-size:var(--text-sm);color:var(--color-text-muted);font-weight:400;"> · ${product.market_category}</span>` : ''}</h3>
      <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:1rem;">How your metrics compare against anonymized peers on the Foundry platform.</p>
      <div style="font-size:var(--text-sm);">
        ${benchmarks.map((b) => html`
          <div style="display:grid;grid-template-columns:150px 80px 80px 1fr;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--color-border-subtle);align-items:center;">
            <span style="font-weight:500;">${b.label}</span>
            <span style="text-align:right;font-weight:600;">${b.your_value != null ? (b.metric.includes('rate') || b.metric.includes('retention') ? `${(b.your_value * 100).toFixed(0)}%` : b.your_value.toFixed(1)) : '—'}</span>
            <span style="text-align:right;color:var(--color-text-muted);">${b.peer_median != null ? (b.metric.includes('rate') || b.metric.includes('retention') ? `${(b.peer_median * 100).toFixed(0)}%` : b.peer_median.toFixed(1)) : '—'}</span>
            <div style="height:6px;background:var(--color-border);border-radius:3px;overflow:hidden;">
              ${b.percentile != null ? html`<div style="height:100%;width:${b.percentile}%;background:${b.percentile >= 60 ? 'var(--color-success)' : b.percentile >= 40 ? 'var(--color-warning)' : 'var(--color-danger)'};border-radius:3px;"></div>` : ''}
            </div>
          </div>
        `)}
        <div style="display:grid;grid-template-columns:150px 80px 80px 1fr;gap:0.75rem;padding:0.35rem 0;font-size:var(--text-xs);color:var(--color-text-faint);">
          <span></span><span style="text-align:right;">You</span><span style="text-align:right;">Peers</span><span>Percentile</span>
        </div>
      </div>
    </div>

    <!-- Reports -->
    <div class="dashboard-grid">
      <div class="card">
        <h3>Generate Case Study</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-secondary);">Auto-generate a publishable case study from your product's journey data.</p>
        <form method="POST" action="/products/${productId}/insights/case-study">
          <button type="submit" class="btn btn-secondary btn-sm" style="margin-top:0.5rem;">Generate Case Study</button>
        </form>
      </div>
      <div class="card">
        <h3>Investor Report</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-secondary);">Generate a data-backed product health report for investors.</p>
        <form method="POST" action="/products/${productId}/insights/investor-report">
          <button type="submit" class="btn btn-secondary btn-sm" style="margin-top:0.5rem;">Generate Report</button>
        </form>
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── Case Study Generation ──────────────────────────────────────────────────

insightRoutes.post('/products/:id/insights/case-study', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const product = prodResult.rows[0] as Record<string, string>;
  const result = await generateCaseStudy(productId, product.name);
  return c.redirect(`/products/${productId}/journey`);
});

// ─── Investor Report ────────────────────────────────────────────────────────

insightRoutes.post('/products/:id/insights/investor-report', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const product = prodResult.rows[0] as Record<string, string>;
  const report = await generateInvestorReport(productId, product.name);

  // Return as downloadable markdown
  c.header('Content-Type', 'text/markdown');
  c.header('Content-Disposition', `attachment; filename="${product.name}-foundry-report.md"`);
  return c.body(report);
});
