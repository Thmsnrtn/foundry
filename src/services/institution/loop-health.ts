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
export const INSTITUTION_LOOPS: Record<string, { label: string; staleAfterHours: number }> = {
  institutional_effect_reconciliation: {
    label: 'turning what people outside report into whether something worked',
    // Hourly. Six missed runs is past any plausible blip.
    staleAfterHours: 6,
  },
  institutional_judgment_tick: {
    label: 'raising judgments about your company, checking them against what '
      + 'happened, and resolving what you said you would expect',
    // Every six hours. A day of silence is four missed runs.
    staleAfterHours: 24,
  },
};

/** One job's health. `consecutiveFailures` is the only number a founder needs:
 *  it answers "is this failing now", which a lifetime total never does. */
export interface LoopHealth {
  jobName: string; label: string;
  consecutiveFailures: number;
  /** It is not erroring — it has simply not run for longer than it should. */
  stoppedRunning: boolean;
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
export async function getFailingInstitutionLoops(now: Date = new Date()): Promise<LoopHealth[]> {
  const names = Object.keys(INSTITUTION_LOOPS);
  const rows = await query(
    `SELECT job_name,last_success_at,last_failure_at,consecutive_failures,last_error_name
       FROM job_health
      WHERE job_name IN (${names.map(() => '?').join(',')})`, names);

  const out: LoopHealth[] = [];
  for (const row of rows.rows as unknown as Array<Record<string, unknown>>) {
    const jobName = String(row.job_name);
    const loop = INSTITUTION_LOOPS[jobName];
    if (!loop) continue;
    const failures = Number(row.consecutive_failures);
    const lastSuccessAt = row.last_success_at == null ? null : String(row.last_success_at);

    // STOPPED IS NOT ONLY FAILING. A job that never runs throws nothing: a
    // scheduler that never started, a process group serving HTTP without crons,
    // a cron expression that never matches. Silence looks identical to calm.
    //
    // Judged only against a loop that HAS worked before, so a fresh company is
    // never told Foundry has stopped when it has simply not had its first tick.
    // That is the honest half of the question; the other half — a job that has
    // never once succeeded — cannot be told apart from a new install without a
    // deployment clock, and is not guessed at here.
    const silentHours = lastSuccessAt == null ? 0
      : (now.getTime() - Date.parse(`${lastSuccessAt.replace(' ', 'T')}Z`)) / 3_600_000;
    const stale = lastSuccessAt != null && silentHours > loop.staleAfterHours;
    if (failures === 0 && !stale) continue;

    out.push({
      jobName, label: loop.label, consecutiveFailures: failures,
      stoppedRunning: stale && failures === 0,
      lastSuccessAt,
      lastFailureAt: row.last_failure_at == null ? null : String(row.last_failure_at),
      lastErrorName: row.last_error_name == null ? null : String(row.last_error_name),
    });
  }
  return out.sort((a, b) => b.consecutiveFailures - a.consecutiveFailures
    || a.jobName.localeCompare(b.jobName));
}

// ─── THE SAME QUESTION, FOR ONE COMPANY ──────────────────────────────────────
//
// `job_health` answers "is Foundry's scheduled work running". The institution's
// loops run per company, and each company's slice is wrapped so that one
// product's state never stops another's pass — those handlers log and continue,
// so the JOB succeeds while a particular company's loops do nothing.
//
// The founder of that company reads a page saying nothing has stopped. That is
// the defect the loops-stopped card exists for, fixed once at the job level and
// still true one level down.

/**
 * Record how one company's slice of a loop went.
 *
 * A slice FAILED if something in it was already logged as an error. That is the
 * code's own judgement, not a new one: `earnResponsibilityUnderstanding` throws
 * when the facts are not yet sufficient and its handler says so — "That is the
 * normal case and is not an error" — and a slice must not be called failing
 * because a responsibility is not ready.
 *
 * Writing failure is best-effort. This runs inside a job's own error handling,
 * and a health row that cannot be written must never be the thing that stops
 * the loop it is describing.
 */
export async function recordCompanyLoopOutcome(
  productId: string, jobName: string, error: unknown | null,
): Promise<void> {
  try {
    if (error === null) {
      await query(
        `INSERT INTO company_loop_health (product_id,job_name,last_success_at,consecutive_failures)
         VALUES (?,?,datetime('now'),0)
         ON CONFLICT(product_id,job_name) DO UPDATE SET
           last_success_at=datetime('now'), consecutive_failures=0,
           last_error_name=NULL, updated_at=datetime('now')`,
        [productId, jobName]);
      return;
    }
    await query(
      `INSERT INTO company_loop_health
         (product_id,job_name,last_failure_at,consecutive_failures,last_error_name)
       VALUES (?,?,datetime('now'),1,?)
       ON CONFLICT(product_id,job_name) DO UPDATE SET
         last_failure_at=datetime('now'),
         consecutive_failures=company_loop_health.consecutive_failures+1,
         last_error_name=excluded.last_error_name, updated_at=datetime('now')`,
      [productId, jobName, errorName(error)]);
  } catch { /* a health row must never break the loop it describes */ }
}

/**
 * Loops that are failing FOR THIS COMPANY — the job failing everywhere, or this
 * company's own slice failing while the job succeeds.
 *
 * One answer per loop, because the founder's question is about the loop and not
 * about which layer of Foundry noticed. Where both are true the worse count
 * wins, so a company-specific failure can never make a global one look milder.
 *
 * `stoppedRunning` stays a fact about the JOB. A company's slice not running is
 * not something this can see: a company whose slice is skipped writes no row,
 * and absence of a row is a fresh company as much as a stopped one. Claiming
 * staleness from silence is the mistake `getFailingInstitutionLoops` refuses to
 * make above, and it is refused here for the same reason.
 */
export async function getFailingLoopsForCompany(
  productId: string, now: Date = new Date(),
): Promise<LoopHealth[]> {
  const global = await getFailingInstitutionLoops(now);
  const byName = new Map(global.map((l) => [l.jobName, l]));

  const names = Object.keys(INSTITUTION_LOOPS);
  const rows = await query(
    `SELECT job_name,last_success_at,last_failure_at,consecutive_failures,last_error_name
       FROM company_loop_health
      WHERE product_id=? AND consecutive_failures>0
        AND job_name IN (${names.map(() => '?').join(',')})`, [productId, ...names]);

  for (const row of rows.rows as unknown as Array<Record<string, unknown>>) {
    const jobName = String(row.job_name);
    const loop = INSTITUTION_LOOPS[jobName];
    if (!loop) continue;
    const failures = Number(row.consecutive_failures);
    const existing = byName.get(jobName);
    if (existing && existing.consecutiveFailures >= failures) continue;
    byName.set(jobName, {
      jobName, label: loop.label,
      consecutiveFailures: failures,
      stoppedRunning: existing ? existing.stoppedRunning : false,
      lastSuccessAt: row.last_success_at == null ? null : String(row.last_success_at),
      lastFailureAt: row.last_failure_at == null ? null : String(row.last_failure_at),
      lastErrorName: row.last_error_name == null ? null : String(row.last_error_name),
    });
  }
  return [...byName.values()].sort((a, b) => a.jobName.localeCompare(b.jobName));
}
