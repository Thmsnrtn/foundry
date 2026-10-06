// =============================================================================
// A WORLD IS SEEDED WITHIN A STATED BUDGET (remediation 3, 6 October 2026).
//
// Vitest 4 fails a hook that overruns its timeout, where vitest 1 let it
// finish. A `beforeAll` that seeds the production world — migrations, the
// owner, Experiment 001 settled by the world, the charter, the search, the
// eyes — takes two to six seconds on a quiet machine and well past the
// ten-second default with three suite processes migrating databases at once.
// Thirty-one files relied on the default: each a red `npm run check` on a
// loaded box that would pass when rerun, which is how a real failure learns to
// look like a flake.
//
// So every hook that seeds a world says how long it may take, in the call
// itself (or the file raises `hookTimeout` for all of them). This is a ratchet
// at zero: a new file that seeds a world on the default fails here, by name.
// =============================================================================
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(import.meta.dirname);
const SEEDS = /seedProductionShape|seedWorld|runMorning|advanceDays/;

/** Every `beforeAll(...)` call in a source, as its full text. */
function beforeAlls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/beforeAll\(/g)) {
    let i = m.index! + m[0].length; let depth = 1;
    while (depth > 0 && i < src.length) {
      const ch = src[i];
      if (ch === '(') depth += 1; else if (ch === ')') depth -= 1;
      i += 1;
    }
    out.push(src.slice(m.index!, i));
  }
  return out;
}

/** The files with a world-seeding hook that states no budget. */
export function unbudgeted(files: Array<[string, string]>): string[] {
  return files.filter(([, src]) => !/hookTimeout/.test(src)
    && beforeAlls(src).some((b) => SEEDS.test(b) && !/,\s*[\d_]+\s*\)$/.test(b)))
    .map(([name]) => name);
}

describe('hooks that seed a world', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(resolve(DIR, f), 'utf8')] as [string, string]);

  it('there are such hooks, or this proves nothing', () => {
    expect(files.filter(([, s]) => beforeAlls(s).some((b) => SEEDS.test(b))).length).toBeGreaterThan(20);
  });

  it('every one states how long it may take', () => {
    expect(unbudgeted(files)).toEqual([]);
  });

  it('a hook on the default is caught; one with a budget, or under a file-wide hookTimeout, is not', () => {
    const onDefault = "beforeAll(async () => {\n  await seedProductionShape({});\n});";
    const budgeted = "beforeAll(async () => {\n  await seedProductionShape({});\n}, 180_000);";
    const fileWide = "vi.setConfig({ hookTimeout: 180_000 });\n" + onDefault;
    const unrelated = "beforeAll(async () => {\n  await runMigrations();\n});";
    expect(unbudgeted([['a', onDefault], ['b', budgeted], ['c', fileWide], ['d', unrelated]])).toEqual(['a']);
  });
});
