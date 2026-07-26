// =============================================================================
// FOUNDRY — Revenue Dashboard
// MRR decomposition, health ratio, metric entry, and revenue metrics.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getLatestMetrics, getProductByOwner } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio, computeTotalMRR } from '../../services/intelligence/revenue.js';
import { dashboardLayout } from '../../views/layout.js';
import { mrrDecomposition, metricsGrid } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { reportMetricsSchema, validate } from '../../lib/validation.js';
import { nanoid } from 'nanoid';

export const revenueRoutes = new Hono<AuthEnv>();

revenueRoutes.get('/products/:id/revenue', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');

  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  const ctx = await getLayoutContext(founder, 'revenue', 'Revenue', productId, c);
  const saved = c.req.query('saved') === '1';

  const [mrr, totalMrr, metrics] = await Promise.all([
    getMRRDecomposition(productId),
    computeTotalMRR(productId),
    getLatestMetrics(productId),
  ]);

  const mrrHealth = mrr ? computeHealthRatio(mrr) : { value: 0, indicator: 'green' as const };
  const metricsRow = (metrics.rows[0] as Record<string, unknown>) ?? {};
  const hasMetrics = metrics.rows.length > 0 && (metricsRow.signups_7d != null || metricsRow.new_mrr_cents != null);

  const content = html`
    <h1>Revenue</h1>
    ${saved ? html`<div style="padding:0.75rem 1rem;background:#d1fae5;color:#065f46;border-radius:6px;margin-bottom:1rem;font-size:0.9rem;">Metrics recorded successfully. Dashboard will reflect changes within minutes.</div>` : ''}

    ${hasMetrics
      ? html`
        ${mrr ? mrrDecomposition(mrr, mrrHealth.indicator) : ''}
        <div class="card">
          <h3>Revenue Summary</h3>
          <div class="metrics-grid">
            <div class="metric-card">
              <span class="metric-value">$${(totalMrr / 100).toFixed(0)}</span>
              <span class="metric-label">Total MRR</span>
            </div>
            <div class="metric-card">
              <span class="metric-value" style="color:${mrrHealth.indicator === 'red' ? '#dc2626' : mrrHealth.indicator === 'yellow' ? '#d97706' : '#059669'}">${mrrHealth.value > 0 ? mrrHealth.value.toFixed(2) : '—'}</span>
              <span class="metric-label">Health Ratio</span>
            </div>
          </div>
        </div>
        ${metricsGrid(metricsRow)}`
      : ''}

    <div class="card">
      <h3>${hasMetrics ? 'Update Metrics' : 'Enter Your Metrics'}</h3>
      ${!hasMetrics ? html`
        <p style="color:#6b7280;margin-bottom:1rem;">
          Foundry's intelligence layer needs revenue and product metrics to identify stressors, track cohort health,
          and generate your weekly digest. Enter them manually below, or integrate via API.
        </p>` : ''}
      <form method="POST" action="/products/${productId}/revenue/record">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label for="new_mrr_cents">New MRR (cents)</label>
            <input type="number" name="new_mrr_cents" id="new_mrr_cents" value="${metricsRow.new_mrr_cents ?? ''}" placeholder="e.g. 9900 = $99" min="0" />
          </div>
          <div class="form-group">
            <label for="churned_mrr_cents">Churned MRR (cents)</label>
            <input type="number" name="churned_mrr_cents" id="churned_mrr_cents" value="${metricsRow.churned_mrr_cents ?? ''}" placeholder="e.g. 2900" min="0" />
          </div>
          <div class="form-group">
            <label for="expansion_mrr_cents">Expansion MRR (cents)</label>
            <input type="number" name="expansion_mrr_cents" id="expansion_mrr_cents" value="${metricsRow.expansion_mrr_cents ?? ''}" placeholder="0" min="0" />
          </div>
          <div class="form-group">
            <label for="contraction_mrr_cents">Contraction MRR (cents)</label>
            <input type="number" name="contraction_mrr_cents" id="contraction_mrr_cents" value="${metricsRow.contraction_mrr_cents ?? ''}" placeholder="0" min="0" />
          </div>
          <div class="form-group">
            <label for="signups_7d">Signups (last 7 days)</label>
            <input type="number" name="signups_7d" id="signups_7d" value="${metricsRow.signups_7d ?? ''}" placeholder="0" min="0" />
          </div>
          <div class="form-group">
            <label for="active_users">Active Users</label>
            <input type="number" name="active_users" id="active_users" value="${metricsRow.active_users ?? ''}" placeholder="0" min="0" />
          </div>
          <div class="form-group">
            <label for="activation_rate">Activation Rate (0-1)</label>
            <input type="number" name="activation_rate" id="activation_rate" value="${metricsRow.activation_rate ?? ''}" placeholder="e.g. 0.65" min="0" max="1" step="0.01" />
          </div>
          <div class="form-group">
            <label for="day_30_retention">Day 30 Retention (0-1)</label>
            <input type="number" name="day_30_retention" id="day_30_retention" value="${metricsRow.day_30_retention ?? ''}" placeholder="e.g. 0.45" min="0" max="1" step="0.01" />
          </div>
          <div class="form-group">
            <label for="churn_rate">Churn Rate (0-1)</label>
            <input type="number" name="churn_rate" id="churn_rate" value="${metricsRow.churn_rate ?? ''}" placeholder="e.g. 0.05" min="0" max="1" step="0.01" />
          </div>
          <div class="form-group">
            <label for="nps_score">NPS Score</label>
            <input type="number" name="nps_score" id="nps_score" value="${metricsRow.nps_score ?? ''}" placeholder="-100 to 100" min="-100" max="100" />
          </div>
        </div>
        <div style="display:flex;gap:1rem;align-items:center;margin-top:1rem;">
          <button type="submit" class="btn btn-primary">Record Metrics</button>
          <span style="font-size:0.8rem;color:#9ca3af;">Updated daily. Next stressor analysis runs Friday.</span>
        </div>
      </form>
    </div>

    <div class="card" style="background:#f8fafc;">
      <h3>Integrate via API</h3>
      <p style="font-size:0.87rem;color:#6b7280;margin-bottom:0.75rem;">Automate metric ingestion by POSTing to your product's metrics endpoint daily.</p>
      <code style="display:block;padding:0.75rem;background:#1a1a2e;color:#e8eaf0;border-radius:6px;font-size:0.8rem;overflow-x:auto;">
curl -X POST ${process.env.APP_URL ?? 'https://foundry.dev'}/api/v1/products/${productId}/metrics \\
  -H "Authorization: Bearer fnd_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"new_mrr_cents": 9900, "churned_mrr_cents": 0, "signups_7d": 12, "active_users": 320}'
      </code>
      <p style="font-size:0.8rem;color:#9ca3af;margin-top:0.5rem;">Create an API key via <code>POST /api/v1/settings/api-keys</code> (authenticated) — a Settings UI for keys is coming.</p>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// Manual metric entry from form
revenueRoutes.post('/products/:id/revenue/record', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  const raw = await c.req.parseBody() as Record<string, string>;

  // Convert form strings to numbers, treating empty as undefined
  const toNum = (v: string | undefined) => v && v.trim() !== '' ? Number(v) : undefined;

  const body = validate(reportMetricsSchema, {
    new_mrr_cents: toNum(raw.new_mrr_cents),
    churned_mrr_cents: toNum(raw.churned_mrr_cents),
    expansion_mrr_cents: toNum(raw.expansion_mrr_cents),
    contraction_mrr_cents: toNum(raw.contraction_mrr_cents),
    signups_7d: toNum(raw.signups_7d),
    active_users: toNum(raw.active_users),
    activation_rate: toNum(raw.activation_rate),
    day_30_retention: toNum(raw.day_30_retention),
    churn_rate: toNum(raw.churn_rate),
    nps_score: toNum(raw.nps_score),
  });

  const today = new Date().toISOString().split('T')[0];
  const newMrr = body.new_mrr_cents ?? 0;
  const churned = body.churned_mrr_cents ?? 0;
  const healthRatio = newMrr > 0 ? churned / newMrr : null;

  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d, active_users, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents, activation_rate, day_30_retention, support_volume_7d, nps_score, churn_rate, mrr_health_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (product_id, snapshot_date) DO UPDATE SET
       signups_7d = excluded.signups_7d, active_users = excluded.active_users, new_mrr_cents = excluded.new_mrr_cents,
       expansion_mrr_cents = excluded.expansion_mrr_cents, contraction_mrr_cents = excluded.contraction_mrr_cents,
       churned_mrr_cents = excluded.churned_mrr_cents, activation_rate = excluded.activation_rate,
       day_30_retention = excluded.day_30_retention, nps_score = excluded.nps_score,
       churn_rate = excluded.churn_rate, mrr_health_ratio = excluded.mrr_health_ratio`,
    [nanoid(), productId, today, body.signups_7d ?? null, body.active_users ?? null,
     newMrr, body.expansion_mrr_cents ?? 0, body.contraction_mrr_cents ?? 0, churned,
     body.activation_rate ?? null, body.day_30_retention ?? null, null,
     body.nps_score ?? null, body.churn_rate ?? null, healthRatio]
  );

  return c.redirect(`/products/${productId}/revenue?saved=1`);
});
