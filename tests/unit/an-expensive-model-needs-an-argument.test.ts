import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { FRONTIER_WARRANTS } from '../../src/lib/frontier-warrant.js';

// =============================================================================
// AN EXPENSIVE MODEL NEEDS AN ARGUMENT.
//
// The frontier model costs five times the operational one and twenty-five
// times the cheap one. Nothing stopped a new call site appearing beside an old
// one, and nothing asked the author to say why.
//
// THE TEST HAS TWO HALVES AND THE SECOND IS THE ONE NOBODY CHECKS: being wrong
// must be expensive, AND the occasion must be rare. A question asked nightly
// has, by the end of a year, spent three hundred and sixty-five times whatever
// it costs — and a question good enough to ask every night is almost never
// good enough to ask at frontier prices, because if it were it would be worth
// answering properly once.
//
// These tests hold the table honest in both directions, and hold the gate
// honest too: a gate nobody has watched fail is a gate nobody has tested.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const GATE = join(ROOT, 'scripts/check-frontier-warrant.mjs');
const TABLE = join(ROOT, 'src/lib/frontier-warrant.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every file that actually reaches the frontier, and how many times. */
function callSites(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (rel === 'src/services/ai/client.ts') continue;
    const sites = [...readFileSync(file, 'utf8')
      .matchAll(/(?<![A-Za-z0-9_.])callOpus\s*\(/g)].length;
    if (sites > 0) found.set(rel, sites);
  }
  return found;
}

describe('the table matches the code', () => {
  it('has an entry for every file that reaches the frontier, and no others', () => {
    const sites = callSites();
    expect([...sites.keys()].sort())
      .toEqual(FRONTIER_WARRANTS.map((w) => w.file).sort());
  });

  it('counts the call sites in each, so a new one cannot hide beside an old one', () => {
    const sites = callSites();
    for (const w of FRONTIER_WARRANTS) expect(w.sites).toBe(sites.get(w.file));
  });
});

describe('the warrants are arguments rather than adjectives', () => {
  it('every one says what would go wrong, not that the answer would be better', () => {
    // "Better answers are always available for more money" is not a reason for
    // anything, and it is the sentence this test exists to keep out.
    for (const w of FRONTIER_WARRANTS) {
      expect(w.warrant.length).toBeGreaterThan(80);
      expect(w.warrant.toLowerCase()).not.toMatch(/for (better )?quality\b/);
    }
  });

  it('every one answers the half about frequency as well as the half about cost', () => {
    for (const w of FRONTIER_WARRANTS) {
      expect(w.warrant.toLowerCase()).toMatch(/rare|rarely|cadence|schedule|weekly|window/);
    }
  });

  it('admits its own weakness where the occasion is not rare', () => {
    const watched = FRONTIER_WARRANTS.filter((w) => w.watched);
    expect(watched.length).toBeGreaterThan(0);
    for (const w of watched) {
      expect(w.warrant.toLowerCase()).toMatch(/not clearly pass|weaker|not rare/);
    }
  });
});

describe('the daily compression that started this', () => {
  it('no longer reaches the frontier', () => {
    // A hundred and twenty characters of already-gathered context, asked for
    // every company every day. It was the whole of this institution's frontier
    // spending: sixteen calls and thirty-one cents in the fortnight to 14
    // September 2026.
    const jobs = readFileSync(join(ROOT, 'src/jobs/index.ts'), 'utf8');
    const insight = jobs.slice(jobs.indexOf('export async function dailyInsightGenerate'),
      jobs.indexOf('export async function weeklyPlanGenerate'));
    expect(insight).toContain('callSonnet(');
    expect(insight).not.toMatch(/(?<![A-Za-z0-9_.])callOpus\s*\(/);
  });
});

describe('the gate itself', () => {
  it('passes on the repository as it stands', () => {
    const out = execFileSync('node', [GATE], { encoding: 'utf8' });
    expect(out).toContain('every one with a written warrant');
  });

  it('fails when a warrant is removed, which is the only proof it does anything', () => {
    const original = readFileSync(TABLE, 'utf8');
    const victim = FRONTIER_WARRANTS[0].file;
    const start = original.indexOf(`file: '${victim}'`);
    const entryStart = original.lastIndexOf('{', start);
    const entryEnd = original.indexOf('},', start) + 2;
    try {
      writeFileSync(TABLE, original.slice(0, entryStart) + original.slice(entryEnd));
      expect(() => execFileSync('node', [GATE], { encoding: 'utf8', stdio: 'pipe' }))
        .toThrow();
    } finally {
      writeFileSync(TABLE, original);
    }
    // And the repository is left exactly as it was found.
    expect(readFileSync(TABLE, 'utf8')).toBe(original);
  });

  it('fails when a warrant is emptied to a phrase', () => {
    const original = readFileSync(TABLE, 'utf8');
    try {
      writeFileSync(TABLE, original.replace(
        /warrant: '[\s\S]*?',\n(\s*)(?=watched|\})/, "warrant: 'needed',\n$1"));
      expect(() => execFileSync('node', [GATE], { encoding: 'utf8', stdio: 'pipe' }))
        .toThrow();
    } finally {
      writeFileSync(TABLE, original);
    }
    expect(readFileSync(TABLE, 'utf8')).toBe(original);
  });
});

