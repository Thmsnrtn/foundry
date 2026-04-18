// =============================================================================
// FOUNDRY — Job Locking
// Prevents concurrent execution of the same job across multiple instances.
// Uses database-level advisory locks via a jobs_lock table.
// =============================================================================

import { query } from '../db/client.js';
import { log } from './logger.js';

const LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes max lock hold time

/**
 * Attempt to acquire a lock for a job. Returns true if acquired.
 * Uses INSERT OR IGNORE + timestamp check for atomicity.
 */
let _tableCreated = false;

async function ensureLockTable(): Promise<void> {
  if (_tableCreated) return;
  await query(`CREATE TABLE IF NOT EXISTS job_locks (
    job_name TEXT PRIMARY KEY,
    locked_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    instance_id TEXT
  )`, []);
  _tableCreated = true;
}

export async function acquireJobLock(jobName: string): Promise<boolean> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();

  try {
    await ensureLockTable();

    // Clean up expired locks
    await query('DELETE FROM job_locks WHERE expires_at < ?', [now]);

    // Try to acquire
    await query(
      'INSERT INTO job_locks (job_name, locked_at, expires_at, instance_id) VALUES (?, ?, ?, ?)',
      [jobName, now, expiresAt, `${process.pid}-${Date.now()}`]
    );

    return true;
  } catch (err) {
    // UNIQUE constraint violation means another instance holds the lock
    const message = err instanceof Error ? err.message : '';
    if (message.includes('UNIQUE') || message.includes('constraint')) {
      log.info(`Job ${jobName} already locked by another instance`, { jobName });
      return false;
    }
    log.error(`Failed to acquire job lock for ${jobName}`, err);
    return false;
  }
}

/**
 * Release a job lock.
 */
export async function releaseJobLock(jobName: string): Promise<void> {
  try {
    await query('DELETE FROM job_locks WHERE job_name = ?', [jobName]);
  } catch (err) {
    log.error(`Failed to release job lock for ${jobName}`, err);
  }
}

/**
 * Execute a job with a lock. If the lock can't be acquired, skip execution.
 */
export async function withJobLock(jobName: string, fn: () => Promise<void>): Promise<boolean> {
  const acquired = await acquireJobLock(jobName);
  if (!acquired) {
    log.info(`Skipping ${jobName}: locked by another instance`);
    return false;
  }

  try {
    await fn();
    return true;
  } finally {
    await releaseJobLock(jobName);
  }
}
