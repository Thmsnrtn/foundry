// =============================================================================
// FOUNDRY — Distributed Job Lock
// Prevents double-execution of cron jobs during rolling deploys.
// Uses the job_locks table with expiry-based lease.
//
// ONE TOKEN PER ACQUISITION, NOT ONE PER PROCESS (remediation 1.1, 6 October
// 2026). Ownership was keyed on a single INSTANCE_ID for the whole process, so
// after the ON CONFLICT no-op the check "does locked_by equal INSTANCE_ID?" was
// true for the run that already held the lock: a second run of the same
// routine in the same process went ahead — an hourly routine overrunning its
// hour, or the boot catch-up firing while a tick ran. Worse, the second run's
// release deleted the FIRST run's lock while it was still going, exposing the
// routine to every other instance too. Each acquisition now writes its own
// token, succeeds only if the row carries that token, and releases only that
// token. The lease and its expiry are unchanged.
// =============================================================================

import { query } from '../db/client.js';
import { nanoid } from 'nanoid';

const INSTANCE_ID = nanoid(8);

/**
 * Attempt to acquire a distributed lock for a job.
 * Returns this acquisition's token when it holds the lock, or null when any
 * other holder does — another instance, or another run in this process.
 *
 * The lock auto-expires after `ttlSeconds` to prevent deadlocks from crashed instances.
 * Uses INSERT ... ON CONFLICT to atomically take expired locks.
 */
export async function acquireJobLock(jobName: string, ttlSeconds: number = 300): Promise<string | null> {
  const token = `${INSTANCE_ID}:${nanoid()}`;
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
      [jobName, token, ttlModifier]
    );
    // Verify THIS acquisition holds the lock (the ON CONFLICT WHERE may have been a no-op)
    const result = await query('SELECT locked_by FROM job_locks WHERE job_name = ?', [jobName]);
    return (result.rows[0] as Record<string, unknown>)?.locked_by === token ? token : null;
  } catch {
    return null;
  }
}

/**
 * Release a job lock, but only the acquisition this token names: a run that
 * never held the lock, or whose lease expired and was taken, releases nothing.
 */
export async function releaseJobLock(jobName: string, token: string): Promise<void> {
  await query('DELETE FROM job_locks WHERE job_name = ? AND locked_by = ?', [jobName, token]);
}
