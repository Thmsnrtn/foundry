// =============================================================================
// FOUNDRY — Outcome Tree Health Refresh (V3.1 Layer A revisit)
// Light weekly maintenance. For each active branch:
//   - if metric_key matches a known metric_snapshots column, copy the latest
//     snapshot value into current_value
//   - if branch is older than 90 days AND current_value is still null, mark
//     it superseded with a deterministic reason
// LLM-driven tree generation is deferred — that needs founder-supplied
// seeding rules and is its own work cycle.
// =============================================================================

import { query } from '../../db/client.js';

// Whitelisted metric_snapshots columns. Only these can be auto-pulled into
// outcome_trees.current_value. Anything else stays null.
const SUPPORTED_METRIC_KEYS = new Set<string>([
  'signups_7d',
  'active_users',
  'new_mrr_cents',
  'expansion_mrr_cents',
  'contraction_mrr_cents',
  'churned_mrr_cents',
  'activation_rate',
  'day_30_retention',
  'support_volume_7d',
  'nps_score',
  'churn_rate',
  'mrr_health_ratio',
]);

const STALE_AGE_DAYS = 90;

export interface RefreshResult {
  product_id: string;
  total_active: number;
  refreshed: number;        // current_value updated from snapshot
  superseded: number;       // age-stale branches marked superseded
  killed_30d: number;       // count snapshot, not changed by this run
  achieved_30d: number;     // count snapshot, not changed by this run
}

export async function refreshOutcomeTreeHealth(productId: string): Promise<RefreshResult> {
  const snapshot = await loadLatestSnapshot(productId);
  const branches = await loadActiveBranches(productId);

  let refreshed = 0;
  let superseded = 0;

  for (const b of branches) {
    if (snapshot && b.metric_key && SUPPORTED_METRIC_KEYS.has(b.metric_key)) {
      const value = snapshot[b.metric_key];
      if (typeof value === 'number' && Number.isFinite(value) && value !== b.current_value) {
        await query(`UPDATE outcome_trees SET current_value = ? WHERE id = ?`, [
          value,
          b.id,
        ]);
        refreshed++;
        continue;
      }
    }

    if (b.current_value === null && isStale(b.generated_at)) {
      await query(
        `UPDATE outcome_trees
            SET status = 'superseded',
                killed_at = datetime('now'),
                killed_reason = ?
          WHERE id = ?`,
        [`auto-superseded: no current_value after ${STALE_AGE_DAYS} days`, b.id]
      );
      superseded++;
    }
  }

  const counts = await loadCounts(productId);
  return {
    product_id: productId,
    total_active: counts.active,
    refreshed,
    superseded,
    killed_30d: counts.killed_30d,
    achieved_30d: counts.achieved_30d,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface ActiveBranch {
  id: string;
  metric_key: string | null;
  current_value: number | null;
  generated_at: string;
}

async function loadActiveBranches(productId: string): Promise<ActiveBranch[]> {
  const result = await query(
    `SELECT id, metric_key, current_value, generated_at
       FROM outcome_trees
      WHERE product_id = ? AND status = 'active'`,
    [productId]
  );
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      metric_key: (row.metric_key as string | null) ?? null,
      current_value:
        row.current_value === null || row.current_value === undefined
          ? null
          : Number(row.current_value),
      generated_at: row.generated_at as string,
    };
  });
}

async function loadLatestSnapshot(
  productId: string
): Promise<Record<string, number> | null> {
  const result = await query(
    `SELECT * FROM metric_snapshots
      WHERE product_id = ?
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [productId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  // Promote known numeric columns into a plain { key: number } map. We are
  // lenient here — unknown columns remain ignored by the caller.
  const out: Record<string, number> = {};
  for (const k of SUPPORTED_METRIC_KEYS) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) {
      out[k] = Number(v);
    }
  }
  return out;
}

async function loadCounts(productId: string): Promise<{
  active: number;
  killed_30d: number;
  achieved_30d: number;
}> {
  const active = await query(
    `SELECT COUNT(*) AS c FROM outcome_trees WHERE product_id = ? AND status = 'active'`,
    [productId]
  );
  const killed = await query(
    `SELECT COUNT(*) AS c FROM outcome_trees
      WHERE product_id = ? AND status = 'killed'
        AND killed_at >= datetime('now', '-30 days')`,
    [productId]
  );
  const achieved = await query(
    `SELECT COUNT(*) AS c FROM outcome_trees
      WHERE product_id = ? AND status = 'achieved'
        AND achieved_at >= datetime('now', '-30 days')`,
    [productId]
  );
  return {
    active: Number((active.rows[0] as Record<string, number>).c ?? 0),
    killed_30d: Number((killed.rows[0] as Record<string, number>).c ?? 0),
    achieved_30d: Number((achieved.rows[0] as Record<string, number>).c ?? 0),
  };
}

function isStale(generatedAt: string): boolean {
  const t = new Date(generatedAt).getTime();
  if (Number.isNaN(t)) return false;
  const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
  return ageDays > STALE_AGE_DAYS;
}
