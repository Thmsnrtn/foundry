// =============================================================================
// FOUNDRY — Distributed Job Lock
// Prevents double-execution of cron jobs during rolling deploys AND inside one
// process (a tick that overlaps its own previous run, or the boot catch-up
// firing while the tick runs).
// Uses the job_locks table with expiry-based lease.
//
// OWNERSHIP IS PER ACQUISITION, NOT PER PROCESS. Each successful acquire writes
// a fresh token (`<instance>:<nonce>`) into `locked_by` and hands it back; only
// that token releases it. Keying on one id per process (as this file once did)
// let a holder "re-acquire" its own lock, and the second run's release then
// deleted the first run's lease (F-ROUTINES-LOCK-1, 2026-10-06).
// =============================================================================

import { query } from '../db/client.js';
import { nanoid } from 'nanoid';

const INSTANCE_ID = nanoid(8);

/** The proof of one acquisition. Opaque to callers; pass it back to release. */
export type JobLease = string;

/** A fresh token for one acquisition: this process's id plus a nonce. */
export function newLeaseToken(): JobLease {
  return `${INSTANCE_ID}:${nanoid(12)}`;
}

/** The SQL that takes a free or expired lease for `token`. Exported so the
 *  load harness and contention tests exercise the production statement. */
export const ACQUIRE_JOB_LOCK_SQL =
  `INSERT INTO job_locks (job_name, locked_at, locked_by, expires_at)
       VALUES (?, datetime('now'), ?, datetime('now', ?))
       ON CONFLICT(job_name) DO UPDATE SET
         locked_at = datetime('now'),
         locked_by = excluded.locked_by,
         expires_at = excluded.expires_at
       WHERE job_locks.expires_at < datetime('now')`;

/**
 * Attempt to acquire a distributed lock for a job.
 * Returns the lease token if THIS call acquired the lock, or null if anyone —
 * another instance, or another run in this same process — holds it.
 *
 * The lock auto-expires after `ttlSeconds` to prevent deadlocks from crashed instances.
 * Uses INSERT ... ON CONFLICT to atomically take expired locks.
 */
export async function acquireJobLock(jobName: string, ttlSeconds: number = 300, token: JobLease = newLeaseToken()): Promise<JobLease | null> {
  try {
    // Build the time modifier string (e.g. "+300 seconds") so SQLite can parse it
    const ttlModifier = `+${ttlSeconds} seconds`;
    await query(ACQUIRE_JOB_LOCK_SQL, [jobName, token, ttlModifier]);
    // Verify we actually hold the lock (the ON CONFLICT WHERE may have been a no-op).
    // The token is unique to this call, so a lease held by an earlier run in
    // this process does not read as ours.
    const result = await query('SELECT locked_by FROM job_locks WHERE job_name = ?', [jobName]);
    return (result.rows[0] as Record<string, unknown>)?.locked_by === token ? token : null;
  } catch {
    return null;
  }
}

/**
 * Release a job lock, but only the lease this acquisition holds. A run whose
 * lease expired and was taken over cannot delete its successor's lease.
 */
export async function releaseJobLock(jobName: string, lease: JobLease): Promise<void> {
  await query('DELETE FROM job_locks WHERE job_name = ? AND locked_by = ?', [jobName, lease]);
}
