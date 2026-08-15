// =============================================================================
// FOUNDRY REST API v1 — Webhooks
// =============================================================================

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { requireScope } from '../middleware/auth.js';
import type { ApiAuthEnv } from '../middleware/auth.js';
import { assertUrlSafe } from '../../services/outbound/ssrf.js';
import { encrypt } from '../../services/encryption.js';

export const webhooksApi = new Hono<ApiAuthEnv>();

// GET / — list webhooks for this product (hide secret)
webhooksApi.get('/', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');

  try {
    const result = await query(
      `SELECT id, url, events, active, created_at, last_delivery_at
       FROM webhooks
       WHERE product_id = ?
       ORDER BY created_at DESC`,
      [productId]
    );

    return c.json({ data: result.rows, meta: { total: result.rows.length } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch webhooks' }, 500);
  }
});

// POST / — create webhook
webhooksApi.post('/', requireScope('agents:write'), async (c) => {
  const productId = c.get('productId');
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { url, events } = body;
  if (!url || typeof url !== 'string') {
    return c.json({ error: 'url is required' }, 400);
  }
  if (!Array.isArray(events) || events.length === 0) {
    return c.json({ error: 'events array is required and must not be empty' }, 400);
  }

  try {
    await assertUrlSafe(url);
    const id = nanoid();
    const secret = 'whsec_' + nanoid(32);

    await query(
      `INSERT INTO webhooks (id, founder_id, product_id, url, events, secret, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, userId, productId, url, JSON.stringify(events), encrypt(secret), userId]
    );

    // Return the secret once (only at creation time)
    const result = await query(`SELECT * FROM webhooks WHERE id = ?`, [id]);
    const row = result.rows[0] as Record<string, unknown>;

    return c.json({
      data: {
        ...row,
        secret, // expose once at creation
      },
    }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create webhook' }, 500);
  }
});

// DELETE /:webhookId — delete webhook
webhooksApi.delete('/:webhookId', requireScope('agents:write'), async (c) => {
  const productId = c.get('productId');
  const webhookId = c.req.param('webhookId');

  try {
    const check = await query(
      `SELECT id FROM webhooks WHERE id = ? AND product_id = ?`,
      [webhookId, productId]
    );
    if (check.rows.length === 0) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    await query(`DELETE FROM webhooks WHERE id = ? AND product_id = ?`, [webhookId, productId]);

    return c.json({ data: { deleted: true, id: webhookId } });
  } catch (err) {
    return c.json({ error: 'Failed to delete webhook' }, 500);
  }
});

// GET /:webhookId/deliveries — recent delivery attempts
webhooksApi.get('/:webhookId/deliveries', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const webhookId = c.req.param('webhookId');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

  try {
    // Verify the webhook belongs to this product
    const check = await query(
      `SELECT id FROM webhooks WHERE id = ? AND product_id = ?`,
      [webhookId, productId]
    );
    if (check.rows.length === 0) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    const result = await query(
      `SELECT id, event AS event_type, status_code, effect_certainty,
              provider_acknowledged_at, reconcile_after, delivered_at, error
       FROM webhook_deliveries
       WHERE webhook_id = ?
       ORDER BY delivered_at DESC
       LIMIT ?`,
      [webhookId, limit]
    );

    return c.json({ data: result.rows, meta: { total: result.rows.length } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch webhook deliveries' }, 500);
  }
});
