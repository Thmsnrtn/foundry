// =============================================================================
// Tests: a closed vocabulary, and the table that has to cover it.
//
// The assessment indexes a multiplier table by the round it is asked about:
//
//   const mult = ROUND_MULTIPLIERS[targetRound];
//
// An unrecognised round yields `undefined`, and every score computed from it
// becomes NaN — a fundraising readiness report made of nothing. The API route
// that took `target_round` from a caller's request body, and refused a round
// this table cannot score, went with the Commercial Foundry surface; the table
// itself did not, and it still has to cover every round in the vocabulary, or
// the next caller inherits the NaN.
//
// Also proves the orphan is gone: `fundraise_readiness` had a live writer and
// no reader anywhere, which is the class the owner already decided.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const ROUNDS = ['pre_seed', 'seed', 'series_a', 'series_b'];

function sourceFiles(dir = 'src', out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

beforeAll(async () => {
  await runMigrations();
});

describe('the round vocabulary the assessment can score', () => {
  it('covers every round the vocabulary names', () => {
    // A round in the vocabulary that the table lacks is the NaN case waiting
    // for a caller.
    const svc = readFileSync('src/services/scp/investor/fundraising-readiness.ts', 'utf8');
    const table = svc.slice(svc.indexOf('const ROUND_MULTIPLIERS'));
    for (const r of ROUNDS) {
      expect(table.slice(0, table.indexOf('};')), `${r} has no multiplier`)
        .toContain(r);
    }
  });
});

describe('the orphan readiness table is gone', () => {
  it('no longer exists in the schema', async () => {
    const r = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='fundraise_readiness'`, []);
    expect(r.rows).toHaveLength(0);
  });

  it('and nothing in the source still writes it', () => {
    const writers = sourceFiles().filter((f) => {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
      return /INSERT\s+INTO\s+fundraise_readiness\b/i.test(src);
    });
    expect(writers, `still written by ${writers.join(', ')}`).toEqual([]);
  });

  it('but the readiness assessment that still has a reader survives', async () => {
    // Guard against the over-correction. `fundraising_scores` scores readiness
    // for a NAMED ROUND, and `assessFundraisingReadiness` still writes and
    // reads it. Collapsing it into a neighbour because their names rhyme would
    // destroy a distinction rather than remove a duplication.
    //
    // `funding_readiness` was the other half of that pair — "is the company
    // ready to raise at all" — and was checked here beside it. Its readers were
    // Commercial Foundry pages; when they went, nothing in TypeScript named it,
    // and migration 308 dropped it rather than adding the first exception to a
    // ratchet pinned at zero. The distinction was real while both had readers;
    // one of them no longer does.
    for (const t of ['fundraising_scores']) {
      const r = await query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]);
      expect(r.rows, `${t} should still exist`).toHaveLength(1);
    }
  });
});
