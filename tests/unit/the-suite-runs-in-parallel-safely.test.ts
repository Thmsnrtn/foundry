// =============================================================================
// THE SUITE RUNS IN PARALLEL SAFELY, OR IT DOES NOT RUN IN PARALLEL.
//
// `npm run test:ci` (scripts/run-suite.mjs) runs the gates file beside two
// shards of everything else, then the files that write into the real tree on
// their own. That is safe only while the list of those files is complete. A
// test that writes a file without first making a temporary directory is
// writing into the tree everyone else reads, and it belongs in `PLANTERS`.
// This file fails until it is there. It also fails if the list names a file
// that no longer exists, so the list cannot rot quietly.
// =============================================================================
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../..');

describe('the parallel phase is safe', () => {
  it('lists every test that writes into the real tree', async () => {
    const { GATES, PLANTERS } = await import('../../scripts/suite-plan.mjs') as { GATES: string; PLANTERS: string[] };
    const writers = readdirSync(resolve(REPO, 'tests/unit'))
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => `tests/unit/${f}`)
      .filter((f) => {
        const src = readFileSync(resolve(REPO, f), 'utf8');
        return /\bwriteFileSync\b/.test(src) && !/\bmkdtempSync\b/.test(src);
      });
    const unlisted = writers.filter((f) => f !== GATES && !PLANTERS.includes(f));
    expect(unlisted, 'writes into the real tree but would run in the parallel phase').toEqual([]);
  });

  it('names only files that exist', async () => {
    const { GATES, PLANTERS } = await import('../../scripts/suite-plan.mjs') as { GATES: string; PLANTERS: string[] };
    for (const f of [GATES, ...PLANTERS]) expect(existsSync(resolve(REPO, f)), f).toBe(true);
  });

  it('is what the check runs', () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:ci']).toBe('node scripts/run-suite.mjs');
    expect(pkg.scripts.check).toContain('npm run test:ci');
  });
});
