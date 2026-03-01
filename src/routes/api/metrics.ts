import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getLatestMetrics, getActiveStressors } from '../../db/client.js';
import { nanoid } from 'nanoid';

export const apiMetricRoutes = new Hono<AuthEnv>();

apiMetricRoutes.get('/api/products/:id/metrics', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const latest = await getLatestMetrics(productId);
  return c.json({ latest: latest.rows[0] ?? null });
});

apiMetricRoutes.post('/api/products/:id/metrics', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Record<string, unknown>;
  const today = new Date().toISOString().split('T')[0];
  const newMrr = (body.new_mrr_cents as number) ?? 0;
  const churned = (body.churned_mrr_cents as number) ?? 0;
  const healthRatio = newMrr > 0 ? churned / newMrr : null;

  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d, active_users, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents, activation_rate, day_30_retention, support_volume_7d, nps_score, churn_rate, mrr_health_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (product_id, snapshot_date) DO UPDATE SET
       signups_7d = excluded.signups_7d, active_users = excluded.active_users, new_mrr_cents = excluded.new_mrr_cents,
       expansion_mrr_cents = excluded.expansion_mrr_cents, contraction_mrr_cents = excluded.contraction_mrr_cents,
       churned_mrr_cents = excluded.churned_mrr_cents, activation_rate = excluded.activation_rate,
       day_30_retention = excluded.day_30_retention, support_volume_7d = excluded.support_volume_7d,
       nps_score = excluded.nps_score, churn_rate = excluded.churn_rate, mrr_health_ratio = excluded.mrr_health_ratio`,
    [nanoid(), productId, today, body.signups_7d ?? null, body.active_users ?? null,
     newMrr, body.expansion_mrr_cents ?? 0, body.contraction_mrr_cents ?? 0, churned,
     body.activation_rate ?? null, body.day_30_retention ?? null, body.support_volume_7d ?? null,
     body.nps_score ?? null, body.churn_rate ?? null, healthRatio]
  );
  return c.json({ status: 'recorded' });
});

apiMetricRoutes.get('/api/products/:id/stressors', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const active = await getActiveStressors(productId);
  const resolved = await query(
    `SELECT * FROM stressor_history WHERE product_id = ? AND status = 'resolved' ORDER BY resolved_at DESC LIMIT 20`, [productId]);
  return c.json({ active: active.rows, resolved: resolved.rows });
});

apiMetricRoutes.get('/api/products/:id/risk-history', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const result = await query(
    `SELECT * FROM audit_log WHERE product_id = ? AND action_type = 'risk_state_transition' ORDER BY created_at DESC`, [productId]);
  return c.json({ transitions: result.rows });
});

apiMetricRoutes.get('/api/products/:id/mrr', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const result = await query(
    'SELECT snapshot_date, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents, mrr_health_ratio FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 30',
    [productId]);
  return c.json({ mrr_history: result.rows });
});

// ─── Cohorts API ─────────────────────────────────────────────────────────────

apiMetricRoutes.get('/api/products/:id/cohorts', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const cohorts = await query(
    'SELECT * FROM cohorts WHERE product_id = ? ORDER BY acquisition_period DESC',
    [productId]);
  // Compute historical average from all cohorts with day_30 data
  const avgResult = await query(
    `SELECT AVG(CAST(retained_day_7 AS REAL) / NULLIF(founder_count, 0)) as avg_day_7,
            AVG(CAST(retained_day_14 AS REAL) / NULLIF(founder_count, 0)) as avg_day_14,
            AVG(CAST(retained_day_30 AS REAL) / NULLIF(founder_count, 0)) as avg_day_30
     FROM cohorts WHERE product_id = ? AND founder_count > 0`,
    [productId]);
  const avg = avgResult.rows[0] as Record<string, unknown> | undefined;
  return c.json({
    cohorts: cohorts.rows,
    historical_average: avg ? {
      retention_day_7: avg.avg_day_7 ?? null,
      retention_day_14: avg.avg_day_14 ?? null,
      retention_day_30: avg.avg_day_30 ?? null,
    } : null,
  });
});

// ─── Competitive API ─────────────────────────────────────────────────────────

apiMetricRoutes.get('/api/products/:id/competitive', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const competitors = await query(
    'SELECT * FROM competitors WHERE product_id = ?', [productId]);
  const signals = await query(
    'SELECT * FROM competitive_signals WHERE product_id = ? ORDER BY detected_at DESC LIMIT 20',
    [productId]);
  return c.json({ competitors: competitors.rows, recent_signals: signals.rows });
});
