// =============================================================================
// FOUNDRY — whether the parts of Foundry that run on a schedule are running
//
// Every scheduled job is wrapped in a try/catch that logs and moves on, and
// nothing durable recorded that it failed. So a week in which the effect
// reconciliation threw on every run looked exactly like a calm week on the
// page the founder reads: no new outcomes, no new judgments, nothing visibly
// wrong.
//
// "Nothing happened" and "nothing ran" are different facts. The letter said the
// first for both.
//
// WHAT IS RECORDED IS THE SHAPE. The error's CLASS NAME only, never its
// message: a message carries whatever the failure was carrying — a customer
// address, a provider response, part of a secret — and a health table is the
// last place that belongs. Migration 172 refuses anything with a space in it or
// longer than an identifier, so a future caller cannot put a message here by
// reaching for the nearest string.
// =============================================================================

import { query } from '../../db/client.js';

/**
 * The scheduled work whose silence changes what a founder is looking at.
 *
 * Deliberately not every job. A marketing sweep failing is an operational
 * matter for whoever runs Foundry; these are the loops that decide whether the
 * institution's own page is current — outcomes reconciled against what people
 * reported, judgments raised and later compared with reality, expectations
 * resolved against what was actually observed.
 */
export const INSTITUTION_LOOPS: Record<string, string> = {
  institutional_effect_reconciliation:
    'turning what people outside report into whether something worked',
  institutional_judgment_tick:
    'raising judgments about your company and checking them against what happened',
  external_metric_shadow_resolution:
    'comparing what you said you would expect against what your systems reported',
};

/** One job's health. `consecutiveFailures` is the only number a founder needs:
 *  it answers "is this failing now", which a lifetime total never does. */
export interface LoopHealth {
  jobName: string; label: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null; lastFailureAt: string | null;
  lastErrorName: string | null;
}

/** A class name, never a message. Anything else is refused by migration 172,
 *  and refusing here as well means the caller gets no row rather than a throw
 *  inside a job's own error handler. */
function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Error';
}

export async function recordJobSuccess(jobName: string): Promise<void> {
  await query(
    `INSERT INTO job_health (job_name,last_success_at,consecutive_failures,updated_at)
     VALUES (?,datetime('now'),0,datetime('now'))
     ON CONFLICT(job_name) DO UPDATE SET
       last_success_at=datetime('now'), consecutive_failures=0,
       last_error_name=NULL, updated_at=datetime('now')`, [jobName]);
}

export async function recordJobFailure(jobName: string, error: unknown): Promise<void> {
  await query(
    `INSERT INTO job_health (job_name,last_failure_at,consecutive_failures,last_error_name,updated_at)
     VALUES (?,datetime('now'),1,?,datetime('now'))
     ON CONFLICT(job_name) DO UPDATE SET
       last_failure_at=datetime('now'),
       consecutive_failures=job_health.consecutive_failures+1,
       last_error_name=excluded.last_error_name, updated_at=datetime('now')`,
    [jobName, errorName(error)]);
}

/**
 * Institution loops that are failing right now.
 *
 * WHAT THIS CANNOT SEE, and does not pretend to: a job that never runs at all.
 * A bad cron expression, a scheduler that never started, or a process group
 * serving HTTP without crons produces no failure — it produces nothing, and
 * absence of a row is indistinguishable from a fresh install that has not had
 * its first tick yet. Claiming staleness from silence would mean telling every
 * new company that Foundry had stopped. Detecting that properly needs the
 * schedule and a clock the deployment agrees with, and it is worth doing
 * separately rather than guessed at here.
 */
export async function getFailingInstitutionLoops(): Promise<LoopHealth[]> {
  const names = Object.keys(INSTITUTION_LOOPS);
  const rows = await query(
    `SELECT job_name,last_success_at,last_failure_at,consecutive_failures,last_error_name
       FROM job_health
      WHERE consecutive_failures > 0 AND job_name IN (${names.map(() => '?').join(',')})
      ORDER BY consecutive_failures DESC, job_name`, names);
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    jobName: String(row.job_name), label: INSTITUTION_LOOPS[String(row.job_name)] ?? String(row.job_name),
    consecutiveFailures: Number(row.consecutive_failures),
    lastSuccessAt: row.last_success_at == null ? null : String(row.last_success_at),
    lastFailureAt: row.last_failure_at == null ? null : String(row.last_failure_at),
    lastErrorName: row.last_error_name == null ? null : String(row.last_error_name),
  }));
}
