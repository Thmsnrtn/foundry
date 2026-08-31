// =============================================================================
// Tests: a closed vocabulary at an open boundary.
//
// `POST /api/products/:id/fundraise-readiness` takes `target_round` from an
// API caller's request body. The canonical assessment indexes a multiplier
// table by that value:
//
//   const mult = ROUND_MULTIPLIERS[targetRound];
//
// An unrecognised round yields `undefined`, and every score computed from it
// becomes NaN — a fundraising readiness report made of nothing, returned with
// a 200 and persisted. The caller is outside; the vocabulary is closed; the
// boundary is where that gets checked.
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

describe('the round vocabulary is checked where it arrives', () => {
  it('is the same set the assessment can actually score', () => {
    // The route's list and the multiplier table must not drift apart: a round
    // the route accepts and the table lacks is the NaN case with extra steps.
    const svc = readFileSync('src/services/scp/investor/fundraising-readiness.ts', 'utf8');
    const table = svc.slice(svc.indexOf('const ROUND_MULTIPLIERS'));
    for (const r of ROUNDS) {
      expect(table.slice(0, table.indexOf('};')), `${r} is accepted but has no multiplier`)
        .toContain(r);
    }
    const route = readFileSync('src/routes/api/platform.ts', 'utf8');
    for (const r of ROUNDS) expect(route).toContain(`'${r}'`);
  });

  it('rejects a round the assessment cannot score, rather than computing NaN', () => {
    // The guard is at the boundary and reads as a refusal, not a default. A
    // silent fallback to 'seed' would answer a question nobody asked.
    const route = readFileSync('src/routes/api/platform.ts', 'utf8');
    const handler = route.slice(route.indexOf("'/api/products/:id/fundraise-readiness'"));
    const body = handler.slice(0, handler.indexOf('});'));
    expect(body).toMatch(/return c\.json\(\s*\{\s*error:/);
    expect(body, 'an unrecognised round must not be coerced into a valid one')
      .toContain('must be one of');
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

  it('but the two readiness assessments that answer different questions both survive', async () => {
    // Guard against the over-correction. `fundraising_scores` scores readiness
    // for a NAMED ROUND; `funding_readiness` answers whether the company is
    // ready to raise at all. Both have readers. Collapsing them because their
    // names rhyme would destroy a distinction, not remove a duplication.
    for (const t of ['fundraising_scores', 'funding_readiness']) {
      const r = await query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]);
      expect(r.rows, `${t} should still exist`).toHaveLength(1);
    }
  });
});
