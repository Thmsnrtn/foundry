// =============================================================================
// FOUNDRY — Team Health Metrics Service (V3.1 Layer A)
// Ambros's six metrics, computed weekly per product. Read-only computation
// over existing tables; cached as one row per (product, week) for trend
// display and recursive-critique-yield monitoring.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeamHealthMetric {
  id: string;
  product_id: string;
  week_starting: string;          // 'YYYY-MM-DD' Monday
  critique_pass_rate_pct: number | null;
  total_critiques: number;
  critiques_resulting_in_change: number;
  override_rate_pct: number | null;
  total_decisions_resolved: number;
  decisions_overridden: number;
  evolutions_promoted_count: number;
  recursive_yield_score: number | null;
  decisions_queued: number;
  decisions_resolved: number;
  median_time_to_action_hours: number | null;
  action_accuracy_pct: number | null;
  computed_at: string;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function rowToMetric(r: Record<string, unknown>): TeamHealthMetric {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    week_starting: r.week_starting as string,
    critique_pass_rate_pct: (r.critique_pass_rate_pct as number | null) ?? null,
    total_critiques: Number(r.total_critiques ?? 0),
    critiques_resulting_in_change: Number(r.critiques_resulting_in_change ?? 0),
    override_rate_pct: (r.override_rate_pct as number | null) ?? null,
    total_decisions_resolved: Number(r.total_decisions_resolved ?? 0),
    decisions_overridden: Number(r.decisions_overridden ?? 0),
    evolutions_promoted_count: Number(r.evolutions_promoted_count ?? 0),
    recursive_yield_score: (r.recursive_yield_score as number | null) ?? null,
    decisions_queued: Number(r.decisions_queued ?? 0),
    decisions_resolved: Number(r.decisions_resolved ?? 0),
    median_time_to_action_hours: (r.median_time_to_action_hours as number | null) ?? null,
    action_accuracy_pct: (r.action_accuracy_pct as number | null) ?? null,
    computed_at: r.computed_at as string,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getHealth(
  productId: string,
  weekStarting: string
): Promise<TeamHealthMetric | null> {
  const result = await query(
    `SELECT * FROM team_health_metrics
     WHERE product_id = ? AND week_starting = ?`,
    [productId, weekStarting]
  );
  if (result.rows.length === 0) return null;
  return rowToMetric(result.rows[0] as Record<string, unknown>);
}

export async function getHealthHistory(
  productId: string,
  limit: number = 12
): Promise<TeamHealthMetric[]> {
  const result = await query(
    `SELECT * FROM team_health_metrics
     WHERE product_id = ?
     ORDER BY week_starting DESC LIMIT ?`,
    [productId, limit]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToMetric);
}

// ─── Computation ──────────────────────────────────────────────────────────────

export interface ComputedHealthInput {
  product_id: string;
  week_starting: string;
}

/**
 * Compute and persist a team_health_metrics row for the given (product, week).
 * Idempotent: re-running for the same (product, week) overwrites the prior row.
 *
 * Reads from existing tables when present:
 *   - agent_messages (critique-related signal types)
 *   - decisions (resolution + override)
 *   - agent_evolution_versions (recursive yield)
 *   - agent_predictions (action accuracy)
 *
 * Defensive against missing tables: a missing source table contributes null
 * to its metric rather than throwing.
 */
export async function computeAndStoreHealth(
  input: ComputedHealthInput
): Promise<TeamHealthMetric> {
  const { product_id, week_starting } = input;
  const weekEnd = addDays(week_starting, 7);

  const critique = await safeCritiqueStats(product_id, week_starting, weekEnd);
  const overrideStats = await safeOverrideStats(product_id, week_starting, weekEnd);
  const yieldStats = await safeYieldStats(product_id, week_starting, weekEnd);
  const velocityStats = await safeVelocityStats(product_id, week_starting, weekEnd);
  const accuracy = await safeAccuracyStats(product_id, week_starting, weekEnd);

  // Upsert: delete prior row if exists, then insert
  await query(
    `DELETE FROM team_health_metrics
     WHERE product_id = ? AND week_starting = ?`,
    [product_id, week_starting]
  );

  const id = nanoid();
  await query(
    `INSERT INTO team_health_metrics (
       id, product_id, week_starting,
       critique_pass_rate_pct, total_critiques, critiques_resulting_in_change,
       override_rate_pct, total_decisions_resolved, decisions_overridden,
       evolutions_promoted_count, recursive_yield_score,
       decisions_queued, decisions_resolved, median_time_to_action_hours,
       action_accuracy_pct
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, product_id, week_starting,
      critique.passRatePct, critique.total, critique.resultingInChange,
      overrideStats.overrideRatePct, overrideStats.totalResolved, overrideStats.overridden,
      yieldStats.evolutionsCount, yieldStats.yieldScore,
      velocityStats.queued, velocityStats.resolved, velocityStats.medianTimeHours,
      accuracy.accuracyPct,
    ]
  );

  const out = await getHealth(product_id, week_starting);
  if (!out) throw new Error(`failed to insert team_health row`);
  return out;
}

// ─── Yield Score Logic (Ambros Round 5) ───────────────────────────────────────

/**
 * Compute the recursive-critique yield score from a sequence of evolution
 * promotions in a window. The intuition: if every promotion adds genuine
 * new behavior, yield ~ 1.0. If recent promotions just thrash the same
 * dimensions, yield → 0.
 *
 * Heuristic for V3.1: distinct change_types / total_promotions, weighted
 * such that founder_correction and golden_lesson both count as "real signal"
 * and prompt_refinement / authority_change count as ambiguous.
 *
 * Future: replace with embedding-based novelty score over change_description.
 * Today's heuristic is intentionally simple and inspectable.
 */
export function computeYieldScore(promotions: Array<{ change_type: string }>): number | null {
  if (promotions.length === 0) return null;
  const realSignal = new Set(['golden_lesson', 'founder_correction', 'constraint_added']);
  const realCount = promotions.filter(p => realSignal.has(p.change_type)).length;
  return realCount / promotions.length;
}

// ─── Defensive Source Reads ───────────────────────────────────────────────────

async function safeCritiqueStats(
  productId: string,
  start: string,
  end: string
): Promise<{ passRatePct: number | null; total: number; resultingInChange: number }> {
  try {
    // agent_messages with message_type='alert' or 'request' containing critique
    // are best-effort signals. In production, a dedicated critique_events table
    // would be cleaner; for V3.1 we read what exists.
    const total = await query(
      `SELECT COUNT(*) AS c FROM agent_messages
       WHERE product_id = ?
         AND created_at >= ? AND created_at < ?
         AND message_type IN ('alert','request')`,
      [productId, start, end]
    );
    const totalCount = Number((total.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);

    // Heuristic: critiques that resulted in change = critiques that were
    // followed by an evolution promotion within 7 days. We don't have a
    // direct join, so we proxy with promoted evolutions in window.
    const promoted = await query(
      `SELECT COUNT(*) AS c FROM agent_evolution_versions
       WHERE product_id = ?
         AND promoted_at IS NOT NULL
         AND promoted_at >= ? AND promoted_at < ?`,
      [productId, start, end]
    );
    const promotedCount = Number((promoted.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);

    if (totalCount === 0) {
      return { passRatePct: null, total: 0, resultingInChange: promotedCount };
    }
    const resultingInChange = Math.min(promotedCount, totalCount);
    const passed = totalCount - resultingInChange;
    return {
      passRatePct: (passed / totalCount) * 100,
      total: totalCount,
      resultingInChange,
    };
  } catch {
    return { passRatePct: null, total: 0, resultingInChange: 0 };
  }
}

async function safeOverrideStats(
  productId: string,
  start: string,
  end: string
): Promise<{ overrideRatePct: number | null; totalResolved: number; overridden: number }> {
  try {
    const total = await query(
      `SELECT COUNT(*) AS c FROM decisions
       WHERE product_id = ?
         AND status IN ('approved','rejected','executed')
         AND decided_at >= ? AND decided_at < ?`,
      [productId, start, end]
    );
    const overridden = await query(
      `SELECT COUNT(*) AS c FROM decisions
       WHERE product_id = ?
         AND status = 'rejected'
         AND decided_at >= ? AND decided_at < ?
         AND decided_by = 'founder'`,
      [productId, start, end]
    );
    const totalCount = Number((total.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);
    const overriddenCount = Number((overridden.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);
    if (totalCount === 0) {
      return { overrideRatePct: null, totalResolved: 0, overridden: 0 };
    }
    return {
      overrideRatePct: (overriddenCount / totalCount) * 100,
      totalResolved: totalCount,
      overridden: overriddenCount,
    };
  } catch {
    return { overrideRatePct: null, totalResolved: 0, overridden: 0 };
  }
}

async function safeYieldStats(
  productId: string,
  start: string,
  end: string
): Promise<{ evolutionsCount: number; yieldScore: number | null }> {
  try {
    const result = await query(
      `SELECT change_type FROM agent_evolution_versions
       WHERE product_id = ?
         AND promoted_at IS NOT NULL
         AND promoted_at >= ? AND promoted_at < ?`,
      [productId, start, end]
    );
    const rows = result.rows as Record<string, unknown>[];
    const promotions = rows.map(r => ({ change_type: r.change_type as string }));
    return {
      evolutionsCount: promotions.length,
      yieldScore: computeYieldScore(promotions),
    };
  } catch {
    return { evolutionsCount: 0, yieldScore: null };
  }
}

async function safeVelocityStats(
  productId: string,
  start: string,
  end: string
): Promise<{ queued: number; resolved: number; medianTimeHours: number | null }> {
  try {
    const queued = await query(
      `SELECT COUNT(*) AS c FROM decisions
       WHERE product_id = ? AND created_at >= ? AND created_at < ?`,
      [productId, start, end]
    );
    const resolved = await query(
      `SELECT COUNT(*) AS c FROM decisions
       WHERE product_id = ? AND decided_at >= ? AND decided_at < ?
         AND decided_at IS NOT NULL`,
      [productId, start, end]
    );
    const queuedCount = Number((queued.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);
    const resolvedCount = Number((resolved.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);

    // Median hours: SQLite has no MEDIAN. Pull list and compute.
    const times = await query(
      `SELECT
         (julianday(decided_at) - julianday(created_at)) * 24 AS hours
       FROM decisions
       WHERE product_id = ?
         AND decided_at >= ? AND decided_at < ?
         AND decided_at IS NOT NULL AND created_at IS NOT NULL`,
      [productId, start, end]
    );
    const hoursList = (times.rows as Record<string, unknown>[])
      .map(r => Number(r.hours))
      .filter(n => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);
    let medianHours: number | null = null;
    if (hoursList.length > 0) {
      const mid = Math.floor(hoursList.length / 2);
      medianHours = hoursList.length % 2 === 0
        ? (hoursList[mid - 1]! + hoursList[mid]!) / 2
        : hoursList[mid]!;
    }
    return {
      queued: queuedCount,
      resolved: resolvedCount,
      medianTimeHours: medianHours,
    };
  } catch {
    return { queued: 0, resolved: 0, medianTimeHours: null };
  }
}

async function safeAccuracyStats(
  productId: string,
  start: string,
  end: string
): Promise<{ accuracyPct: number | null }> {
  try {
    // agent_predictions with measured accuracy in window
    const result = await query(
      `SELECT AVG(accuracy_score) AS avg_accuracy
       FROM agent_predictions
       WHERE product_id = ?
         AND measured_at IS NOT NULL
         AND measured_at >= ? AND measured_at < ?`,
      [productId, start, end]
    );
    const avg = (result.rows[0] as Record<string, unknown> | undefined)?.avg_accuracy;
    if (avg == null) return { accuracyPct: null };
    return { accuracyPct: Number(avg) * 100 };
  } catch {
    return { accuracyPct: null };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
