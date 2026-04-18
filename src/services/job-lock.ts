// =============================================================================
// FOUNDRY — Distributed Job Lock
// Prevents double-execution of cron jobs during rolling deploys.
// Uses the job_locks table with expiry-based lease.
// =============================================================================

import { query } from '../db/client.js';
import { nanoid } from 'nanoid';

const INSTANCE_ID = nanoid(8);

/**
 * Attempt to acquire a distributed lock for a job.
 * Returns true if this instance acquired the lock, false if another instance holds it.
 *
 * The lock auto-expires after `ttlSeconds` to prevent deadlocks from crashed instances.
 * Uses INSERT ... ON CONFLICT to atomically take expired locks.
 */
export async function acquireJobLock(jobName: string, ttlSeconds: number = 300): Promise<boolean> {
  try {
    // Build the time modifier string (e.g. "+300 seconds") so SQLite can parse it
    const ttlModifier = `+${ttlSeconds} seconds`;
    await query(
      `INSERT INTO job_locks (job_name, locked_at, locked_by, expires_at)
       VALUES (?, datetime('now'), ?, datetime('now', ?))
       ON CONFLICT(job_name) DO UPDATE SET
         locked_at = datetime('now'),
         locked_by = excluded.locked_by,
         expires_at = excluded.expires_at
       WHERE job_locks.expires_at < datetime('now')`,
      [jobName, INSTANCE_ID, ttlModifier]
    );
    // Verify we actually hold the lock (the ON CONFLICT WHERE may have been a no-op)
    const result = await query('SELECT locked_by FROM job_locks WHERE job_name = ?', [jobName]);
    return (result.rows[0] as Record<string, unknown>)?.locked_by === INSTANCE_ID;
  } catch {
    return false;
  }
}

/**
 * Release a job lock, but only if this instance holds it.
 */
export async function releaseJobLock(jobName: string): Promise<void> {
  await query('DELETE FROM job_locks WHERE job_name = ? AND locked_by = ?', [jobName, INSTANCE_ID]);
}
