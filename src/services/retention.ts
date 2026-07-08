// =============================================================================
// FOUNDRY — Data retention (Phase 3.5)
// Purges high-volume operational log rows past the retention window so the DB
// doesn't grow unbounded. Table/column names are fixed constants (never user
// input), so the dynamic SQL here is safe.
// =============================================================================

import { query } from '../db/client.js';
import { logger } from './logger.js';

export const DEFAULT_RETENTION_DAYS = 180;

/** Tables whose rows are safe to purge past the retention window. */
export const RETENTION_TABLES: Array<{ table: string; column: string }> = [
  { table: 'agent_messages', column: 'created_at' },
  { table: 'audit_log', column: 'created_at' },
];

function retentionDays(): number {
  const raw = parseInt(process.env.DATA_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
}

/**
 * Delete rows older than the retention window from each retention table.
 * Returns per-table deleted counts (-1 when a table's purge errored, e.g. the
 * table doesn't exist in this environment). Never throws.
 */
export async function purgeExpiredRecords(
  days: number = retentionDays(),
  now: Date = new Date(),
): Promise<Record<string, number>> {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const results: Record<string, number> = {};

  for (const { table, column } of RETENTION_TABLES) {
    try {
      const res = await query(`DELETE FROM ${table} WHERE ${column} < ?`, [cutoff]);
      results[table] = Number(res.rowsAffected ?? 0);
    } catch (err) {
      logger.warn('data_retention.purge_failed', { table, error: (err as Error).message });
      results[table] = -1;
    }
  }

  return results;
}
