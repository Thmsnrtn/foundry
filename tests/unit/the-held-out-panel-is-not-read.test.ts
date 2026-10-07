// =============================================================================
// LAW: THE HELD-OUT BUYERS ARE READ BY THE JUDGING HARNESS AND NOTHING ELSE.
//
// A held-out panel is only held out while nothing that makes products — the
// institution, the brains that stand in for its model, or their tests — can
// see it. So the whole population of code this repository runs (every source
// file under src/, tests/ and scripts/) is read, and any file that names the
// held-out bank fails this test unless it is the one harness that judges with
// it, the generator that wrote it, or this test.
//
// NOT VACUOUS: the scan must have read the tree (a floor on files read), the
// harness must itself be found naming the bank (a matcher that stopped
// matching would otherwise look like a clean tree), and the bank must exist
// with personas from every segment.
// =============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const NAMES_THE_BANK = /held-out\.json|buyer-panel-bank[^\n]{0,80}held-out/;
const MAY_READ = new Set([
  'tests/simulation/panel/judges.ts',
  'tests/simulation/panel/generate-bank.mts',
  'tests/unit/the-held-out-panel-is-not-read.test.ts',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    if (e === 'node_modules' || e.startsWith('.')) return [];
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|mts|mjs|js|cjs)$/.test(e) ? [p] : [];
  });
}

describe('the held-out panel', () => {
  const files = ['src', 'tests', 'scripts'].flatMap((d) => walk(resolve(ROOT, d))).map((p) => relative(ROOT, p));
  const naming = files.filter((f) => NAMES_THE_BANK.test(readFileSync(resolve(ROOT, f), 'utf8')));

  it('is named by the judging harness and its generator only', () => {
    expect(naming.filter((f) => !MAY_READ.has(f))).toEqual([]);
  });

  it('the scan read the tree, and found the harness that does read it', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(naming).toContain('tests/simulation/panel/judges.ts');
  });

  it('holds three people from every segment, and none of them is in the working set', () => {
    const held = (JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/buyer-panel-bank', 'held-out.json'), 'utf8')) as { personas: Array<{ id: string; segment: string }> }).personas;
    const working = (JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/buyer-panel-bank/working.json'), 'utf8')) as { personas: Array<{ id: string }> }).personas;
    expect(held.length + working.length).toBeGreaterThanOrEqual(60);
    const bySegment = new Map<string, number>();
    for (const p of held) bySegment.set(p.segment, (bySegment.get(p.segment) ?? 0) + 1);
    expect([...bySegment.values()].every((n) => n === 3)).toBe(true);
    expect(bySegment.size).toBe(7);
    expect(working.filter((w) => held.some((h) => h.id === w.id))).toEqual([]);
  });
});
