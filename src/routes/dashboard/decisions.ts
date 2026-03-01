import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getScenarioModels } from '../../db/client.js';
import { getDecisionQueue, resolveDecision, recordOutcome } from '../../services/decisions/queue.js';
import { dashboardLayout } from '../../views/layout.js';
import { decisionList, decisionDetail, type DecisionData } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
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
  const body = await c.req.json() as { chosen_option: string; resolution_reasoning?: string };
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
  checkAndAwardMilestones(productId, founder.id).catch(() => {});

  // Store resolution reasoning and wisdom context flag
  if (body.resolution_reasoning) {
    await query(
      `UPDATE decisions SET resolution_reasoning = ?, wisdom_context_used = ? WHERE id = ?`,
      [body.resolution_reasoning, gate === 3 ? 1 : 0, decisionId]
    );
  }

  return c.json({ status: 'resolved' });
});

decisionRoutes.post('/decisions/:id/outcome', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const body = await c.req.json() as { outcome: string };
  const result = await query(
    `SELECT d.product_id FROM decisions d JOIN products p ON d.product_id = p.id WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const productId = (result.rows[0] as Record<string, string>).product_id;
  await recordOutcome(decisionId, productId, body.outcome);
  return c.json({ status: 'recorded' });
});
