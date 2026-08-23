// =============================================================================
// FOUNDRY REST API v1 — Agents
// =============================================================================

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { logger } from '../../services/logger.js';
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

// GET /:agentName/briefings — this agent's contribution to the last 10
// briefings it took part in.
//
// THE QUERY HAD NO AGENT PREDICATE AT ALL. It selected the company-wide
// `scp_briefings` rows — one per day, shared by every agent — and stamped
// `meta.agent` with whatever was in the path. Every agent name returned the
// same ten rows, and so did every name that is not an agent: `/nobody/briefings`
// answered with the company's briefings and a label saying they were nobody's.
//
// The per-agent fact exists: `agent_contributions` is JSON keyed by agent name.
// So the endpoint now returns what this agent contributed, from the briefings
// where it contributed something, and 404s for a name this product has no agent
// for — rather than answering for a name it has never heard of.
agentsApi.get('/:agentName/briefings', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const agentName = c.req.param('agentName');
  try {
    const known = await query(
      'SELECT 1 AS present FROM agent_instances WHERE product_id = ? AND agent_name = ?',
      [productId, agentName]
    );
    if (known.rows.length === 0) {
      return c.json({ error: `No agent named '${agentName}' for this product` }, 404);
    }

    // Filtered in SQL, so the ten rows returned are the ten most recent
    // briefings THIS AGENT contributed to — not the ten most recent briefings,
    // some of which may not mention it.
    const result = await query(
      `SELECT id, briefing_date, headline, created_at,
              json_extract(agent_contributions, '$."' || ? || '"') AS contribution
       FROM scp_briefings
       WHERE product_id = ?
         AND json_extract(agent_contributions, '$."' || ? || '"') IS NOT NULL
       ORDER BY briefing_date DESC
       LIMIT 10`,
      [agentName, productId, agentName]
    );
    return c.json({ data: result.rows, meta: { agent: agentName, total: result.rows.length } });
  } catch (err) {
    logger.error(`v1 agent briefings failed: ${err instanceof Error ? err.message : String(err)}`,
      { productId });
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
