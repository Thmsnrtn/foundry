process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// ACTED ON, OR ACCOUNTED FOR.
//
// `shadow_expectation` and `shadow_comparison` are written to
// `reconstruction_claims` and no consumer filters on either predicate. Every
// reader of that table selects by predicate — `responsibility-understanding.ts`
// against UNDERSTANDING_FACTS, `institutional-judgment-disposition.ts` against
// `later_reality_comparison`, `development-disposition.ts` against
// `development_need` — and neither name appears in any of those lists.
//
// The frontier carried this as "say so where they are written, or stop writing
// them", and the answer is to say so. The OPERATIONAL copy of each fact is a
// dedicated row — `responsibility_shadow_expectations` and
// `responsibility_shadow_comparisons` — which the comparison and
// `assisting-admission` really do read. The claim is the PROVENANCE copy: what
// Foundry knows, with evidence refs back to the founder's authenticated
// statement and to the independent observations.
//
// Two records of one fact is a shape this campaign normally treats as a defect,
// which is exactly why the distinction has to be written down rather than
// assumed: one is acted on, one is accounted for. This test holds the claim
// that no consumer reads them — so if that stops being true, the comment
// explaining why it does not matter fails with it.
// =============================================================================

function serviceSources(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push(p);
    }
  };
  walk('src');
  return out;
}

describe('the two shadow claims', () => {
  const PREDICATES = ['shadow_expectation', 'shadow_comparison'];

  it('are written exactly where the comment says they are', () => {
    const writers = serviceSources().filter((f) =>
      PREDICATES.some((p) => new RegExp(`predicate: '${p}'`).test(
        stripComments(readFileSync(f, 'utf8'), { lineComments: true }))));
    expect(writers).toEqual(['src/services/institution/external-shadowing.ts']);
  });

  it('are read by no consumer, which is the claim the comment rests on', () => {
    // A reader must NAME the predicate as a quoted string to select on it.
    // Matching the bare word would catch the table names
    // (`responsibility_shadow_expectations`) and the evidence-ref string
    // `shadow_comparison:<id>` in `responsibility-assisting.ts`, none of which
    // are claim reads. `support-pilot-readiness.ts` quotes 'shadow_comparison'
    // as a BENCHMARK DIMENSION NAME, which is also not a claim read.
    const readers = serviceSources().filter((f) => {
      if (f === 'src/services/institution/external-shadowing.ts') return false;
      if (f === 'src/services/institution/support-pilot-readiness.ts') return false;
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      return PREDICATES.some((p) => new RegExp(`'${p}'`).test(src));
    });
    expect(readers, 'if one appears, read the claim rather than the operational row')
      .toEqual([]);
  });

  it('are absent from every predicate list a decision turns on', () => {
    const understanding = stripComments(
      readFileSync('src/services/institution/responsibility-understanding.ts', 'utf8'),
      { lineComments: true });
    const facts = understanding.slice(understanding.indexOf('UNDERSTANDING_FACTS'),
      understanding.indexOf('as const'));
    for (const p of PREDICATES) expect(facts).not.toContain(p);
  });

  it('have an operational copy that IS read', () => {
    const admission = stripComments(
      readFileSync('src/services/institution/assisting-admission.ts', 'utf8'),
      { lineComments: true });
    expect(admission, 'the row is what decides whether shadowing was long enough')
      .toMatch(/responsibility_shadow_comparisons/);

    const shadowing = stripComments(
      readFileSync('src/services/institution/external-shadowing.ts', 'utf8'),
      { lineComments: true });
    expect(shadowing).toMatch(/responsibility_shadow_expectations/);
  });

  it('say which copy is which, where they are written', () => {
    const src = readFileSync('src/services/institution/external-shadowing.ts', 'utf8');
    expect(src).toMatch(/NOTHING FILTERS ON THIS PREDICATE/);
    expect(src).toMatch(/is acted on, one is accounted for/);
  });
});
