import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getScenarioModels } from '../../db/client.js';
import { getDecisionQueue, resolveDecision, recordOutcome } from '../../services/decisions/queue.js';
import { dashboardLayout } from '../../views/layout.js';
import { decisionList, decisionDetail, type DecisionData } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
import { resolveDecisionSchema, recordOutcomeSchema, validate } from '../../lib/validation.js';
import { parseRequestBody, respondWithRedirectOrJson } from '../../lib/request.js';
import { log } from '../../lib/logger.js';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { RiskStateValue } from '../../types/index.js';

export const decisionRoutes = new Hono<AuthEnv>();

decisionRoutes.get('/decisions', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'decisions', 'Decisions', undefined, c);
  if (!ctx.productId) {
    const content = html`<h1>Decisions</h1>${decisionList([])}`;
    return c.html(dashboardLayout(ctx, content));
  }
  const productId = ctx.productId;
  const ls = await query('SELECT risk_state FROM lifecycle_state WHERE product_id = ?', [productId]);
  const riskState = ((ls.rows[0] as Record<string, string>)?.risk_state as RiskStateValue) ?? 'green';
  const decisions = await getDecisionQueue(productId, riskState);

  const content = html`
    <h1>Decisions</h1>
    ${decisionList(decisions as unknown as DecisionData[])}
  `;
  return c.html(dashboardLayout(ctx, content));
});

decisionRoutes.get('/decisions/:id', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const ctx = await getLayoutContext(founder, 'decisions', 'Decision Detail', undefined, c);
  const result = await query(
    `SELECT d.* FROM decisions d JOIN products p ON d.product_id = p.id WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const scenarios = await getScenarioModels(decisionId);

  const content = decisionDetail(
    result.rows[0] as Record<string, unknown>,
    scenarios.rows as Array<Record<string, unknown>>,
  );
  return c.html(dashboardLayout(ctx, content));
});

decisionRoutes.post('/decisions/:id/resolve', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const rawBody = await parseRequestBody(c);
  const body = validate(resolveDecisionSchema, rawBody);
  const result = await query(
    `SELECT d.product_id, d.gate FROM decisions d JOIN products p ON d.product_id = p.id WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const row = result.rows[0] as Record<string, unknown>;
  const productId = row.product_id as string;
  const gate = row.gate as number | null;

  // Gate 3 decisions require resolution_reasoning for pattern synthesis
  if (gate === 3 && !body.resolution_reasoning) {
    return c.json({ error: 'Gate 3 decisions require resolution_reasoning' }, 400);
  }

  await resolveDecision(decisionId, productId, body.chosen_option, 'founder');

  // UX Intelligence: check milestones after resolve
  checkAndAwardMilestones(productId, founder.id).catch((err) => {
    log.error('Failed to check milestones after decision resolve', err, { productId, founderId: founder.id });
  });

  // Store resolution reasoning and wisdom context flag
  if (body.resolution_reasoning) {
    await query(
      `UPDATE decisions SET resolution_reasoning = ?, wisdom_context_used = ? WHERE id = ?`,
      [body.resolution_reasoning, gate === 3 ? 1 : 0, decisionId]
    );
  }

  return respondWithRedirectOrJson(c, `/decisions/${decisionId}`, { status: 'resolved' });
});

decisionRoutes.post('/decisions/:id/outcome', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const rawBody = await parseRequestBody(c);
  const body = validate(recordOutcomeSchema, rawBody);
  const result = await query(
    `SELECT d.product_id FROM decisions d JOIN products p ON d.product_id = p.id WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const productId = (result.rows[0] as Record<string, string>).product_id;
  await recordOutcome(decisionId, productId, body.outcome);
  return respondWithRedirectOrJson(c, `/decisions/${decisionId}`, { status: 'recorded' });
});

// ─── Manual Decision Creation ───────────────────────────────────────────────

const createDecisionSchema = z.object({
  product_id: z.string().min(1),
  category: z.enum(['urgent', 'strategic', 'product', 'marketing', 'informational']),
  what: z.string().min(1).max(500),
  why_now: z.string().min(1).max(2000),
  options: z.array(z.object({
    label: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    trade_offs: z.string().max(1000).optional(),
  })).min(2).max(6).optional(),
  deadline: z.string().optional(),
});

decisionRoutes.post('/decisions/create', async (c) => {
  const founder = c.get('founder');
  const body = validate(createDecisionSchema, await c.req.json());

  const prodCheck = await query('SELECT id FROM products WHERE id = ? AND owner_id = ?', [body.product_id, founder.id]);
  if (prodCheck.rows.length === 0) return c.json({ error: 'Product not found' }, 404);

  const decisionId = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, options, deadline, status, decided_by)
     VALUES (?, ?, ?, 3, ?, ?, ?, ?, 'pending', 'founder')`,
    [
      decisionId, body.product_id, body.category,
      body.what, body.why_now,
      body.options ? JSON.stringify(body.options) : null,
      body.deadline ?? null,
    ]
  );

  return c.json({ decision_id: decisionId, status: 'created' }, 201);
});
