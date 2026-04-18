// =============================================================================
// FOUNDRY — Tier 2 API Routes
// Non-code track, marketplace intelligence, co-founder alignment, global support.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';
import { runWebAudit, generateVendorRecommendations, assessMigrationReadiness } from '../../services/audit/intake-web.js';
import { computeMarketplaceHealth, identifyMarketplaceStressors, auditTrustInfrastructure } from '../../services/intelligence/marketplace.js';
import { getAlignmentScore, getDecisionAttribution, checkGateAgreement } from '../../services/wisdom/cofounder.js';
import { scanGeopoliticalRisks, detectCurrencyErosion } from '../../services/intelligence/global.js';
import { nanoid } from 'nanoid';

export const tier2ApiRoutes = new Hono<AuthEnv>();

// ─── Non-Code Founder Track ─────────────────────────────────────────────────

tier2ApiRoutes.post('/api/products/:id/web-audit', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const url = body.url as string;
  if (!url) return c.json({ error: 'URL is required' }, 400);

  const result = await runWebAudit(url, productId, founder.id);
  const vendorRecs = await generateVendorRecommendations(result.findings, productId, founder.id);

  return c.json({ audit: result, vendor_recommendations: vendorRecs });
});

tier2ApiRoutes.get('/api/products/:id/vendor-recommendations', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const result = await query(
    'SELECT * FROM vendor_recommendations WHERE product_id = ? AND owner_id = ? ORDER BY created_at DESC',
    [productId, founder.id]
  );
  return c.json({ recommendations: result.rows });
});

tier2ApiRoutes.get('/api/products/:id/migration-assessment', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const assessment = await assessMigrationReadiness(productId);
  return c.json(assessment);
});

tier2ApiRoutes.post('/api/products/:id/build-platform', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const platform = body.build_platform as string;
  const validPlatforms = ['custom_code', 'bubble', 'retool', 'webflow', 'wordpress', 'shopify', 'glide', 'softr', 'agency_built', 'other'];
  if (!platform || !validPlatforms.includes(platform)) {
    return c.json({ error: 'Invalid build platform' }, 400);
  }

  await query(
    `UPDATE products SET build_platform = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`,
    [platform, productId, founder.id]
  );
  return c.json({ status: 'updated', build_platform: platform });
});

// ─── Marketplace Intelligence ───────────────────────────────────────────────

tier2ApiRoutes.post('/api/products/:id/marketplace-metrics', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const today = new Date().toISOString().split('T')[0];
  const sdRatio = ((body.supply_count as number) ?? 0) > 0
    ? ((body.supply_count as number) ?? 0) / Math.max(1, (body.demand_count as number) ?? 1)
    : null;

  await query(
    `INSERT INTO marketplace_metrics (id, product_id, owner_id, snapshot_date, supply_count, demand_count, match_rate, time_to_match_hours, supply_demand_ratio, liquidity_score, disintermediation_risk, supply_churn_rate, demand_churn_rate, take_rate, gmv, net_revenue, avg_transaction_value, geographic_concentration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), productId, founder.id, today,
      body.supply_count ?? null, body.demand_count ?? null,
      body.match_rate ?? null, body.time_to_match_hours ?? null,
      sdRatio, body.liquidity_score ?? null,
      body.disintermediation_risk ?? null,
      body.supply_churn_rate ?? null, body.demand_churn_rate ?? null,
      body.take_rate ?? null, body.gmv ?? null, body.net_revenue ?? null,
      body.avg_transaction_value ?? null, body.geographic_concentration ?? null,
    ]
  );

  return c.json({ status: 'recorded' });
});

tier2ApiRoutes.get('/api/products/:id/marketplace-health', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const health = await computeMarketplaceHealth(productId);
  const stressors = await identifyMarketplaceStressors(productId);
  return c.json({ health, stressors });
});

tier2ApiRoutes.post('/api/products/:id/marketplace-trust-audit', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const result = await auditTrustInfrastructure(productId, founder.id, {
    has_ratings: body.has_ratings === true,
    has_identity_verification: body.has_identity_verification === true,
    has_dispute_resolution: body.has_dispute_resolution === true,
    has_payment_escrow: body.has_payment_escrow === true,
    has_quality_standards: body.has_quality_standards === true,
    has_insurance_guarantee: body.has_insurance_guarantee === true,
  });
  return c.json(result);
});

// ─── Co-Founder Alignment ───────────────────────────────────────────────────

tier2ApiRoutes.get('/api/products/:id/alignment-score', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const score = await getAlignmentScore(productId);
  const attribution = await getDecisionAttribution(productId);
  return c.json({ alignment: score, attribution });
});

tier2ApiRoutes.post('/api/products/:id/cofounder-dna', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const responses = body.responses as Record<string, string> | undefined;
  if (!responses) return c.json({ error: 'responses object is required' }, 400);

  for (const [field, response] of Object.entries(responses)) {
    await query(
      `INSERT INTO cofounder_dna_responses (id, product_id, founder_id, dna_field, response)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (product_id, founder_id, dna_field) DO UPDATE SET response = excluded.response, responded_at = datetime('now')`,
      [nanoid(), productId, founder.id, field, response]
    );
  }

  return c.json({ status: 'recorded', fields: Object.keys(responses).length });
});

tier2ApiRoutes.put('/api/products/:id/gate-agreements', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const agreements = body.agreements as Array<{
    decision_category: string;
    gate_level: number;
    requires_unanimous: boolean;
  }> | undefined;
  if (!agreements) return c.json({ error: 'agreements array is required' }, 400);

  for (const agreement of agreements) {
    await query(
      `INSERT INTO cofounder_gate_agreements (id, product_id, decision_category, gate_level, requires_unanimous)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (product_id, decision_category) DO UPDATE SET gate_level = excluded.gate_level, requires_unanimous = excluded.requires_unanimous`,
      [nanoid(), productId, agreement.decision_category, agreement.gate_level, agreement.requires_unanimous ? 1 : 0]
    );
  }

  return c.json({ status: 'updated', count: agreements.length });
});

// ─── Global Founder Support ─────────────────────────────────────────────────

tier2ApiRoutes.get('/api/geopolitical-signals/:productId', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('productId');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const result = await query(
    "SELECT * FROM geopolitical_signals WHERE product_id = ? AND status = 'active' ORDER BY detected_at DESC",
    [productId]
  );
  return c.json({ signals: result.rows });
});

tier2ApiRoutes.get('/api/currency-health', async (c) => {
  const founder = c.get('founder');
  const erosion = await detectCurrencyErosion(founder.id);
  return c.json({ currency_health: erosion });
});

tier2ApiRoutes.put('/api/settings/global', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;

  const sets: string[] = [];
  const args: unknown[] = [];

  if (body.country_code !== undefined) { sets.push('country_code = ?'); args.push(body.country_code); }
  if (body.local_currency !== undefined) { sets.push('local_currency = ?'); args.push(body.local_currency); }
  if (body.ppp_factor !== undefined) { sets.push('ppp_factor = ?'); args.push(body.ppp_factor); }

  if (sets.length > 0) {
    args.push(founder.id);
    await query(`UPDATE founders SET ${sets.join(', ')} WHERE id = ?`, args);
  }

  return c.json({ status: 'updated' });
});
