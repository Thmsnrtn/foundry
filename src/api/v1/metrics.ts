// =============================================================================
// FOUNDRY REST API v1 — Metrics
// =============================================================================

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { requireScope } from '../middleware/auth.js';
import type { ApiAuthEnv } from '../middleware/auth.js';

export const metricsApi = new Hono<ApiAuthEnv>();

// GET /snapshots — recent metric snapshots
metricsApi.get('/snapshots', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const limit = Math.min(Number(c.req.query('limit') ?? 30), 365);
  const offset = Number(c.req.query('offset') ?? 0);

  try {
    const result = await query(
      `SELECT id, snapshot_date, mrr_cents, active_users, churn_rate,
              new_customers, churned_customers, expansion_mrr_cents, contraction_mrr_cents,
              created_at
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT ? OFFSET ?`,
      [productId, limit, offset]
    );

    return c.json({ data: result.rows, meta: { total: result.rows.length, limit, offset } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch metric snapshots' }, 500);
  }
});

// POST /snapshots — create new snapshot
metricsApi.post('/snapshots', requireScope('metrics:write'), async (c) => {
  const productId = c.get('productId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    snapshot_date,
    mrr_cents,
    active_users,
    churn_rate,
    new_customers,
    churned_customers,
    expansion_mrr_cents,
    contraction_mrr_cents,
  } = body;

  if (!snapshot_date) {
    return c.json({ error: 'snapshot_date is required' }, 400);
  }

  try {
    const id = nanoid();
    await query(
      `INSERT INTO metric_snapshots
         (id, product_id, snapshot_date, mrr_cents, active_users, churn_rate,
          new_customers, churned_customers, expansion_mrr_cents, contraction_mrr_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (product_id, snapshot_date)
       DO UPDATE SET
         mrr_cents = COALESCE(excluded.mrr_cents, mrr_cents),
         active_users = COALESCE(excluded.active_users, active_users),
         churn_rate = COALESCE(excluded.churn_rate, churn_rate),
         new_customers = COALESCE(excluded.new_customers, new_customers),
         churned_customers = COALESCE(excluded.churned_customers, churned_customers),
         expansion_mrr_cents = COALESCE(excluded.expansion_mrr_cents, expansion_mrr_cents),
         contraction_mrr_cents = COALESCE(excluded.contraction_mrr_cents, contraction_mrr_cents),
         updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        productId,
        snapshot_date,
        mrr_cents ?? null,
        active_users ?? null,
        churn_rate ?? null,
        new_customers ?? null,
        churned_customers ?? null,
        expansion_mrr_cents ?? null,
        contraction_mrr_cents ?? null,
      ]
    );

    const result = await query(
      `SELECT * FROM metric_snapshots WHERE product_id = ? AND snapshot_date = ?`,
      [productId, snapshot_date]
    );
    return c.json({ data: result.rows[0] }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create metric snapshot' }, 500);
  }
});

// GET /health — how fresh this company's reported numbers are.
//
// This said "current data quality score and alerts" and returned neither. No
// score was computed, and `active_alerts` could only ever be empty: the
// validator that writes alerts had no caller, and the rules it would check
// against had no way to be created. Four dead layers under one live promise
// to API consumers. Retired in migration 167; what is left is what this
// endpoint can actually observe.
metricsApi.get('/health', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');

  try {
    // Latest metric snapshot for freshness
    const snapshotResult = await query(
      `SELECT snapshot_date, mrr_cents, active_users, churn_rate FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC LIMIT 1`,
      [productId]
    );

    const latestSnapshot = snapshotResult.rows[0] ?? null;

    return c.json({
      data: {
        latest_snapshot: latestSnapshot,
        // `snapshot_date` is the whole answer to "is this current?", which is
        // the only data-quality question this endpoint has ever been able to
        // answer.
        is_stale: latestSnapshot == null,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch health data' }, 500);
  }
});
