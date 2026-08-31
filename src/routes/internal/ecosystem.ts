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

/**
 * WHO IS CALLING, AND MAY THEY REACH THIS COMPANY.
 *
 * The `/internal` surface is guarded by one process-wide `ECOSYSTEM_SERVICE_KEY`
 * compared timing-safely, and that is all it was. The key is issued to nobody,
 * so holding it was indistinguishable from being every company at once — and
 * the company id arrives as a parameter, so a holder read or wrote any company.
 *
 * The owner's §12 instruction is that portfolio access must be an explicit
 * principal with scoped company membership rather than possession of a global
 * secret. So the two routes that touch a company's data resolve the presented
 * credential to a PRINCIPAL and check that this company is in its scope.
 *
 * FAILS CLOSED, INCLUDING TODAY. Until the owner issues a principal, these two
 * routes serve nobody — which is the correct state for a surface whose key
 * distribution the owner has instructed us to treat as unknown. The same answer
 * is given for "no principal", "not scoped to this company" and "no such
 * company": telling them apart tells a caller which companies exist.
 */
async function scopedTo(
  headers: { header(name: string): string | undefined },
  productId: string,
): Promise<boolean> {
  const presented = headers.header('X-Ecosystem-Key')
    ?? headers.header('Authorization')?.replace('Bearer ', '');
  const { resolveEcosystemPrincipal, principalMayRead } = await import(
    '../../services/institution/ecosystem-principal.js');
  const principal = await resolveEcosystemPrincipal(presented);
  if (!principal) return false;
  return principalMayRead(principal.id, productId);
}

// Conversion signal from Koldly
ecosystemRoutes.post('/internal/conversion-signal', async (c) => {
  const body = await c.req.json() as { product_id: string; event_type: string; event_data: Record<string, unknown> };
  // A WRITE INTO A NAMED COMPANY'S AUDIT TRAIL. The company arrives in the
  // body, so it is exactly the shape the scope check exists for.
  if (!body.product_id || !(await scopedTo(c.req, body.product_id))) {
    return c.json({ error: 'Not found' }, 404);
  }
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

  // THE WHOLE OPERATING PICTURE OF A NAMED COMPANY. Risk state and its reason,
  // stressors, MRR by new/expansion/contraction/churn, signups, activation,
  // retention, support volume, NPS, churn, cohort summary. Possession of one
  // shared secret is not an answer to "may you see this company".
  if (!(await scopedTo(c.req, productId))) return c.json({ error: 'Not found' }, 404);

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
