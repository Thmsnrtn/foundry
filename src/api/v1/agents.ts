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
      // `is_active` has never existed on this table; the column is `status`.
      // The route answered 500 to every caller.
      `SELECT agent_name, last_run_at, domain_health_score, status, created_at, updated_at
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

// GET /:agentName/decisions REMOVED.
//
// It read `agent_decisions`, a table with no INSERT anywhere in the codebase —
// migration 083 created it so three surfaces would stop 500-ing, with the note
// "no writer yet", and nothing ever wrote one. So this endpoint returned
// `{"data": [], "total": 0}` to every caller, for every agent, always. A
// documented API that can only ever say "this agent has decided nothing" is
// worse than no API: an integrator believes it.
//
// The company's decisions are in `decisions` and are not attributed to an
// agent, so there is no honest per-agent answer to give. Removed rather than
// repointed, because changing what the path means while keeping the path is how
// an integration breaks quietly.

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
      // `direction`, `role` and `content` do not exist. Messages are addressed
      // (`from_agent` → `to_agent`) rather than directional, and the text is in
      // `subject`/`body`. Selecting an agent's messages therefore means the
      // ones it sent or received, not a column that says which.
      `SELECT id, from_agent, to_agent, type, priority, subject, body, created_at
       FROM agent_messages
       WHERE product_id = ? AND (from_agent = ? OR to_agent = ?)
       ORDER BY created_at DESC
       LIMIT ?`,
      [productId, agentName, agentName, limit]
    );
    return c.json({ data: result.rows, meta: { agent: agentName, total: result.rows.length } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch messages' }, 500);
  }
});
