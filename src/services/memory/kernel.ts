// =============================================================================
// FOUNDRY — Memory Kernel service (Ascent B1)
//
// The "second brain that never flinches." Captures the belief-state behind a
// decision as testable premises, checks metric premises against live telemetry,
// and surfaces decisions whose premises have been falsified so the founder is
// held accountable to their past reasoning.
//
// Built to the AcreOS service convention: a focused service module, typed I/O,
// no route/HTML concerns here (those live in routes-memory).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { buildInsert } from '../../db/schema/kernel.js';
import {
  DECISION_PREMISES,
  type DecisionPremise,
  type DecisionPremiseInsert,
  type PremiseComparator,
} from '../../db/schema/memory.js';

// metric_key → the metric_snapshots column it reads. Only these are auto-checkable.
const METRIC_COLUMNS: Record<string, string> = {
  churn_rate: 'churn_rate',
  activation_rate: 'activation_rate',
  day_30_retention: 'day_30_retention',
  nps_score: 'nps_score',
  mrr_health_ratio: 'mrr_health_ratio',
  mrr_cents: 'mrr_cents',
  new_mrr_cents: 'new_mrr_cents',
  signups_7d: 'signups_7d',
};

/** The metric vocabulary shared by every falsifiable-belief producer (founder
 *  premises, Red Team objections). Single source of checkability truth. */
export const CHECKABLE_METRIC_KEYS = Object.keys(METRIC_COLUMNS);

/** The metrics stored 0–1 rather than in percentage points. */
export const FRACTION_METRIC_KEYS = new Set([
  'churn_rate', 'activation_rate', 'day_30_retention', 'mrr_health_ratio',
]);

/**
 * A THRESHOLD IN THE UNITS THE COLUMN IS STORED IN.
 *
 * `churn_rate` and its siblings are stored 0–1. A premise threshold reaches
 * this service from three places, and only one of them converted: the founder's
 * own sentence, parsed by `ux/fluency.ts`. The other two — the
 * `foundry_record_decision` MCP tool and the chat capture — pass a number a
 * MODEL chose, and a model asked for "the threshold" on churn will write 5 for
 * five per cent. `0.05 < 5` holds forever, so the belief could never be
 * falsified and the accountability queue would never mention it.
 *
 * The rule is the one `fluency.ts` already applied and now imports: for a
 * fraction metric, a value above 1 is percentage points. It is idempotent, so
 * a caller that has already converted is not converted twice, and it is stated
 * in both tool descriptions so a model can write either.
 */
export function normaliseThreshold(metricKey: string | undefined, threshold: number): number {
  if (!metricKey || !FRACTION_METRIC_KEYS.has(metricKey)) return threshold;
  return threshold > 1 ? threshold / 100 : threshold;
}

export interface RecordPremiseInput {
  productId: string;
  decisionId: string;
  decisionSource?: 'strategic' | 'decision';
  premise: string;
  metricKey?: string;
  comparator?: PremiseComparator;
  threshold?: number;
  /** 'red_team' when this belief is the inverse of an overruled objection. */
  origin?: 'founder' | 'red_team';
  reviewId?: string;
  /** Bets about the future: defer checking for this many days (e.g. a campaign
   *  premise is only judgeable after the campaign's window). */
  graceDays?: number;
}

/** Capture a belief behind a decision. If a metric+comparator+threshold is given
 *  it becomes an auto-checkable metric premise; otherwise it's qualitative. */
export async function recordPremise(input: RecordPremiseInput): Promise<string> {
  const id = nanoid();
  const isMetric = !!(input.metricKey && input.comparator && input.threshold != null);
  const threshold = input.threshold == null
    ? null : normaliseThreshold(input.metricKey, input.threshold);
  const row: DecisionPremiseInsert = {
    id,
    product_id: input.productId,
    decision_id: input.decisionId,
    decision_source: input.decisionSource ?? 'strategic',
    premise: input.premise,
    premise_type: isMetric ? 'metric' : 'qualitative',
    metric_key: input.metricKey ?? null,
    comparator: input.comparator ?? null,
    threshold,
    status: 'holding',
    origin: input.origin ?? 'founder',
    review_id: input.reviewId ?? null,
    effective_at: input.graceDays && input.graceDays > 0
      ? new Date(Date.now() + input.graceDays * 86_400_000).toISOString()
      : null,
  };
  const { sql, args } = buildInsert(DECISION_PREMISES, row as unknown as Record<string, unknown>);
  await query(sql, args);
  return id;
}

function compare(value: number, comparator: PremiseComparator, threshold: number): boolean {
  switch (comparator) {
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    case '==': return value === threshold;
  }
}

export interface PremiseCheckResult {
  checked: number;
  falsified: number;
}

/** Evaluate every holding metric premise for a product against the latest
 *  metric_snapshot. A premise that no longer holds flips to 'falsified' with the
 *  observed value recorded as evidence — that's an "expired belief." */
export async function checkPremises(productId: string): Promise<PremiseCheckResult> {
  // 'unverifiable' premises are re-checked too: one sparse snapshot must not
  // permanently exempt a belief from falsification — the moment the metric
  // reappears, the premise goes back under monitoring. datetime() normalizes
  // the ISO 'T' format against SQLite's space format for the comparison.
  const premises = await query(
    `SELECT * FROM ${DECISION_PREMISES}
     WHERE product_id = ? AND status IN ('holding', 'unverifiable') AND premise_type = 'metric'
       AND (effective_at IS NULL OR datetime(effective_at) <= datetime('now'))`,
    [productId],
  );
  if (premises.rows.length === 0) return { checked: 0, falsified: 0 };

  const snap = await query(
    `SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
    [productId],
  );
  const latest = snap.rows[0] as Record<string, unknown> | undefined;

  let falsified = 0;
  let checked = 0;
  for (const raw of premises.rows as unknown as DecisionPremise[]) {
    const col = raw.metric_key ? METRIC_COLUMNS[raw.metric_key] : undefined;
    if (!col || !raw.comparator || raw.threshold == null) continue;
    const current = latest ? (latest[col] as number | null) : null;
    if (current == null) {
      // Can't evaluate without data — mark unverifiable, keep the last_checked stamp.
      await query(
        `UPDATE ${DECISION_PREMISES} SET status = 'unverifiable', last_checked_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [raw.id],
      );
      continue;
    }
    checked++;
    const stillHolds = compare(current, raw.comparator, raw.threshold);
    if (stillHolds) {
      // A previously-unverifiable premise that now evaluates returns to
      // 'holding' — it is back under live monitoring.
      await query(
        `UPDATE ${DECISION_PREMISES} SET status = 'holding', last_checked_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [raw.id],
      );
    } else {
      falsified++;
      await query(
        `UPDATE ${DECISION_PREMISES}
         SET status = 'falsified', falsified_at = CURRENT_TIMESTAMP, last_checked_at = CURRENT_TIMESTAMP,
             evidence = ?
         WHERE id = ?`,
        [`observed ${raw.metric_key} = ${current} (premise required ${raw.comparator} ${raw.threshold})`, raw.id],
      );
      // Dissent Law / Honesty Law: a falsified red_team-origin premise means the
      // overruled objection was RIGHT — vindicate the review (calibration point).
      if (raw.origin === 'red_team' && raw.review_id) {
        await query(
          `UPDATE red_team_reviews
           SET resolved_outcome = 'vindicated', resolved_at = CURRENT_TIMESTAMP
           WHERE id = ? AND resolved_outcome IS NULL`,
          [raw.review_id],
        );
      }
    }
  }
  return { checked, falsified };
}

export interface ExpiredBelief {
  premise: DecisionPremise;
  decision_title: string | null;
}

/** Decisions whose premise has been falsified — the accountability queue. Joins
 *  to the strategic_decisions_log title so the founder sees WHICH bet is now on
 *  shaky ground. */
export async function getExpiredBeliefs(productId: string): Promise<ExpiredBelief[]> {
  const result = await query(
    `SELECT p.*, s.decision_title AS decision_title
     FROM ${DECISION_PREMISES} p
     LEFT JOIN strategic_decisions_log s
       ON s.id = p.decision_id AND p.decision_source = 'strategic'
     WHERE p.product_id = ? AND p.status = 'falsified'
     ORDER BY p.falsified_at DESC
     LIMIT 25`,
    [productId],
  );
  return (result.rows as unknown as Array<DecisionPremise & { decision_title: string | null }>).map((r) => ({
    premise: r,
    decision_title: r.decision_title,
  }));
}

/** Mark an expired belief as revisited (the founder has acknowledged/acted). */
export async function markRevisited(premiseId: string, productId: string): Promise<void> {
  await query(
    `UPDATE ${DECISION_PREMISES} SET status = 'revisited' WHERE id = ? AND product_id = ?`,
    [premiseId, productId],
  );
}

export interface MemoryDigest {
  total: number;
  holding: number;
  falsified: number;
  unverifiable: number;
  revisited: number;
}

/** Counts for the dashboard / briefing "your past self vs now" strip. */
export async function getMemoryDigest(productId: string): Promise<MemoryDigest> {
  const r = await query(
    `SELECT status, COUNT(*) AS n FROM ${DECISION_PREMISES} WHERE product_id = ? GROUP BY status`,
    [productId],
  );
  const digest: MemoryDigest = { total: 0, holding: 0, falsified: 0, unverifiable: 0, revisited: 0 };
  for (const row of r.rows as unknown as Array<{ status: string; n: number }>) {
    const n = Number(row.n);
    digest.total += n;
    if (row.status in digest) (digest as unknown as Record<string, number>)[row.status] = n;
  }
  return digest;
}
