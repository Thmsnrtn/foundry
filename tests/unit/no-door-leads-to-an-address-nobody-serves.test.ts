// =============================================================================
// NO DOOR LEADS TO AN ADDRESS NOBODY SERVES.
//
// `/dashboard` was the commercial product's home. It is not mounted in this
// institution — production answers it 404 — yet thirteen places still sent the
// owner there: the redirect when no company is selected on six Connections and
// Letter routes, two notification buttons ("View Signal", "See the week"), and
// the page a member sees when their access does not include something. Each
// was a door into a wall. They go to Home now, and this keeps them there.
// =============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../src');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});

describe('the owner is never sent to /dashboard', () => {
  it('no redirect, link or notification names it', () => {
    const offenders = walk(ROOT).flatMap((f) => readFileSync(f, 'utf8').split('\n')
      .map((line, i) => ({ f, i: i + 1, line }))
      .filter(({ line }) => /redirect\(['"]\/dashboard['"]\)|actionUrl:\s*['"]\/dashboard['"]|href=\\?["']\/dashboard["']/.test(line)))
      .map(({ f, i }) => `${f.replace(ROOT, 'src')}:${String(i)}`);
    expect(offenders).toEqual([]);
  });
});
