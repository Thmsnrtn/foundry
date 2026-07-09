// =============================================================================
// FOUNDRY REST API v1 — Agents
// =============================================================================

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { requireScope } from '../middleware/auth.js';
import type { ApiAuthEnv } from '../middleware/auth.js';

export const agentsApi = new Hono<ApiAuthEnv>();

// GET / — list all agents
agentsApi.get('/', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  try {
    const result = await query(
      `SELECT agent_name, last_run_at, domain_health_score, is_active, created_at, updated_at
       FROM agent_instances
       WHERE product_id = ?
       ORDER BY agent_name ASC`,
      [productId]
    );
    return c.json({ data: result.rows, meta: { total: result.rows.length } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch agents' }, 500);
  }
});

// GET /:agentName/briefings — last 10 briefings for this agent
agentsApi.get('/:agentName/briefings', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const agentName = c.req.param('agentName');
  try {
    const result = await query(
      `SELECT id, briefing_date, headline, health_score, signal_score, risk_state, created_at
       FROM scp_briefings
       WHERE product_id = ?
       ORDER BY briefing_date DESC
       LIMIT 10`,
      [productId]
    );
    return c.json({ data: result.rows, meta: { agent: agentName, total: result.rows.length } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch briefings' }, 500);
  }
});

// GET /:agentName/decisions — pending/recent decisions
agentsApi.get('/:agentName/decisions', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const agentName = c.req.param('agentName');
  try {
    const result = await query(
      `SELECT id, title, description, status, category, expected_impact, estimated_impact_usd, created_at, updated_at
       FROM agent_decisions
       WHERE product_id = ? AND agent_name = ?
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 50`,
      [productId, agentName]
    );
    return c.json({ data: result.rows, meta: { agent: agentName, total: result.rows.length } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch decisions' }, 500);
  }
});

// POST /:agentName/run — queue an agent run
agentsApi.post('/:agentName/run', requireScope('agents:run'), async (c) => {
  const productId = c.get('productId');
  const agentName = c.req.param('agentName');
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json().catch(() => ({}));
  } catch {
    // no body is fine
  }
  try {
    const id = nanoid();
    await query(
      `INSERT INTO agent_initiative_queue (id, product_id, agent_name, initiative_type, description, context, priority, status)
       VALUES (?,?,?,'api_trigger',?,?,1,'pending')`,
      [id, productId, agentName, `API-triggered run for ${agentName}`, JSON.stringify(body)]
    );
    return c.json({ queued: true, message: 'Agent run queued', id }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to queue agent run' }, 500);
  }
});

// GET /:agentName/messages — recent agent messages
agentsApi.get('/:agentName/messages', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const agentName = c.req.param('agentName');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  try {
    const result = await query(
      `SELECT id, direction, role, content, created_at
       FROM agent_messages
       WHERE product_id = ? AND agent_name = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [productId, agentName, limit]
    );
    return c.json({ data: result.rows, meta: { agent: agentName, total: result.rows.length } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch messages' }, 500);
  }
});
