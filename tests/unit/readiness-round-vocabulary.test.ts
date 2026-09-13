// =============================================================================
// Tests: the orphan readiness table is gone, and stays gone.
//
// THE ASSESSMENT ITSELF IS GONE. `scp/investor/fundraising-readiness.ts` held
// `ROUND_MULTIPLIERS`, a table indexed by the round the caller asked about, and
// an unrecognised round yielded `undefined` and turned every score into NaN.
// The API route that fed it a caller's `target_round` went with the Commercial
// Foundry surface; the module has now followed it, reachable from no entry
// point, so the case that pinned the multiplier table against the round
// vocabulary went with the file it was reading. The NaN cannot be reached by
// anything, because there is nothing left to reach it with.
//
// What remains is the orphan: `fundraise_readiness` had a live writer and no
// reader anywhere, which is the class the owner already decided, and migration
// 165 dropped it. These cases keep it dropped and keep it unwritten.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

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
});
