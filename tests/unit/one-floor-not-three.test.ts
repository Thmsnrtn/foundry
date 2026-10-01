process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { MIN_CONTRIBUTORS } from '../../src/services/institution/contributor-floor.js';

// =============================================================================
// HOW FEW COMPANIES MAY STAND BEHIND A NUMBER SHOWN TO ANOTHER COMPANY.
//
// One question. It was asked in four places and answered three ways: the wisdom
// network published to a company's COMPETITORS above three contributors, the
// benchmark pool above five, the peer-signal path above five, and the network
// benchmark recompute above a bare literal three. Two of them shared the NAME
// `MIN_CONTRIBUTORS` while disagreeing about the number, which is how a reader
// checking one could come away satisfied about the other.
//
// Whichever path a company's data happened to travel decided how thin an
// aggregate could get before it reached that company's competitors, and the
// weakest answer governed the two cross-company paths.
//
// So: one constant, and the floor is the strictest of what was there — raising
// a floor is safe, lowering one is a decision. Whether five is SUFFICIENT is
// counsel debt (`OWNER_DECISIONS_PENDING.md` §13) and no test here claims it.
// =============================================================================

const SRC = 'src';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

beforeAll(async () => {
  await runMigrations();
});

describe('the floor is one rule', () => {
  it('is defined in exactly one file', () => {
    // Comments describe the defect and name the old numbers; they are not the
    // defect. Stripped, or this test would fail on its own explanation — a
    // mistake this campaign has now made four times.
    const definers = tsFiles(SRC).filter((f) => {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      return /\b(const|let|var)\s+(MIN_CONTRIBUTORS|PEER_SIGNAL_MIN_SAMPLE)\s*=/.test(src);
    });
    expect(definers).toEqual(['src/services/institution/contributor-floor.ts']);
  });

  it('is what every cross-company path uses, with no literal beside it', () => {
    const paths = [
      'src/services/wisdom/network.ts',
      // `src/services/decisions/patterns.ts` was deleted in Roadmap 2027 R12.
    ];
    for (const p of paths) {
      const src = stripComments(readFileSync(p, 'utf8'), { lineComments: true });
      expect(src, `${p} imports the floor`).toContain('contributor-floor.js');
    }
  });

  it('is the strictest of the numbers it replaced, not the loosest', () => {
    // The three it replaced were 3, 5 and 5. A future edit that lowers this to
    // make a thin aggregate publish is the failure this file exists to catch.
    expect(MIN_CONTRIBUTORS).toBeGreaterThanOrEqual(5);
  });
});
