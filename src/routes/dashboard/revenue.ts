// =============================================================================
// FOUNDRY — Revenue Dashboard
// MRR decomposition, health ratio, and revenue metrics for a product.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getLatestMetrics, getProductByOwner } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio, computeTotalMRR } from '../../services/intelligence/revenue.js';
import { dashboardLayout } from '../../views/layout.js';
import { mrrDecomposition, metricsGrid } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';

export const revenueRoutes = new Hono<AuthEnv>();

revenueRoutes.get('/products/:id/revenue', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');

  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  const ctx = await getLayoutContext(founder, 'revenue', 'Revenue', productId);

  const [mrr, totalMrr, metrics] = await Promise.all([
    getMRRDecomposition(productId),
    computeTotalMRR(productId),
    getLatestMetrics(productId),
  ]);

  const mrrHealth = mrr ? computeHealthRatio(mrr) : { value: 0, indicator: 'green' as const };
  const metricsRow = (metrics.rows[0] as Record<string, unknown>) ?? {};

  const content = html`
    <h2>Revenue</h2>
    ${mrr
      ? mrrDecomposition(mrr, mrrHealth.indicator)
      : html`<div class="card"><p class="text-muted">No revenue data yet. Metric snapshots will populate once ingested.</p></div>`}

    <div class="card">
      <h3>Revenue Summary</h3>
      <div class="metrics-grid">
        <div class="metric-card">
          <span class="metric-value">$${(totalMrr / 100).toFixed(2)}</span>
          <span class="metric-label">Cumulative MRR</span>
        </div>
        <div class="metric-card">
          <span class="metric-value risk-badge risk-${mrrHealth.indicator}">${mrrHealth.value.toFixed(2)}</span>
          <span class="metric-label">Health Ratio</span>
        </div>
      </div>
    </div>

    ${metricsGrid(metricsRow)}
  `;

  return c.html(dashboardLayout(ctx, content));
});
