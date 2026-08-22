import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_STOP_WORDS, tokenizeClaim as tokenizeMjs, verifyClaim as verifyMjs,
} from '../../scripts/lib/claim-tokenizer.mjs';
import {
  tokenizeClaim as tokenizeTs, verifyClaim as verifyTs,
} from '../../src/services/truth/engine.js';

// =============================================================================
// THE GATE AND THE ENGINE AGREE.
//
// `scripts/audit-public-claims.mjs` runs on every `npm run check` and decides
// whether Foundry's public copy can be traced to its code. It carried an INLINE
// COPY of `src/services/truth/engine.ts`, under a comment saying it was "kept
// dependency-free" — a real constraint, since tsconfig includes only `src/**`,
// so the script cannot import the module and `src/` must not reach into
// `scripts/`.
//
// THE TWO COPIES HAD DRIFTED:
//
//   • the gate's had NO quoted-phrase handling, so a claim containing "a quoted
//     phrase" was split into words on one side and matched whole on the other;
//   • their stop-word lists were different sets, so different words counted as
//     significant.
//
// The gate that enforces the honesty law and the module that documents it
// disagreed about what a claim says. Two copies are acceptable when they are
// PINNED; two copies nobody compares are one rule with two answers.
//
// The stop-word list is passed in rather than copied, because the two callers
// genuinely want different ones — the pricing audit drops 'plan', 'costs' and
// 'month' as connective words in its domain. A difference that is passed is a
// decision; a difference between two copied constants is an accident.
// =============================================================================

const CLAIMS = [
  'Solo plan costs $79/month',
  'All plans include 12 AI agents',
  '30 founding-rate slots locked at $79/mo for life',
  'We verify every claim against "code-derived sources"',
  'Churn fell 12.5% after the change',
  'A claim with no numbers at all',
  '',
];

const SOURCES = [
  { name: 'pricing', content: 'solo 79 growth 199 investor_ready 399 month plan costs' },
  { name: 'agents', content: '12 AI agents, all plans include them' },
  { name: 'copy', content: 'we verify every claim against code-derived sources' },
];

describe('the two implementations of the honesty law', () => {
  it('tokenize every claim identically', () => {
    for (const claim of CLAIMS) {
      expect(tokenizeMjs(claim), `tokens differ for: ${claim}`)
        .toEqual(tokenizeTs(claim));
    }
  });

  it('reach the same verdict on every claim', () => {
    for (const claim of CLAIMS) {
      expect(verifyMjs(claim, SOURCES), `verdict differs for: ${claim}`)
        .toEqual(verifyTs(claim, SOURCES));
    }
  });

  it('share a stop-word list by value', () => {
    // Not by reference — they are separate modules — but the same set, so the
    // default behaviour cannot drift without this failing.
    const { DEFAULT_STOP_WORDS: _mjs } = { DEFAULT_STOP_WORDS };
    const tsStops = readFileSync('src/services/truth/engine.ts', 'utf8');
    for (const word of _mjs) {
      expect(tsStops, `'${word}' is a stop word in the gate and not in the engine`)
        .toMatch(new RegExp(`'${word}'`));
    }
  });

  it('both match a quoted phrase whole', () => {
    const claim = 'It is a "code-derived source"';
    expect(tokenizeMjs(claim)).toContain('code-derived source');
    expect(tokenizeTs(claim)).toContain('code-derived source');
  });
});

describe('the gate uses the shared implementation', () => {
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
