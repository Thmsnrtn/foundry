// =============================================================================
// FOUNDRY — Internal Ecosystem Routes
// =============================================================================

import { Hono } from 'hono';
import { query, getActiveStressors, getLatestMetrics, getPendingDecisions } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../../services/intelligence/revenue.js';
import { getLatestCohortSummary } from '../../services/intelligence/cohort.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue } from '../../types/index.js';

export const ecosystemRoutes = new Hono();

// ICP config for Koldly
ecosystemRoutes.get('/internal/icp', (c) => {
  return c.json({
    target_role: 'Technical founder / solo developer',
    target_industry: 'SaaS',
    company_size: '1-10',
    pain_points: ['No operational layer', 'Building features but not the business', 'No systematic launch methodology'],
    qualifying_signals: ['Active GitHub repo', 'Pre-launch or early stage SaaS', 'Using AI-assisted development'],
  });
});

// Conversion signal from Koldly
ecosystemRoutes.post('/internal/conversion-signal', async (c) => {
  const body = await c.req.json() as { product_id: string; event_type: string; event_data: Record<string, unknown> };
  await query(
    `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning) VALUES (?, ?, ?, 0, 'ecosystem', ?)`,
    [nanoid(), body.product_id, `conversion_signal_${body.event_type}`, JSON.stringify(body.event_data)]
  );
  return c.json({ received: true });
});

// Campaign handoff from Koldly
ecosystemRoutes.post('/internal/campaign/receive', async (c) => {
  const body = await c.req.json() as { campaign_id: string; lead_data: Record<string, unknown> };
  return c.json({ received: true, campaign_id: body.campaign_id });
});

// Full operator dashboard data (used by Apex Micro, other ecosystem products)
ecosystemRoutes.get('/internal/operator/dashboard-data', async (c) => {
  const productId = c.req.query('product_id');
  if (!productId) return c.json({ error: 'product_id required' }, 400);

  const product = await query('SELECT * FROM products WHERE id = ?', [productId]);
  if (product.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const p = product.rows[0] as Record<string, unknown>;

  const ls = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
  const lsRow = ls.rows[0] as Record<string, unknown> | undefined;
  const riskState = (lsRow?.risk_state as RiskStateValue) ?? 'green';

  const [stressors, metrics, decisions] = await Promise.all([
    getActiveStressors(productId), getLatestMetrics(productId), getPendingDecisions(productId),
  ]);
  const mrr = await getMRRDecomposition(productId);
  const mrrHealth = mrr ? computeHealthRatio(mrr) : { value: 0, indicator: 'green' as const };
  const cohort = await getLatestCohortSummary(productId);
  const m = metrics.rows[0] as Record<string, unknown> | undefined;

  return c.json({
    app: p.name, timestamp: new Date().toISOString(),
    risk_state: { state: riskState, reason: lsRow?.risk_state_reason ?? '', changed_at: lsRow?.risk_state_changed_at ?? null },
    stressors: stressors.rows, health: { status: 'ok', services: {} },
    mrr: mrr ?? { new_cents: 0, expansion_cents: 0, contraction_cents: 0, churned_cents: 0, total_cents: 0, health_ratio: null },
    metrics: {
      signups_7d: (m?.signups_7d as number) ?? 0, active_users: (m?.active_users as number) ?? 0,
      activation_rate: (m?.activation_rate as number) ?? 0, day_30_retention: (m?.day_30_retention as number) ?? 0,
      support_volume_7d: (m?.support_volume_7d as number) ?? 0, nps_score: (m?.nps_score as number) ?? 0,
      churn_rate: (m?.churn_rate as number) ?? 0, mrr_health_ratio: mrrHealth.value,
    },
    cohort_latest: cohort, competitive_signals_recent: 0,
    alerts: [], decisions_pending: decisions.rows.length,
    lifecycle_prompt_status: lsRow ? { current: lsRow.current_prompt as string } : {},
  });
});
