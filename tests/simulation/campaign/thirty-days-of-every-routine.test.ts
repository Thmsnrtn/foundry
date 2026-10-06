// =============================================================================
// THIRTY DAYS OF EVERY ROUTINE — all thirty-six, every morning, under the lock.
//
// The existing month-long simulations run the hand-picked MORNING and HANDS
// lists. Production runs the whole registry, through `runScheduledJob`: lock,
// run, record, release. This drives every registered routine through a mirror
// of that door for thirty simulated days against a production-shaped world
// with the model abstaining, and keeps a day × job record of what each one did.
//
// A routine that refuses for a governed reason (no key, not entitled, a
// ceiling) has done its job and is recorded as a refusal, never as green. A
// routine that throws a TypeError or a SQL error has a defect, and that is a
// finding. Then: the health rows, the loop report, the owner's pages when one
// loop goes quiet for three days, and whether the lock stops a second run.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/db/client.js';
import { providerStubs } from '../../helpers/provider-stubs.js';
import { OWNER, advanceDays, asText, owner, ownerApp, seedProductionShape } from '../../helpers/world.js';
import { GLYPH, recordFinding, runUnderLock, type RunOutcome } from './campaign-helpers.js';

const { fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => say({ abstain: 'nothing coherent to read here' })),
  callOpus: vi.fn(async () => say({ abstain: 'nothing coherent to read here' })),
}));
afterAll(() => { vi.unstubAllGlobals(); });

const DAYS = 30;
/** The routine deliberately left unticked for the last three days, to see who notices. */
const SILENCED = 'experiment_hand_tick';
const SILENT_FROM = DAYS - 2; // days 28, 29, 30

let jobs: string[] = [];
const matrix = new Map<string, RunOutcome[]>(); // job -> one outcome per day
const defects: Array<{ day: number } & RunOutcome> = [];
let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;

beforeAll(async () => {
  await seedProductionShape({ charter: true, searching: true, eyes: true });
  app = await ownerApp();
  me = owner(app);
  const { JOB_REGISTRY } = await import('../../../src/jobs/index.js');
  jobs = Object.keys(JOB_REGISTRY);
  for (const j of jobs) matrix.set(j, []);
}, 120_000);

describe('the registry is the population', () => {
  it('holds thirty-six routines, and none of them is a retired name', async () => {
    const { JOB_REGISTRY, RETIRED_LOOPS } = await import('../../../src/jobs/index.js');
    expect(jobs.length).toBe(36);
    expect(jobs.filter((j) => j in RETIRED_LOOPS)).toEqual([]);
    expect(Object.values(JOB_REGISTRY).every((e) => typeof e.fn === 'function')).toBe(true);
  });
});

describe('thirty days, every routine, under the lock', () => {
  it('runs all thirty days; no routine fails for a reason that is a code defect', async () => {
    for (let day = 1; day <= DAYS; day++) {
      await advanceDays(1);
      for (const job of jobs) {
        if (job === SILENCED && day >= SILENT_FROM) {
          matrix.get(job)!.push({ job, state: 'locked', errorName: null, message: 'deliberately not ticked', ms: 0 });
          continue;
        }
        const out = await runUnderLock(job);
        matrix.get(job)!.push(out);
        if (out.state === 'defect') defects.push({ day, ...out });
      }
    }
    // The matrix, for whoever reads the run.
    const width = Math.max(...jobs.map((j) => j.length));
    process.stdout.write(`\nday × routine (${String(DAYS)} days; . ok  R refused  X defect  L not run)\n`);
    for (const job of jobs) {
      const row = matrix.get(job)!;
      const glyphs = row.map((o) => (job === SILENCED && o.message === 'deliberately not ticked' ? '-' : GLYPH[o.state])).join('');
      const refusals = row.filter((o) => o.state === 'refused');
      const why = refusals.length ? `  (${refusals[0]!.errorName}: ${String(refusals[0]!.message).slice(0, 90)})` : '';
      const ms = Math.round(row.reduce((a, o) => a + o.ms, 0) / Math.max(1, row.length));
      process.stdout.write(`${job.padEnd(width)}  ${glyphs}  ~${String(ms)}ms${why}\n`);
    }
    // Every distinct defect is one finding, with the first day it appeared.
    const seen = new Set<string>();
    for (const d of defects) {
      const key = `${d.job}|${d.errorName}|${String(d.message).slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recordFinding({ id: `F-ROUTINES-${String(seen.size)}`, sev: 'P1', area: `jobs/${d.job}`,
        title: `${d.job} throws ${d.errorName ?? 'Error'} on a production-shaped day`,
        evidence: `day ${String(d.day)}: ${String(d.message).slice(0, 300)}` });
    }
    expect(defects.map((d) => `${d.job} day ${String(d.day)}: ${d.errorName ?? ''}: ${String(d.message).slice(0, 160)}`)).toEqual([]);
  }, 900_000);

  it('(b) after day 1 every routine has a job_health row — a routine that ran is a routine that was recorded', async () => {
    const rows = (await query('SELECT job_name FROM job_health', [])).rows as unknown as Array<{ job_name: string }>;
    const have = new Set(rows.map((r) => r.job_name));
    expect(jobs.filter((j) => !have.has(j))).toEqual([]);
  });

  it('(c) by day 30 the loop report names exactly the watched loops that are failing or silent, and nothing else', async () => {
    const { INSTITUTION_LOOPS, getFailingInstitutionLoops } = await import('../../../src/services/institution/loop-health.js');
    const failing = await getFailingInstitutionLoops();
    const expectFailing = Object.keys(INSTITUTION_LOOPS).filter((j) => {
      const last = matrix.get(j)?.at(-1);
      return last && (last.state === 'refused' || last.state === 'defect');
    });
    const reported = failing.filter((l) => l.consecutiveFailures > 0).map((l) => l.jobName).sort();
    expect(reported).toEqual(expectFailing.sort());
    // And the one not ticked for three days is reported as stopped, not failing.
    const silent = failing.find((l) => l.jobName === SILENCED);
    expect(silent?.stoppedRunning).toBe(true);
    expect(silent?.consecutiveFailures).toBe(0);
    // Consecutive counts agree with the matrix: the run of refusals at the end of each watched row.
    for (const l of failing.filter((x) => x.consecutiveFailures > 0)) {
      const row = matrix.get(l.jobName)!;
      let run = 0;
      for (let i = row.length - 1; i >= 0 && row[i]!.state !== 'ok'; i--) run++;
      expect({ job: l.jobName, consecutive: l.consecutiveFailures }).toEqual({ job: l.jobName, consecutive: run });
    }
  });

  it('(d) Home names the loop that has been quiet for three days, in its own words', async () => {
    // `asText` leaves numeric entities (&#39;) in place; decode them so the pulse's apostrophe reads.
    const home = asText(await me.page('/foundry')).replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
    const { INSTITUTION_LOOPS, getFailingInstitutionLoops } = await import('../../../src/services/institution/loop-health.js');
    const label = INSTITUTION_LOOPS[SILENCED]!.label;
    const cap = label.charAt(0).toUpperCase() + label.slice(1);
    const { howFoundryIsRunning } = await import('../../../src/services/founder/health.js');
    const pulse = await howFoundryIsRunning(OWNER);
    // The pulse knows (it is what `howFoundryIsRunning` returns); the question is whether the first screen says it.
    expect(pulse.sentence).toContain(`${cap} has not run when it should have`);
    const named = home.toLowerCase().includes(label.toLowerCase());
    process.stdout.write(`Home on the loop: ${named ? 'names it' : 'does not name it'} — ${(/(Stopped Foundry hasn't[^.]*\.[^.]*\.)|((Separately: )?\d+ routines? of mine (has|have) (stopped|failed)[^.]*\.)/.exec(home)?.[0] ?? '(no routine sentence)').slice(0, 240)}\n`);
    if (!named) {
      const said = /(Separately: )?\d+ routines? of mine (has|have) (stopped|failed)[^.]*\./.exec(home)?.[0] ?? '(no routine sentence at all)';
      const report = await getFailingInstitutionLoops();
      recordFinding({ id: 'F-ROUTINES-2', sev: 'P2', area: 'routes/dashboard/foundry-shell (Home)',
        title: 'Home neither names a loop that has stopped running nor counts it: its routine count reads consecutive_failures > 0 only',
        evidence: `${SILENCED} silent 3 days (staleAfterHours ${String(INSTITUTION_LOOPS[SILENCED]!.staleAfterHours)}): getFailingInstitutionLoops reports ${String(report.length)} loops (${report.map((l) => `${l.jobName}${l.stoppedRunning ? ' stopped' : ` ×${String(l.consecutiveFailures)}`}`).join(', ')}) and the pulse says "${pulse.sentence}"; Home says "${said}" — the pulse line renders only when nothing needs him (attention === null), and routinesFailing is SELECT job_name FROM job_health WHERE consecutive_failures > 0, which a loop that has simply stopped never satisfies` });
    }
    expect(named).toBe(true);
  });

  it('(d) the absence page names the same loop as evidence, with what would fix it', async () => {
    const r = await app.request('/foundry/absence');
    expect(r.status).toBe(200);
    const text = asText(await r.text());
    const { INSTITUTION_LOOPS } = await import('../../../src/services/institution/loop-health.js');
    expect(text).toContain(`${INSTITUTION_LOOPS[SILENCED]!.label}: has not run since`);
    expect(text).toContain(`get ${SILENCED} running again`);
  });
});

describe('(e) the lock', () => {
  // PINNED DEFECT F-ROUTINES-LOCK-1 (it.fails): this asserts the CORRECT
  // behaviour and fails today. When job-lock.ts refuses a second holder in the
  // same process, vitest reports this as an unexpected pass — change it.fails
  // back to it then. (Corrected 2026-10-06 by the independent audit: the test
  // holds the lock itself, so a correct lock refuses BOTH runs, not one.)
  it.fails('while a run of a routine is in progress, no further run of it starts — in this process or any other', async () => {
    // A routine that takes measurable time, so the two overlap for certain:
    // the first run is held open by a lock we take ourselves, exactly as the
    // helper takes it, then both runners are started at once.
    const { acquireJobLock, releaseJobLock } = await import('../../../src/services/job-lock.js');
    const job = 'slo_check';
    expect(await acquireJobLock(job)).toBe(true);
    const held = (await query('SELECT locked_by FROM job_locks WHERE job_name = ?', [job])).rows[0] as Record<string, unknown>;
    // While this process holds the lock, the scheduler's door in the SAME process asks for it again.
    const [a, b] = await Promise.all([runUnderLock(job), runUnderLock(job)]);
    await releaseJobLock(job).catch(() => undefined);
    const refused = [a, b].filter((o) => o.state === 'locked').length;
    if (refused === 0) {
      recordFinding({ id: 'F-ROUTINES-LOCK-1', sev: 'P1', area: 'services/job-lock',
        title: 'the job lock does not stop a second run of the same routine inside one process',
        evidence: `job_locks held by ${String(held.locked_by)}; two concurrent runUnderLock('${job}') both ran (states ${a.state}/${b.state}). `
          + 'acquireJobLock keys ownership on one INSTANCE_ID per process, so the ON CONFLICT no-op is followed by SELECT locked_by = INSTANCE_ID, which is true for the holder itself. '
          + 'A cron tick that overlaps its own previous run (an hourly routine that takes longer than an hour, or the boot catch-up firing while the tick runs) is not prevented.' });
    }
    expect({ refused, states: [a.state, b.state] }).toEqual({ refused: 2, states: ['locked', 'locked'] });
  });

  it('the lock is released after a run, so the next morning is not refused', async () => {
    const locks = (await query('SELECT job_name FROM job_locks', [])).rows;
    expect(locks).toEqual([]);
    const again = await runUnderLock('slo_check');
    expect(again.state).not.toBe('locked');
  });
});

describe('what the month left behind', () => {
  it('no routine wrote to a stranger: every outbound action is under the one approved test, and the world reads the pulse as a whole', async () => {
    const strangers = (await query(
      `SELECT COUNT(*) AS n FROM outbound_actions o LEFT JOIN venture_experiments e ON e.id = o.experiment_id
        WHERE o.status = 'executed' AND o.action_type = 'send_email' AND (e.id IS NULL OR e.founder_id <> ?)`, [OWNER])).rows[0] as Record<string, unknown>;
    expect(Number(strangers.n)).toBe(0);
    const { howFoundryIsRunning } = await import('../../../src/services/founder/health.js');
    const pulse = await howFoundryIsRunning(OWNER);
    expect(pulse.state).toBe('stopped');
    expect(pulse.stoppedLoop?.jobName).toBe(SILENCED);
  });
});
