import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductsByOwner, getActiveStressors, getLatestMetrics } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../../services/intelligence/revenue.js';
import { getLatestCohortSummary } from '../../services/intelligence/cohort.js';
import { dashboardLayout } from '../../views/layout.js';
import { digestView } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import type { RiskStateValue } from '../../types/index.js';

export const digestRoutes = new Hono<AuthEnv>();

/**
 * Assemble digest data from DB for a given product.
 * Does NOT call Claude — returns structured data from stored state.
 */
async function assembleDigestData(productId: string) {
  // Risk state
  const lsResult = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  const riskState = (ls?.risk_state as RiskStateValue) ?? 'green';

  // Stressors
  const stressorResult = await getActiveStressors(productId);
  const stressors = (stressorResult.rows as unknown as Array<Record<string, unknown>>).map((s) => ({
    name: s.stressor_name as string,
    signal: s.signal as string,
    timeframe_days: s.timeframe_days as number,
    neutralizing_action: s.neutralizing_action as string,
    severity: s.severity as string,
  }));

  // MRR decomposition
  const mrr = await getMRRDecomposition(productId);
  const mrrHealth = mrr ? computeHealthRatio(mrr) : { value: 0, indicator: 'green' as const };

  // Latest metrics
  const metricsResult = await getLatestMetrics(productId);
  const metricsRow = metricsResult.rows[0] as Record<string, unknown> | undefined;

  // Cohort snapshot
  const cohort = await getLatestCohortSummary(productId);

  // Competitive context (recent medium/high signals)
  const compResult = await query(
    `SELECT * FROM competitive_signals WHERE product_id = ? AND significance IN ('medium', 'high') AND detected_at > datetime('now', '-7 days') ORDER BY detected_at DESC`,
    [productId]
  );

  return {
    risk_state: {
      state: riskState,
      reason: (ls?.risk_state_reason as string) ?? 'No risk signals detected.',
      changed_at: (ls?.risk_state_changed_at as string) ?? null,
    },
    stressors,
    competitive_context: compResult.rows,
    mrr: mrr ?? { new_cents: 0, expansion_cents: 0, contraction_cents: 0, churned_cents: 0, total_cents: 0, health_ratio: null },
    mrr_health: mrrHealth,
    metrics: metricsRow ?? null,
    cohort_snapshot: cohort,
    generated_at: new Date().toISOString(),
  };
}

digestRoutes.get('/digest', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'digest', 'Digest', undefined, c);
  const products = await getProductsByOwner(founder.id);
  if (products.rows.length === 0) {
    const content = html`<h1>Weekly Digest</h1>${digestView([])}`;
    return c.html(dashboardLayout(ctx, content));
  }

  const digests = await Promise.all(
    (products.rows as unknown as Array<{ id: string; name: string }>).map(async (p) => {
      const data = await assembleDigestData(p.id);
      return {
        product_id: p.id,
        product_name: p.name,
        ...data,
      };
    })
  );

  const content = html`
    <h1>Weekly Digest</h1>
    ${digestView(digests as any)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

digestRoutes.get('/digest/current', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'digest', 'Current Digest', undefined, c);
  const products = await getProductsByOwner(founder.id);
  if (products.rows.length === 0) return c.json({ error: 'No products found' }, 404);

  const product = products.rows[0] as unknown as { id: string; name: string };
  const data = await assembleDigestData(product.id);
  const content = html`
    <h1>Current Digest — ${product.name}</h1>
    ${digestView([{ product_id: product.id, product_name: product.name, ...data }] as any)}
  `;
  return c.html(dashboardLayout(ctx, content));
});
