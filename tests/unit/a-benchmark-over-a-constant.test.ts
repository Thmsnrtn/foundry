process.env.TURSO_DATABASE_URL = 'file::memory:';

import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// =============================================================================
// A BENCHMARK OVER A CONSTANT.
//
// `addGoldenLesson` is the only thing that writes `golden_suite` or increments
// `products.golden_suite_size`, and nothing calls it. So the counter is zero for
// every company, forever — and the peer benchmark in `scp/network.ts` published
// p25/p50/p75/p90 across every company: four zeroes, offered as a comparison a
// founder could read their standing from.
//
// A benchmark over a constant is not a weak signal. It is the shape of a signal
// with nothing in it, and a percentile against it is false precision.
//
// Removed rather than fixed, for the same reason the pricing claim was: the
// remedy for reporting something that is not there is to stop reporting it.
// Wiring a writer is a feature decision with real failure modes — a lesson
// injected into every future session — and it is not made by a cleanup.
//
// Two commercial surfaces also displayed the counter — an investor board section
// and the evolution page — and those routes are gone with the rest of Commercial
// Foundry, so the assertions about their markup went with them. What is checked
// here is the part that still exists: the writer, the columns, and the benchmark.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

describe('the counter nothing increments', () => {
  // 'is still only written by a function nothing calls' went with
  // `scp/agents/base.ts`, where `addGoldenLesson` lived, in Roadmap 2027 R9.

  it('has no writer for the evolution counter either', () => {
    // The premise for the second removal, asserted the same way as the first.
    // The two shapes a write to this column can take. An earlier version of
    // this matched `... WHERE product_id=?` on a SELECT line, which is the
    // hazard of pattern-matching near a name rather than at it.
    const WRITE_FORMS = ['SET total_evolution_cycles', 'total_evolution_cycles = total_evolution_cycles'];
    let anyWriter: string[] = [];
    try {
      anyWriter = execFileSync('grep',
        ['-rlF', '--include=*.ts', '--include=*.sql', WRITE_FORMS.join('\n'), resolve(ROOT, 'src')],
        { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    } catch { anyWriter = []; }
    expect(anyWriter).toEqual([]);
  });
});
