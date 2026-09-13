import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// =============================================================================
// THE GATE AND THE ENGINE AGREED. NOW THERE IS ONLY THE GATE.
//
// `scripts/audit-public-claims.mjs` runs on every `npm run check` and decides
// whether Foundry's public copy can be traced to its code. It carried an INLINE
// COPY of `src/services/truth/engine.ts`, under a comment saying it was "kept
// dependency-free" — a real constraint, since tsconfig includes only `src/**`,
// so the script cannot import the module and `src/` must not reach into
// `scripts/`. The two copies had drifted: the gate's had no quoted-phrase
// handling, and their stop-word lists were different sets. The gate that
// enforces the honesty law and the module that documented it disagreed about
// what a claim says.
//
// THE SECOND IMPLEMENTATION IS GONE. `src/services/truth/engine.ts` was
// reachable from no entry point and has been deleted, so there is now exactly
// ONE implementation of the honesty law: `scripts/lib/claim-tokenizer.mjs`,
// which the gate imports. The four cases that tokenized every claim through
// both and compared the verdicts have no second side left to compare against,
// and they are gone with the module — the agreement they pinned is not a
// property anything can hold any more.
//
// What is still a live property of a live script is the shape that made the
// drift possible in the first place: the gate must IMPORT its tokenizer rather
// than inline one, and pass its own stop list rather than copy a default. A
// second copy is how this started, and the gate is where it started.
// =============================================================================

describe('the gate keeps its tokenizer in one place', () => {
  it('imports it rather than inlining it', () => {
    const gate = readFileSync('scripts/audit-public-claims.mjs', 'utf8');
    expect(gate).toMatch(/from '\.\/lib\/claim-tokenizer\.mjs'/);
    expect(gate, 'the inlined tokenizer is what drifted')
      .not.toMatch(/function tokenize\(claim\) \{/);
  });

  it('passes its own stop list rather than copying a default', () => {
    const gate = readFileSync('scripts/audit-public-claims.mjs', 'utf8');
    expect(gate).toMatch(/tokenizeClaim\(claim, STOP\)/);
  });
});
