// =============================================================================
// FOUNDRY — a deploy does not cost a day (Roadmap 2027 R33a).
//
// The daily economic jobs run at fixed minutes. A deploy or a crash that
// restarts the machine across one of those minutes skips it, and nothing ran
// it again until the next day: a forge pass, a settlement, a delivery check
// lost to a restart, silently. So on boot the scheduler asks, once, which daily
// job's last scheduled minute passed with neither a success nor a failure
// recorded since, and runs each of those once, under the same lock.
//
// What it does not do:
// - A job that FAILED since its minute is not re-run: a failure is a result,
//   recorded and shown, and the next scheduled run is its retry.
// - A job that has never run is not started early: a new routine waits for its
//   own schedule.
// - Only daily schedules ("M H * * *"), and only a minute in the last 24 hours.
// - It waits for the job lock's time to live to pass, so a job that was cut
//   off mid-run by the restart is not run twice at once.
// =============================================================================

import { query } from '../../db/client.js';

const DAY = 86_400_000;

/** The most recent minute a daily schedule ("M H * * *", UTC) fell on before `now`, or null when it is not daily. */
export function lastDailyTickBefore(schedule: string, now: Date): Date | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (!m) return null;
  const minute = Number(m[1]); const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
  return today.getTime() <= now.getTime() ? today : new Date(today.getTime() - DAY);
}

const asDate = (v: unknown): Date | null => {
  if (v == null) return null;
  const s = String(v);
  return new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
};

/**
 * WHETHER A DAILY JOB MISSED ITS LAST MINUTE. True only when that minute is in
 * the last 24 hours, the job has run before, and nothing (success or failure)
 * has been recorded for it since.
 */
export function missedItsMinute(input: {
  schedule: string; now: Date; lastSuccessAt: Date | null; lastFailureAt: Date | null;
}): Date | null {
  const tick = lastDailyTickBefore(input.schedule, input.now);
  if (!tick) return null;
  if (input.now.getTime() - tick.getTime() > DAY) return null;
  if (!input.lastSuccessAt && !input.lastFailureAt) return null;
  const since = (d: Date | null) => d !== null && d.getTime() >= tick.getTime();
  if (since(input.lastSuccessAt) || since(input.lastFailureAt)) return null;
  return tick;
}

/** Which registered daily jobs missed their last minute, read from `job_health`. */
export async function jobsThatMissedTheirMinute(
  registry: Record<string, { schedule: string }>, now: Date = new Date(),
): Promise<Array<{ name: string; missed: Date }>> {
  const health = new Map(((await query(
    `SELECT job_name, last_success_at, last_failure_at FROM job_health WHERE retired_at IS NULL`, [])).rows as unknown as Array<Record<string, unknown>>)
    .map((r) => [String(r.job_name), { ok: asDate(r.last_success_at), failed: asDate(r.last_failure_at) }]));
  const out: Array<{ name: string; missed: Date }> = [];
  for (const [name, job] of Object.entries(registry)) {
    const h = health.get(name);
    const missed = missedItsMinute({ schedule: job.schedule, now, lastSuccessAt: h?.ok ?? null, lastFailureAt: h?.failed ?? null });
    if (missed) out.push({ name, missed });
  }
  return out;
}

/** Seconds after boot before catching up: past the job lock's 300-second life, so a cut-off run is not doubled. */
export const CATCH_UP_DELAY_SECONDS = 360;
