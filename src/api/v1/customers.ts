// =============================================================================
// FOUNDRY REST API v1 — Customers
// =============================================================================

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { requireScope } from '../middleware/auth.js';
import type { ApiAuthEnv } from '../middleware/auth.js';

export const customersApi = new Hono<ApiAuthEnv>();

// GET / — list customers with health scores, stage, MRR
customersApi.get('/', requireScope('customers:read'), async (c) => {
  const productId = c.get('productId');
  const stage = c.req.query('stage');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);
  const offset = Number(c.req.query('offset') ?? 0);

  try {
    const conditions: string[] = ['ci.product_id = ?'];
    const args: unknown[] = [productId];

    if (stage) {
      conditions.push('ci.lifecycle_stage = ?');
      args.push(stage);
    }

    const where = conditions.join(' AND ');
    const result = await query(
      `SELECT ci.id, ci.external_customer_id, ci.name, ci.email, ci.company,
              ci.lifecycle_stage, ci.mrr_cents, ci.health_score,
              ci.created_at, ci.updated_at
       FROM customer_intelligence ci
       WHERE ${where}
       ORDER BY ci.created_at DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM customer_intelligence ci WHERE ${where}`,
      args
    );
    const total = (countResult.rows[0] as Record<string, unknown>)?.total as number ?? 0;

    return c.json({ data: result.rows, meta: { total, limit, offset } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch customers' }, 500);
  }
});

// GET /:customerId — full customer profile
customersApi.get('/:customerId', requireScope('customers:read'), async (c) => {
  const productId = c.get('productId');
  const customerId = c.req.param('customerId');

  try {
    const result = await query(
      `SELECT * FROM customer_intelligence WHERE id = ? AND product_id = ?`,
      [customerId, productId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    const customer = result.rows[0] as Record<string, unknown>;

    // Fetch recent notes
    const notesResult = await query(
      `SELECT id, note, created_at FROM customer_notes
       WHERE customer_id = ? AND product_id = ?
       ORDER BY created_at DESC LIMIT 20`,
      [customerId, productId]
    );

    return c.json({
      data: {
        ...customer,
        recent_notes: notesResult.rows,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch customer' }, 500);
  }
});

// POST / — create/upsert customer via external_customer_id
customersApi.post('/', requireScope('customers:manage'), async (c) => {
  const productId = c.get('productId');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    external_customer_id,
    name,
    email,
    company,
    lifecycle_stage,
    mrr_cents,
    health_score,
  } = body as Record<string, unknown>;

  if (!external_customer_id) {
    return c.json({ error: 'external_customer_id is required' }, 400);
  }

  try {
    const id = nanoid();
    await query(
      `INSERT INTO customer_intelligence
         (id, product_id, external_customer_id, name, email, company, lifecycle_stage, mrr_cents, health_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (product_id, external_customer_id)
       DO UPDATE SET
         name = COALESCE(excluded.name, name),
         email = COALESCE(excluded.email, email),
         company = COALESCE(excluded.company, company),
         lifecycle_stage = COALESCE(excluded.lifecycle_stage, lifecycle_stage),
         mrr_cents = COALESCE(excluded.mrr_cents, mrr_cents),
         health_score = COALESCE(excluded.health_score, health_score),
         updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        productId,
        external_customer_id,
        name ?? null,
        email ?? null,
        company ?? null,
        lifecycle_stage ?? null,
        mrr_cents ?? null,
        health_score ?? null,
      ]
    );

    const result = await query(
      `SELECT * FROM customer_intelligence WHERE product_id = ? AND external_customer_id = ?`,
      [productId, external_customer_id]
    );

    return c.json({ data: result.rows[0] }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create/upsert customer' }, 500);
  }
});

// PUT /:customerId/health — update health scores
customersApi.put('/:customerId/health', requireScope('customers:manage'), async (c) => {
  const productId = c.get('productId');
  const customerId = c.req.param('customerId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { health_score } = body;
  if (health_score === undefined || health_score === null) {
    return c.json({ error: 'health_score is required' }, 400);
  }

  try {
    const check = await query(
      `SELECT id FROM customer_intelligence WHERE id = ? AND product_id = ?`,
      [customerId, productId]
    );
    if (check.rows.length === 0) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    await query(
      `UPDATE customer_intelligence SET health_score = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND product_id = ?`,
      [health_score, customerId, productId]
    );

    const result = await query(
      `SELECT id, external_customer_id, name, health_score, updated_at
       FROM customer_intelligence WHERE id = ? AND product_id = ?`,
      [customerId, productId]
    );

    return c.json({ data: result.rows[0] });
  } catch (err) {
    return c.json({ error: 'Failed to update health score' }, 500);
  }
});

// GET /:customerId/timeline — customer lifecycle events
customersApi.get('/:customerId/timeline', requireScope('customers:read'), async (c) => {
  const productId = c.get('productId');
  const customerId = c.req.param('customerId');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

  try {
    const check = await query(
      `SELECT id FROM customer_intelligence WHERE id = ? AND product_id = ?`,
      [customerId, productId]
    );
    if (check.rows.length === 0) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    const result = await query(
      `SELECT id, event_type, event_data_json, created_at
       FROM customer_timeline_events
       WHERE customer_id = ? AND product_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [customerId, productId, limit]
    );

    return c.json({ data: result.rows, meta: { total: result.rows.length } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch timeline' }, 500);
  }
});
