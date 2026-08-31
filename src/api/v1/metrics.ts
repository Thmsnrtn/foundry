// =============================================================================
// FOUNDRY REST API v1 — Metrics
// =============================================================================

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { logger } from '../../services/logger.js';
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

    // A FORECAST THAT HAS COME DUE IS SCORED HERE TOO. This door writes the MRR
    // LEVEL — the quantity `forecast_checkpoints` predicts — and the
    // reconciliation was wired only at the founder's own ingest token, so a
    // company integrating through the documented API with issued credentials
    // never had a prediction checked. Never fails the report.
    const { reconcileForecastsFromSnapshot } = await import(
      '../../services/scp/forecasting/runway.js'
    );
    await reconcileForecastsFromSnapshot(productId, mrr_cents as number | null | undefined);

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

    const latestSnapshot = (snapshotResult.rows[0] ?? null) as
      { snapshot_date?: string; mrr_cents?: number | null; active_users?: number | null;
        churn_rate?: number | null } | null;

    // IS_STALE WAS COMPUTED FROM THE ROW'S EXISTENCE, NOT FROM ITS DATE.
    //
    // The comment beside it said `snapshot_date` was the whole answer, and then
    // the expression read `latestSnapshot == null`. A daily job inserts an
    // EMPTY placeholder snapshot for every active product, so a row exists for
    // today for every company from its first day — which made `is_stale`
    // structurally false, for everyone, forever, no matter how long ago a
    // number was last reported.
    //
    // Two different questions were also wearing one name. "When was the last
    // snapshot?" and "does that snapshot contain anything?" are not the same,
    // and the placeholder is precisely the row where the answers diverge.
    const ageDays = latestSnapshot?.snapshot_date == null
      ? null
      : Math.floor(
        (Date.now() - new Date(`${latestSnapshot.snapshot_date}T00:00:00Z`).getTime())
        / 86_400_000);

    // The snapshot job runs daily at midnight UTC, so yesterday's date is
    // normal operation and anything older than that means a day was missed.
    const STALE_AFTER_DAYS = 2;

    const hasMeasurements = latestSnapshot != null && (
      latestSnapshot.mrr_cents != null
      || latestSnapshot.active_users != null
      || latestSnapshot.churn_rate != null
    );

    return c.json({
      data: {
        latest_snapshot: latestSnapshot,
        snapshot_age_days: ageDays,
        // Null when there is no snapshot at all: absent data is not stale data,
        // and an integrator reading `is_stale === false` should not be told
        // "current" about a company that has never reported anything.
        is_stale: ageDays == null ? null : ageDays > STALE_AFTER_DAYS,
        stale_after_days: STALE_AFTER_DAYS,
        // Whether the newest snapshot carries any measurement at all. The
        // placeholder carries none.
        has_measurements: hasMeasurements,
      },
    });
  } catch (err) {
    logger.error(`v1 metrics health failed: ${err instanceof Error ? err.message : String(err)}`,
      { productId });
    return c.json({ error: 'Failed to fetch health data' }, 500);
  }
});
