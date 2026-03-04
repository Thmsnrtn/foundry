// =============================================================================
// FOUNDRY — Metric Ingest Webhook
// Public route: POST /ingest/:token
// Any tool (Stripe, Zapier, cron) posts metric fields here.
// Foundry maps them to metric_snapshots, recomputes Signal automatically.
// =============================================================================

import { Hono } from 'hono';
import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { invalidateSignalCache } from '../../services/signal.js';

export const ingestRoutes = new Hono();

// ─── Field → Column Mapping ───────────────────────────────────────────────────

// Dollar values (mrr, new_mrr, churned_mrr) are accepted as dollars and
// stored as cents. Rate values (0.0–1.0) stored as-is.
const DOLLAR_FIELDS = new Set(['mrr', 'new_mrr', 'expansion_mrr', 'contraction_mrr', 'churned_mrr']);

const FIELD_MAP: Record<string, string> = {
  // MRR (dollars → cents)
  mrr:               'new_mrr_cents',
  new_mrr:           'new_mrr_cents',
  expansion_mrr:     'expansion_mrr_cents',
  contraction_mrr:   'contraction_mrr_cents',
  churned_mrr:       'churned_mrr_cents',
  // Rates (0.0–1.0)
  activation_rate:   'activation_rate',
  day_30_retention:  'day_30_retention',
  churn_rate:        'churn_rate',
  mrr_health_ratio:  'mrr_health_ratio',
  // Counts
  signups:           'signups_7d',
  signups_7d:        'signups_7d',
  active_users:      'active_users',
  support_volume:    'support_volume_7d',
  support_volume_7d: 'support_volume_7d',
  // NPS
  nps:               'nps_score',
  nps_score:         'nps_score',
};

// ─── POST /ingest/:token ──────────────────────────────────────────────────────

ingestRoutes.post('/ingest/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || !/^[\w-]{8,64}$/.test(token)) {
    return c.json({ error: 'Invalid token' }, 400);
  }

  // Look up the product
  const productResult = await query(
    `SELECT id FROM products WHERE ingest_token = ?`,
    [token],
  );
  if (productResult.rows.length === 0) {
    return c.json({ error: 'Unknown ingest token' }, 401);
  }
  const productId = (productResult.rows[0] as Record<string, string>).id;

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Build column update pairs
  const columns: string[] = [];
  const values: unknown[] = [];
  const customMetrics: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (key === 'custom' && typeof value === 'object' && value !== null) {
      // custom metrics → stored as JSON
      Object.assign(customMetrics, value);
      continue;
    }

    const col = FIELD_MAP[key];
    if (col) {
      // Dollar → cents conversion for MRR fields
      const numVal = typeof value === 'number' ? value : parseFloat(String(value));
      if (!isNaN(numVal)) {
        columns.push(col);
        values.push(DOLLAR_FIELDS.has(key) ? Math.round(numVal * 100) : numVal);
      }
    } else {
      // Unknown fields go into custom_metrics
      customMetrics[key] = value;
    }
  }

  if (Object.keys(customMetrics).length > 0) {
    columns.push('custom_metrics');
    values.push(JSON.stringify(customMetrics));
  }

  if (columns.length === 0) {
    return c.json({ error: 'No recognized metric fields in body', accepted_fields: Object.keys(FIELD_MAP) }, 400);
  }

  // Compute MRR health ratio if both new and churned are being set
  const newMrrIdx = columns.indexOf('new_mrr_cents');
  const churnedIdx = columns.indexOf('churned_mrr_cents');
  if (newMrrIdx !== -1 && churnedIdx !== -1) {
    const newMrr = values[newMrrIdx] as number;
    const churned = values[churnedIdx] as number;
    if (newMrr > 0) {
      columns.push('mrr_health_ratio');
      values.push(parseFloat((churned / newMrr).toFixed(4)));
    }
  }

  // UPSERT today's metric snapshot
  const today = new Date().toISOString().slice(0, 10);
  const setClause = columns.map((col) => `${col} = ?`).join(', ');

  try {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${columns.join(', ')})
       VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})
       ON CONFLICT(product_id, snapshot_date) DO UPDATE SET ${setClause}`,
      [nanoid(), productId, today, ...values, ...values],
    );

    // Invalidate Signal cache so next read recomputes fresh
    invalidateSignalCache(productId);

    return c.json({
      status: 'accepted',
      updated_fields: columns,
      snapshot_date: today,
    });
  } catch (err) {
    console.error('[ingest] DB error:', err);
    return c.json({ error: 'Failed to store metrics' }, 500);
  }
});
