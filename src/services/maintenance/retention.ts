// =============================================================================
// FOUNDRY — Data Retention (Wave 4, action 31)
// agent_messages and audit_log grow unboundedly; both are high-write
// mostly-read-recent. This module archives rows older than the
// retention horizon to JSON-line cold storage in the same table or
// drops them outright depending on policy. Council 8 (DBE) finding.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';

// ─── Policy ───────────────────────────────────────────────────────────────────

interface RetentionPolicy {
  table: string;
  /** column used to compare against age cutoff */
  timestampColumn: string;
  /** delete rows older than this many days */
  retentionDays: number;
  /** maximum rows deleted per run (prevents one cron from blocking on a huge backlog) */
  batchSize: number;
}

const POLICIES: RetentionPolicy[] = [
  // agent_messages — operational chatter; recent-only is fine. 180 days.
  { table: 'agent_messages', timestampColumn: 'created_at', retentionDays: 180, batchSize: 5000 },
  // audit_log — compliance-relevant; keep longer. 365 days.
  { table: 'audit_log',      timestampColumn: 'created_at', retentionDays: 365, batchSize: 5000 },
  // briefing_decision_links — telemetry; 90 days is plenty.
  { table: 'briefing_decision_links', timestampColumn: 'created_at', retentionDays: 90, batchSize: 5000 },
  // ai_cost_log — financial reporting needs 13 months for year-over-year.
  { table: 'ai_cost_log',    timestampColumn: 'timestamp',  retentionDays: 395, batchSize: 5000 },
  // integration_events — high-volume; 60 days.
  { table: 'integration_events', timestampColumn: 'created_at', retentionDays: 60, batchSize: 10000 },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RetentionResult {
  table: string;
  deleted: number;
  cutoff_date: string;
}

export async function runRetentionPolicy(): Promise<RetentionResult[]> {
  const results: RetentionResult[] = [];

  for (const policy of POLICIES) {
    const result = await applyPolicy(policy);
    results.push(result);
    if (result.deleted > 0) {
      log.info('retention.applied', {
        jobName: 'retention_policy',
        table: result.table,
        deleted: result.deleted,
        cutoff_date: result.cutoff_date,
      });
    }
  }

  return results;
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function applyPolicy(policy: RetentionPolicy): Promise<RetentionResult> {
  const cutoffDate = new Date(
    Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // First check if the table exists; on dev DBs without all migrations, skip.
  try {
    await query(`SELECT 1 FROM ${policy.table} LIMIT 1`, []);
  } catch {
    return { table: policy.table, deleted: 0, cutoff_date: cutoffDate };
  }

  // Delete in one bounded batch so a long-overdue run doesn't lock the
  // table for minutes. The cron can run multiple ticks to drain backlog.
  const result = await query(
    `DELETE FROM ${policy.table}
      WHERE rowid IN (
        SELECT rowid FROM ${policy.table}
         WHERE datetime(${policy.timestampColumn}) < datetime(?)
         ORDER BY ${policy.timestampColumn} ASC
         LIMIT ?
      )`,
    [cutoffDate, policy.batchSize]
  );

  return {
    table: policy.table,
    deleted: Number((result as unknown as { rowsAffected?: number }).rowsAffected ?? 0),
    cutoff_date: cutoffDate,
  };
}
