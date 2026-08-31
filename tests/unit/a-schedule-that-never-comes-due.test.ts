import { describe, it, expect } from 'vitest';
import { CronTime } from 'cron';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

/**
 * A JOB THAT WAS NEVER SCHEDULED LOOKS EXACTLY LIKE A JOB THAT IS FINE.
 *
 * `startScheduler` builds every job inside a try/catch. When a schedule does
 * not parse, `new CronJob` throws, the catch logs it, and the loop moves to the
 * next job. Nothing else happens: the tick never runs, so neither
 * `recordJobSuccess` nor `recordJobFailure` is ever called, and `job_health`
 * gets no row at all. `getFailingInstitutionLoops` says so itself — it cannot
 * see a job that never runs, because absence of a row is also what a fresh
 * install looks like.
 *
 * So the failure is invisible at exactly the moment it matters, and one whole
 * cause of it — the expression itself — is decidable before the code ships.
 * That is what this closes.
 *
 * WHY THE PRODUCTION PARSER AND NOT A REGEX. The question is not "does this
 * look like cron", it is "will the parser that runs in production accept this".
 * A hand-written validator would be a second model of cron, free to agree with
 * the first while both are wrong. `CronTime` is the same class `CronJob`
 * constructs internally, so a schedule this test accepts is a schedule the
 * scheduler accepts, by construction rather than by resemblance.
 */
describe('every job in the registry can actually come due', () => {
  // Parsing is not enough. `0 0 30 2 *` is well-formed and matches no date
  // that will ever exist; `0 0 29 2 *` matches one 547 days out. Both are
  // scheduled without complaint and neither is an operating loop, so the test
  // is next-execution, not syntax. `sendAt()` is what surfaces both — the
  // never-matching one throws there rather than in the constructor.
  const HORIZON_DAYS = 400;

  it('parses under the same parser production uses, and comes due within a year', () => {
    const broken: string[] = [];

    for (const [name, job] of Object.entries(JOB_REGISTRY)) {
      let next: Date | null = null;
      try {
        next = new CronTime(job.schedule, 'UTC').sendAt().toJSDate();
      } catch (err) {
        broken.push(`${name} (${job.schedule}) — does not schedule: ${String(err).slice(0, 90)}`);
        continue;
      }
      const days = (next.getTime() - Date.now()) / 86_400_000;
      if (days > HORIZON_DAYS) {
        broken.push(`${name} (${job.schedule}) — next run is ${Math.round(days)} days away`);
      }
    }

    expect(broken,
      'These jobs are registered but would never run. A schedule that does not parse is ' +
      'caught and logged by startScheduler, and then the job is silently absent — it ' +
      'reports no failures because it never ticks:\n' + broken.join('\n')).toEqual([]);
  });

  it('covers the whole registry rather than a sample of it', () => {
    // A registry that shrank to nothing would pass the assertion above without
    // checking anything. The count is deliberately a floor, not a pin: jobs get
    // added, and a test that has to be edited to add one teaches people to edit
    // tests.
    expect(Object.keys(JOB_REGISTRY).length).toBeGreaterThan(30);
  });
});
