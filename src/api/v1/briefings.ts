// =============================================================================
// FOUNDRY REST API v1 — Briefings
// =============================================================================

import { Hono } from 'hono';
import { query } from '../../db/client.js';
import { requireScope } from '../middleware/auth.js';
import type { ApiAuthEnv } from '../middleware/auth.js';

export const briefingsApi = new Hono<ApiAuthEnv>();

// GET /latest — most recent briefing (must come before /:briefingId)
briefingsApi.get('/latest', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');

  try {
    const result = await query(
      `SELECT id, briefing_date, headline, health_score, signal_score, risk_state,
              agent_contributions, pending_decisions, financial_summary, created_at
       FROM scp_briefings
       WHERE product_id = ?
       ORDER BY briefing_date DESC
       LIMIT 1`,
      [productId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'No briefings found' }, 404);
    }

    return c.json({ data: result.rows[0] });
  } catch (err) {
    return c.json({ error: 'Failed to fetch latest briefing' }, 500);
  }
});

// GET / — list briefings
briefingsApi.get('/', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const limit = Math.min(Number(c.req.query('limit') ?? 10), 100);
  const offset = Number(c.req.query('offset') ?? 0);

  try {
    const result = await query(
      `SELECT id, briefing_date, headline, health_score, signal_score, risk_state, created_at
       FROM scp_briefings
       WHERE product_id = ?
       ORDER BY briefing_date DESC
       LIMIT ? OFFSET ?`,
      [productId, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM scp_briefings WHERE product_id = ?`,
      [productId]
    );
    const total = (countResult.rows[0] as Record<string, unknown>)?.total as number ?? 0;

    return c.json({ data: result.rows, meta: { total, limit, offset } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch briefings' }, 500);
  }
});

// GET /:briefingId — full briefing with all agent contributions
briefingsApi.get('/:briefingId', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const briefingId = c.req.param('briefingId');

  try {
    const result = await query(
      `SELECT * FROM scp_briefings WHERE id = ? AND product_id = ?`,
      [briefingId, productId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'Briefing not found' }, 404);
    }

    return c.json({ data: result.rows[0] });
  } catch (err) {
    return c.json({ error: 'Failed to fetch briefing' }, 500);
  }
});
