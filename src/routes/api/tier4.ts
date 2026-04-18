// =============================================================================
// FOUNDRY — Tier 4 API Routes
// Psychology engine, expansion advisor, wisdom network, ethical assessment.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';
import { generatePsychologyInsights, dismissInsight } from '../../services/intelligence/psychology.js';
import { estimateTAMCeiling, projectTAMSaturation, identifyExpansionOpportunities, modelDepthVsBreadth, generateExpansionBrief } from '../../services/intelligence/expansion.js';
import { getRelevantInsights } from '../../services/wisdom/network.js';
import { assessEthicalDimensions, getLatestEthicsAssessment, getEthicsRemediationPlan } from '../../services/audit/ethics.js';

export const tier4ApiRoutes = new Hono<AuthEnv>();

// ─── Founder Psychology ─────────────────────────────────────────────────────

tier4ApiRoutes.get('/api/psychology-insights', async (c) => {
  const founder = c.get('founder');
  const result = await query(
    `SELECT * FROM founder_psychology_insights
     WHERE founder_id = ? AND status = 'active'
     ORDER BY surfaced_at DESC LIMIT 5`,
    [founder.id]
  );
  return c.json({ insights: result.rows });
});

tier4ApiRoutes.post('/api/psychology-insights/generate', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  const productId = body.product_id as string;
  if (!productId) return c.json({ error: 'product_id required' }, 400);

  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const insight = await generatePsychologyInsights(founder.id, productId);
  return c.json({ insight });
});

tier4ApiRoutes.post('/api/psychology-insights/:id/dismiss', async (c) => {
  const founder = c.get('founder');
  const insightId = c.req.param('id');
  await dismissInsight(insightId, founder.id);
  return c.json({ status: 'dismissed' });
});

// ─── Market Expansion ───────────────────────────────────────────────────────

tier4ApiRoutes.get('/api/products/:id/expansion', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const tam = await estimateTAMCeiling(productId);
  const saturation = await projectTAMSaturation(productId);
  const opportunities = await identifyExpansionOpportunities(productId);
  const dvb = await modelDepthVsBreadth(productId);

  return c.json({
    tam_estimate: tam,
    saturation_projection: saturation,
    expansion_opportunities: opportunities,
    depth_vs_breadth: dvb,
  });
});

tier4ApiRoutes.get('/api/products/:id/expansion-brief', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const brief = await generateExpansionBrief(productId, founder.id);
  return c.json({ brief });
});

// ─── Wisdom Network ─────────────────────────────────────────────────────────

tier4ApiRoutes.get('/api/products/:id/network-insights', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const insights = await getRelevantInsights(productId);
  return c.json({ insights });
});

tier4ApiRoutes.put('/api/settings/wisdom-network', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  const optIn = body.opted_in === true;

  await query(
    'UPDATE founders SET wisdom_network_opted_in = ?, wisdom_network_consent_date = ? WHERE id = ?',
    [optIn ? 1 : 0, optIn ? new Date().toISOString() : null, founder.id]
  );

  return c.json({ status: 'updated', opted_in: optIn });
});

// ─── Ethical Assessment ─────────────────────────────────────────────────────

tier4ApiRoutes.get('/api/products/:id/ethics', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const assessment = await getLatestEthicsAssessment(productId);
  return c.json({ assessment });
});

tier4ApiRoutes.post('/api/products/:id/ethics/assess', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const assessment = await assessEthicalDimensions(productId);
  return c.json({ assessment });
});

tier4ApiRoutes.post('/api/products/:id/ethics/remediate', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const finding = body.finding as { dimension: string; severity: string; finding: string; remediation: string };
  if (!finding) return c.json({ error: 'finding object required' }, 400);

  const plan = await getEthicsRemediationPlan(productId, finding as any);
  return c.json(plan);
});
