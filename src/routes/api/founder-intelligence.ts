// =============================================================================
// FOUNDRY — Founder Intelligence API Routes
// All endpoints require the owner principal — `isFounder`, which reads the
// deployment's configured owner rather than a literal in this file.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import {
  isFounder, getPulse, getMRRIntelligence, getChurnIntelligence,
  getAutomationHealth, getCustomerHealthOverview, getForecast,
  generateMorningBriefing, generateDailyDigest, getWellbeing,
  getActivityTimeline, getGrowthSignals, getAICostData,
} from '../../services/founder/intelligence.js';

export const founderIntelRoutes = new Hono<AuthEnv>();

// Guard: all routes require founder email
// SCOPED TO THIS ROUTER'S OWN PATHS, NOT '*'. Mounted at '/', a `use('*')` here
// applied this staff-only check to every path in the application — the same
// defect that made the REST API and the transcript webhooks answer every
// request with a refusal.
founderIntelRoutes.use('/api/founder/*', async (c, next) => {
  const founder = c.get('founder');
  if (!isFounder(founder.email)) return c.json({ error: 'Forbidden' }, 403);
  await next();
});

// ─── Core Intelligence ──────────────────────────────────────────────────────

founderIntelRoutes.get('/api/founder/intelligence/pulse', async (c) => {
  const pulse = await getPulse();
  return c.json(pulse);
});

founderIntelRoutes.get('/api/founder/intelligence/mrr', async (c) => {
  const mrr = await getMRRIntelligence();
  return c.json(mrr);
});

founderIntelRoutes.get('/api/founder/intelligence/churn', async (c) => {
  const churn = await getChurnIntelligence();
  return c.json(churn);
});

founderIntelRoutes.get('/api/founder/intelligence/automation', async (c) => {
  const health = await getAutomationHealth();
  return c.json(health);
});

founderIntelRoutes.get('/api/founder/intelligence/growth', async (c) => {
  const growth = await getGrowthSignals();
  return c.json(growth);
});

founderIntelRoutes.get('/api/founder/intelligence/ai-cost', async (c) => {
  const cost = await getAICostData();
  return c.json(cost);
});

founderIntelRoutes.get('/api/founder/intelligence/customer-health', async (c) => {
  const health = await getCustomerHealthOverview();
  return c.json(health);
});

founderIntelRoutes.get('/api/founder/intelligence/forecast', async (c) => {
  const forecast = await getForecast();
  return c.json(forecast);
});

// ─── Briefing & Digest ──────────────────────────────────────────────────────

founderIntelRoutes.get('/api/founder/intelligence/morning-briefing', async (c) => {
  try {
    const briefing = await generateMorningBriefing();
    return c.json({ briefing });
  } catch (err) {
    // AI-composed; degrade to a clean 503 on provider failure, never a 500.
    return c.json({ error: 'Briefing generation unavailable right now — try again shortly.', detail: String((err as Error)?.message ?? err).slice(0, 200) }, 503);
  }
});

founderIntelRoutes.post('/api/founder/intelligence/digest/generate', async (c) => {
  const digest = await generateDailyDigest();
  return c.json(digest);
});

// ─── Wellbeing ──────────────────────────────────────────────────────────────

founderIntelRoutes.get('/api/founder/intelligence/wellbeing', async (c) => {
  const founder = c.get('founder');
  const wellbeing = await getWellbeing(founder.id);
  return c.json(wellbeing);
});

// ─── Activity ───────────────────────────────────────────────────────────────

founderIntelRoutes.get('/api/founder/intelligence/activity-timeline', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '50');
  const timeline = await getActivityTimeline(limit);
  return c.json({ timeline });
});

// ─── Decisions Inbox ────────────────────────────────────────────────────────

founderIntelRoutes.get('/api/founder/intelligence/decisions-inbox', async (c) => {
  const decisions = await query(
    `SELECT d.*, p.name as product_name FROM decisions d
     JOIN products p ON d.product_id = p.id
     WHERE d.status = 'pending'
     ORDER BY CASE d.category WHEN 'urgent' THEN 1 WHEN 'strategic' THEN 2 WHEN 'product' THEN 3 WHEN 'marketing' THEN 4 ELSE 5 END, d.created_at ASC`,
    []
  );
  return c.json({ decisions: decisions.rows, count: decisions.rows.length });
});

// THE OPERATOR APPROVED A COMPANY'S DECISION AND THE LEDGER SAID THE FOUNDER
// DID. Two routes were here — approve and reject — each updating a decision's
// status and setting decided_by to 'founder', keyed on the id alone, with no
// scope of any kind. (The statement is described rather than quoted: the
// SQL-prepares-against-schema gate reads literal SQL out of this file and
// cannot tell a statement in a comment from one in the code. It caught this
// comment on the first full run, which is the gate working.)
// This surface is gated on `isFounder`, which is Foundry's
// OWNER, not the company's founder. So the operator could resolve any company's
// decision, and `decisions.decided_by` recorded it as the act of the person
// whose company it was.
//
// `decided_by` admits 'founder' or 'second_self' and nothing else — there is no
// value for the operator, because the operator resolving a company's decisions
// is not a thing the boundary doctrine describes. Adding one would be adding an
// authority, quietly, which is the one thing the constitutional invariant names.
//
// Removed rather than relabelled. The operator boundary is "administers the
// COMPANIES and bills them"; resolving what a company decides is not
// administering it. If it is ever wanted it comes back as a whole capability,
// with a vocabulary that says who acted and an owner decision behind it.

// ─── Stressor Overview ──────────────────────────────────────────────────────

founderIntelRoutes.get('/api/founder/intelligence/stressors', async (c) => {
  const active = await query(
    `SELECT sh.*, p.name as product_name FROM stressor_history sh
     JOIN products p ON sh.product_id = p.id
     WHERE sh.status = 'active'
     ORDER BY CASE sh.severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END`,
    []
  );
  return c.json({ stressors: active.rows });
});

// ─── Predictions Overview ───────────────────────────────────────────────────

founderIntelRoutes.get('/api/founder/intelligence/predictions', async (c) => {
  const predictions = await query(
    `SELECT pr.*, p.name as product_name FROM predictions pr
     JOIN products p ON pr.product_id = p.id
     WHERE pr.status = 'active'
     ORDER BY pr.probability DESC`,
    []
  );
  return c.json({ predictions: predictions.rows });
});

// ─── Aggregate Executive Dashboard ──────────────────────────────────────────

founderIntelRoutes.get('/api/founder/executive-dashboard', async (c) => {
  const [pulse, mrr, churn, automation, growth, wellbeing, customerHealth, aiCost] = await Promise.all([
    getPulse(),
    getMRRIntelligence(),
    getChurnIntelligence(),
    getAutomationHealth(),
    getGrowthSignals(),
    getWellbeing(c.get('founder').id),
    getCustomerHealthOverview(),
    getAICostData(),
  ]);

  return c.json({
    pulse, mrr, churn, automation, growth, wellbeing, customer_health: customerHealth, ai_cost: aiCost,
  });
});

// ─── Products Overview ──────────────────────────────────────────────────────

founderIntelRoutes.get('/api/founder/intelligence/products', async (c) => {
  const products = await query(
    `SELECT p.id, p.name, p.sector_profile, p.growth_stage, p.status, p.created_at,
            ls.risk_state, ls.current_prompt,
            (SELECT COUNT(*) FROM stressor_history sh WHERE sh.product_id = p.id AND sh.status = 'active') as active_stressors,
            (SELECT COUNT(*) FROM decisions d WHERE d.product_id = p.id AND d.status = 'pending') as pending_decisions
     FROM products p
     LEFT JOIN lifecycle_state ls ON p.id = ls.product_id
     WHERE p.status = 'active'
     ORDER BY p.created_at DESC`, []
  );
  return c.json({ products: products.rows });
});
