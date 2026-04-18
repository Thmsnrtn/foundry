// =============================================================================
// FOUNDRY — Tier 1 API Routes
// Sector profiles, growth stages, founder health, lifestyle mode.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';
import { isValidSector, getSectorProfile, getScoringOverrides } from '../../services/audit/sector-profiles.js';
import { detectGrowthStage, getStageConfig } from '../../services/lifecycle/stage-detection.js';
import { getFounderHealthSummary, updateFounderHealth } from '../../services/intelligence/founder-health.js';

export const tier1ApiRoutes = new Hono<AuthEnv>();

// ─── Sector Profile ─────────────────────────────────────────────────────────

tier1ApiRoutes.post('/api/products/:id/sector', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const sector = body.sector_profile as string;
  if (!sector || !isValidSector(sector)) {
    return c.json({ error: 'Invalid sector profile' }, 400);
  }

  await query(
    `UPDATE products SET sector_profile = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`,
    [sector, productId, founder.id]
  );
  return c.json({ status: 'updated', sector_profile: sector });
});

tier1ApiRoutes.get('/api/products/:id/sector', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const sector = await getSectorProfile(productId);
  const overrides = await getScoringOverrides(sector);
  return c.json({ sector_profile: sector, scoring_overrides: overrides });
});

// ─── Growth Stage ───────────────────────────────────────────────────────────

tier1ApiRoutes.get('/api/products/:id/growth-stage', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const product = prodResult.rows[0] as Record<string, unknown>;
  const stage = (product.growth_stage as string) ?? 'pre_launch';
  const config = getStageConfig(stage as any);
  const detected = await detectGrowthStage(productId);

  return c.json({
    current_stage: stage,
    detected_stage: detected,
    overridden: (product.growth_stage_overridden as number) === 1,
    config,
  });
});

tier1ApiRoutes.post('/api/products/:id/growth-stage', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const validStages = ['pre_launch', 'early_traction', 'growth', 'scale', 'mature'];
  const stage = body.growth_stage as string;

  if (stage && validStages.includes(stage)) {
    // Manual override
    await query(
      `UPDATE products SET growth_stage = ?, growth_stage_overridden = 1, growth_stage_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_id = ?`,
      [stage, productId, founder.id]
    );
    return c.json({ status: 'overridden', growth_stage: stage });
  }

  // Reset to auto-detect
  if (body.auto_detect === true) {
    const detected = await detectGrowthStage(productId);
    await query(
      `UPDATE products SET growth_stage = ?, growth_stage_overridden = 0, growth_stage_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_id = ?`,
      [detected, productId, founder.id]
    );
    return c.json({ status: 'auto_detected', growth_stage: detected });
  }

  return c.json({ error: 'Provide growth_stage or set auto_detect: true' }, 400);
});

// ─── Founder Health ─────────────────────────────────────────────────────────

tier1ApiRoutes.get('/api/founder-health', async (c) => {
  const founder = c.get('founder');
  const health = await getFounderHealthSummary(founder.id);
  if (!health) return c.json({ health: null });
  return c.json({ health });
});

tier1ApiRoutes.put('/api/founder-health', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;

  await updateFounderHealth(founder.id, {
    personal_runway_months: body.personal_runway_months as number | undefined,
    weekly_hours_available: body.weekly_hours_available as number | undefined,
    immigration_status: body.immigration_status as string | undefined,
    visa_expiry_date: body.visa_expiry_date as string | undefined,
    key_persons: body.key_persons as any | undefined,
  });

  const health = await getFounderHealthSummary(founder.id);
  return c.json({ status: 'updated', health });
});

// ─── Lifestyle Mode ─────────────────────────────────────────────────────────

tier1ApiRoutes.put('/api/settings/lifestyle-mode', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as Record<string, unknown>;
  const enabled = body.enabled === true ? 1 : 0;
  const targetMrr = body.target_mrr as number | undefined;

  await query(
    'UPDATE founders SET lifestyle_mode = ?, lifestyle_target_mrr = ? WHERE id = ?',
    [enabled, targetMrr ?? null, founder.id]
  );

  return c.json({
    status: 'updated',
    lifestyle_mode: enabled === 1,
    lifestyle_target_mrr: targetMrr ?? null,
  });
});

tier1ApiRoutes.get('/api/settings/lifestyle-mode', async (c) => {
  const founder = c.get('founder');
  const result = await query('SELECT lifestyle_mode, lifestyle_target_mrr FROM founders WHERE id = ?', [founder.id]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return c.json({
    lifestyle_mode: ((row?.lifestyle_mode as number) ?? 0) === 1,
    lifestyle_target_mrr: (row?.lifestyle_target_mrr as number) ?? null,
  });
});
