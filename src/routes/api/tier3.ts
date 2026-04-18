// =============================================================================
// FOUNDRY — Tier 3 API Routes
// Business model, regulatory, competitive v2, value delivery.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';
import { computeUnitEconomics, generateBusinessModelInsights, identifyBusinessModelStressors, detectServicesDisguise } from '../../services/intelligence/business-model.js';
import { classifyRegulatoryExposure, assessComplianceDebt, scanRegulatoryChanges, modelCompliancePathway, identifyRegulatoryStressors } from '../../services/intelligence/regulatory.js';
import { modelIncumbentResponse, assessPlatformDependency, assessTechnologyMoat, analyzeSwitchingCosts, generateCompetitiveStrategyBrief } from '../../services/intelligence/competitive-v2.js';
import { computeValueDeliveryIndex, assessTimeToFirstValue, detectValueDecline, correlateValueToRetention, identifyValueDeliveryStressors, reportValueDeliveryMetrics } from '../../services/intelligence/value-delivery.js';
import { nanoid } from 'nanoid';

export const tier3ApiRoutes = new Hono<AuthEnv>();

// ─── Business Model Intelligence ────────────────────────────────────────────

tier3ApiRoutes.get('/api/products/:id/unit-economics', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const economics = await computeUnitEconomics(productId);
  const services = await detectServicesDisguise(productId);
  return c.json({ unit_economics: economics, services_check: services });
});

tier3ApiRoutes.get('/api/products/:id/business-model-insights', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const insights = await generateBusinessModelInsights(productId);
  const stressors = await identifyBusinessModelStressors(productId);
  return c.json({ insights, stressors });
});

tier3ApiRoutes.put('/api/products/:id/business-model', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;

  await query(
    `INSERT INTO business_model_profile (id, product_id, owner_id, revenue_model, avg_cogs_per_customer, avg_cac, is_seasonal, seasonal_peak_months, seasonal_baseline_factor, services_revenue_percentage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (product_id) DO UPDATE SET
       revenue_model = excluded.revenue_model, avg_cogs_per_customer = excluded.avg_cogs_per_customer,
       avg_cac = excluded.avg_cac, is_seasonal = excluded.is_seasonal,
       seasonal_peak_months = excluded.seasonal_peak_months, seasonal_baseline_factor = excluded.seasonal_baseline_factor,
       services_revenue_percentage = excluded.services_revenue_percentage, updated_at = datetime('now')`,
    [
      nanoid(), productId, founder.id,
      body.revenue_model ?? 'subscription',
      body.avg_cogs_per_customer ?? null,
      body.avg_cac ?? null,
      body.is_seasonal ? 1 : 0,
      body.seasonal_peak_months ? JSON.stringify(body.seasonal_peak_months) : null,
      body.seasonal_baseline_factor ?? null,
      body.services_revenue_percentage ?? null,
    ]
  );

  return c.json({ status: 'updated' });
});

// ─── Regulatory Intelligence ────────────────────────────────────────────────

tier3ApiRoutes.get('/api/products/:id/regulatory-exposure', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const exposure = await classifyRegulatoryExposure(productId);
  const debt = await assessComplianceDebt(productId);
  const stressors = await identifyRegulatoryStressors(productId);
  return c.json({ exposure, compliance_debt_score: debt, stressors });
});

tier3ApiRoutes.post('/api/products/:id/regulatory-scan', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const changes = await scanRegulatoryChanges(productId, founder.id);
  return c.json({ changes });
});

tier3ApiRoutes.post('/api/products/:id/compliance-pathway', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const requirement = body.requirement as string;
  if (!requirement) return c.json({ error: 'requirement is required' }, 400);

  const pathway = await modelCompliancePathway(productId, requirement);
  return c.json(pathway);
});

// ─── Competitive Intelligence 2.0 ──────────────────────────────────────────

tier3ApiRoutes.get('/api/products/:id/competitive-strategy', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const brief = await generateCompetitiveStrategyBrief(productId);
  return c.json({ strategy_brief: brief });
});

tier3ApiRoutes.get('/api/products/:id/platform-dependency', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const dependency = await assessPlatformDependency(productId);
  const moat = await assessTechnologyMoat(productId);
  return c.json({ platform_dependency: dependency, technology_moat: moat });
});

tier3ApiRoutes.post('/api/products/:id/incumbent-response/:competitorId', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const competitorId = c.req.param('competitorId');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const response = await modelIncumbentResponse(productId, competitorId);
  return c.json(response);
});

tier3ApiRoutes.get('/api/products/:id/switching-costs', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const costs = await analyzeSwitchingCosts(productId, founder.id);
  return c.json(costs);
});

// ─── Value Delivery Index ───────────────────────────────────────────────────

tier3ApiRoutes.get('/api/products/:id/value-delivery', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const vdi = await computeValueDeliveryIndex(productId);
  const ttfv = await assessTimeToFirstValue(productId);
  const decline = await detectValueDecline(productId);
  const correlation = await correlateValueToRetention(productId);
  const stressors = await identifyValueDeliveryStressors(productId);

  return c.json({
    value_delivery_index: vdi,
    time_to_first_value: ttfv,
    trend: decline,
    retention_correlation: correlation,
    stressors,
  });
});

tier3ApiRoutes.post('/api/products/:id/value-delivery', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  await reportValueDeliveryMetrics(productId, founder.id, {
    core_workflow_completion_rate: body.core_workflow_completion_rate as number | undefined,
    feature_utilization_breadth: body.feature_utilization_breadth as number | undefined,
    time_to_first_value_hours: body.time_to_first_value_hours as number | undefined,
    engagement_depth_score: body.engagement_depth_score as number | undefined,
    support_ticket_rate: body.support_ticket_rate as number | undefined,
  });

  return c.json({ status: 'recorded' });
});
