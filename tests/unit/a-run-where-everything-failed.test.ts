process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lines: Array<{ level: 'info' | 'error'; text: string }> = [];
vi.mock('../../src/services/logger.js', () => ({
  logger: {
    info: (text: string) => { lines.push({ level: 'info', text }); },
    error: (text: string) => { lines.push({ level: 'error', text }); },
    warn: () => {}, debug: () => {},
  },
}));

const { logSubjectFailure, reportRun } = await import('../../src/jobs/index.js');

// =============================================================================
// A RUN WHERE EVERYTHING FAILED.
//
// Eleven scheduled jobs shared one shape: a loop over products or founders,
// `catch { /* non-fatal per product */ }`, and a closing line reporting only the
// successes. So a run in which EVERY company failed logged the same sentence as
// a run with nothing to do. "Generated 0 compressed briefs" was both "no
// companies" and "every company's weekly brief threw", and nothing anywhere
// distinguished them — the outer try/catch never fires, because the loop
// completes.
//
// The weekly compressed brief is the one page a founder is meant to read in
// three minutes. The priority rebuild is the "One Thing" banner. The founder
// state assessment feeds the interruption ladder that decides what reaches
// their phone. All three could fail for every company, every run, in silence.
//
// `institution/loop-health.ts` exists precisely to separate "nothing happened"
// from "nothing ran" — and it cannot see this, correctly and by design. It
// records the JOB, and the job succeeded. It also scopes itself deliberately to
// the two loops whose silence changes the founder's page, and says so in its
// header, which is why these eleven were not simply added to it: they belong to
// the operator's log, which is exactly where their failures were invisible.
//
// `scp_scenario_refresh` shows the intent that was already there: someone had
// separated "awaiting a stated cash position" from "generated" — two
// non-failure outcomes told apart — while the failure path stayed uncounted
// beside them.
// =============================================================================

beforeEach(() => { lines.length = 0; });

describe('the closing line of a job', () => {
  it('is an ordinary info line when nothing failed', () => {
    reportRun('scp_compressed_brief', 'Generated 12 compressed briefs', 0);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe('info');
    expect(lines[0]!.text).toBe('scp_compressed_brief: Generated 12 compressed briefs');
    expect(lines[0]!.text).not.toContain('failed');
  });

  it('says how many failed, and says it at error level', () => {
    reportRun('scp_compressed_brief', 'Generated 0 compressed briefs', 12);

    expect(lines[0]!.level).toBe('error');
    expect(lines[0]!.text).toBe('scp_compressed_brief: Generated 0 compressed briefs, and 12 failed');
  });

  it('distinguishes a quiet day from a total failure, which was the whole defect', () => {
    reportRun('scp_priority_rebuild', 'Rebuilt 0 priority actions', 0);
    const quiet = lines.pop()!;
    reportRun('scp_priority_rebuild', 'Rebuilt 0 priority actions', 40);
    const broken = lines.pop()!;

    // The same success count. These used to be the same sentence.
    expect(quiet.text).not.toBe(broken.text);
    expect(quiet.level).toBe('info');
    expect(broken.level).toBe('error');
  });
});

describe('one subject that failed', () => {
  it('is named, with what went wrong, at error level', () => {
    logSubjectFailure('scp_founder_state', 'f_123', new Error('column x has no value'));

    expect(lines[0]!.level).toBe('error');
    expect(lines[0]!.text).toContain('f_123');
    expect(lines[0]!.text).toContain('column x has no value');
  });

  it('survives something thrown that is not an Error', () => {
    logSubjectFailure('scp_roi_monthly', 'p_9', 'a bare string');

    expect(lines[0]!.text).toContain('p_9');
    expect(lines[0]!.text).toContain('a bare string');
  });
});

describe('no scheduled job still swallows a per-subject failure', () => {
  const src = readFileSync('src/jobs/index.ts', 'utf8');

  it('leaves none of the eleven behind', () => {
    // An absence claim, so it is asserted against the source directly. The two
    // that remain are a different shape and are documented where they sit: an
    // absent-preferences JSON parse, and `earnResponsibilityUnderstanding`,
    // which throws when the facts are not yet sufficient — the normal case,
    // beside a sibling loop that does log its errors.
    const swallowed = src.split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /\} catch \{ \/\* non-fatal/.test(l));
    expect(swallowed).toEqual([]);
  });

  it('counts and reports failures in every job that loops over subjects', () => {
    // Each of the eleven now declares a failure counter and closes with
    // reportRun. If a twelfth job is added in the old shape, this notices.
    const reportRunCalls = (src.match(/reportRun\('/g) ?? []).length;
    const failureLogs = (src.match(/logSubjectFailure\('/g) ?? []).length;
    expect(reportRunCalls).toBe(11);
    expect(failureLogs).toBe(11);
  });
});
