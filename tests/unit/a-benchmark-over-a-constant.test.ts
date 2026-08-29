process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A BENCHMARK OVER A CONSTANT, AND A ZERO SHOWN TO INVESTORS.
//
// `addGoldenLesson` is the only thing that writes `golden_suite` or increments
// `products.golden_suite_size`, and nothing calls it. So the counter is zero for
// every company, forever — and three surfaces presented it:
//
//   • the investor board section, as a large number labelled "Golden Lessons";
//   • the peer benchmark, where p25/p50/p75/p90 across every company were four
//     zeroes published as a comparison a founder could read their standing from;
//   • the evolution page, which now says in its own copy that nothing writes one.
//
// A benchmark over a constant is not a weak signal. It is the shape of a signal
// with nothing in it, and a percentile against it is false precision.
//
// Removed rather than fixed, for the same reason the pricing claim was: the
// remedy for reporting something that is not there is to stop reporting it.
// Wiring a writer is a feature decision with real failure modes — a lesson
// injected into every future session — and it is not made by a cleanup.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

describe('the counter nothing increments', () => {
  it('is still only written by a function nothing calls', () => {
    // The premise. If this ever stops being true, the removals below should be
    // revisited rather than left — and this is what will say so.
    const base = read('src/services/scp/agents/base.ts');
    expect(base).toContain('golden_suite_size = golden_suite_size + 1');
    // COMMENTS ARE NOT CALLS. Several files name this function while
    // explaining that nothing calls it — including this one — so the mentions
    // are stripped before counting, which is the house rule for any scan that
    // reads source.
    const mentions = ['src', 'tests', 'scripts'].flatMap((dir) => {
      try {
        return execFileSync('grep',
          ['-rl', '--include=*.ts', '--include=*.mjs', 'addGoldenLesson', resolve(ROOT, dir)],
          { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      } catch { return []; }
    });
    // A NAME PASSED AS A STRING IS NOT A CALL. This file, the claim test and
    // the claims gate all name the function as data while checking that nothing
    // invokes it, so the subject is `addGoldenLesson(` — the definition and any
    // real call — and everything else is a mention.
    // Built from fragments so this file does not match its own needle — the
    // same trick `gates-fail-when-they-should.test.ts` uses to keep a scanner
    // from seeing a fixture as a real offender.
    const CALL = ['addGolden', 'Lesson', '('].join('');
    const callers = mentions
      .filter((f) => stripComments(readFileSync(f, 'utf8')).includes(CALL))
      .map((f) => f.replace(`${ROOT}/`, ''));
    expect(callers).toEqual(['src/services/scp/agents/base.ts']);
  });

  it('is not benchmarked across companies', () => {
    const network = read('src/services/scp/network.ts');
    expect(network).not.toContain("{ name: 'golden_suite_size'");
    // And the per-company reporter does not ask for a benchmark that is no
    // longer written, which would have reported "no data" as the 50th percentile.
    expect(network).not.toContain("positionFromBenchmark(goldSuiteSize");
  });

  it('is not shown to investors as a number they could read meaning into', () => {
    expect(read('src/routes/dashboard/investors.ts')).not.toContain('Golden Lessons');
  });

  it('is still explained where a founder might look for it', () => {
    // Removing every trace would leave a founder who reads the evolution page
    // wondering why the count never moves. That page says why.
    expect(read('src/routes/dashboard/agents.ts'))
      .toContain('Nothing writes one yet');
  });
});
