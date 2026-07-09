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
};

export interface RecordPremiseInput {
  productId: string;
  decisionId: string;
  decisionSource?: 'strategic' | 'decision';
  premise: string;
  metricKey?: string;
  comparator?: PremiseComparator;
  threshold?: number;
}

/** Capture a belief behind a decision. If a metric+comparator+threshold is given
 *  it becomes an auto-checkable metric premise; otherwise it's qualitative. */
export async function recordPremise(input: RecordPremiseInput): Promise<string> {
  const id = nanoid();
  const isMetric = !!(input.metricKey && input.comparator && input.threshold != null);
  const row: DecisionPremiseInsert = {
    id,
    product_id: input.productId,
    decision_id: input.decisionId,
    decision_source: input.decisionSource ?? 'strategic',
    premise: input.premise,
    premise_type: isMetric ? 'metric' : 'qualitative',
    metric_key: input.metricKey ?? null,
    comparator: input.comparator ?? null,
    threshold: input.threshold ?? null,
    status: 'holding',
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
  const premises = await query(
    `SELECT * FROM ${DECISION_PREMISES}
     WHERE product_id = ? AND status = 'holding' AND premise_type = 'metric'`,
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
      await query(
        `UPDATE ${DECISION_PREMISES} SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
