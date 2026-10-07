// =============================================================================
// LAW: EVERY CAPABILITY CLAIM CARRIES ITS EVIDENCE LEVEL, AND AN E3 ITS PROOF.
//
// `scripts/check-evidence-levels.mjs` reads the four tables where the
// institution states what it can do (the evidence frontier and the proven list
// in IMPLEMENTATION_STATE, the journeys and loop transitions in MATURITY_MAP).
// This plants each defect it exists to catch into a copy of the documents and
// watches it go red — a gate nobody has seen fail is a gate of unknown worth —
// and proves the real documents pass.
// =============================================================================
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/check-evidence-levels.mjs');
const DOCS = resolve(ROOT, 'docs/foundry-institution');

function run(dir: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, EVIDENCE_DOCS_DIR: dir }, encoding: 'utf8' }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: String(err.stdout ?? '') };
  }
}
function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  for (const f of ['IMPLEMENTATION_STATE.md', 'MATURITY_MAP.md']) copyFileSync(resolve(DOCS, f), join(dir, f));
  return dir;
}
const edit = (dir: string, file: string, from: RegExp | string, to: string): void => {
  const p = join(dir, file);
  const before = readFileSync(p, 'utf8');
  const after = before.replace(from, to);
  expect(after, `the plant changed ${file}`).not.toBe(before);
  writeFileSync(p, after);
};

describe('the evidence-level gate', () => {
  it('passes the documents as they stand', () => {
    const r = run(DOCS);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/every one of \d+ claims in 4 tables carries a level/);
  });

  it('fails a journey whose level was removed', () => {
    const dir = copy();
    edit(dir, 'MATURITY_MAP.md', /^(\| J1 \|(?:[^|]*\|){4}) \*\*E2\*\* \|/m, '$1 — |');
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/MATURITY_MAP\.md · J1: no evidence level/);
  });

  it('fails a claim of E3 with nothing to look at', () => {
    const dir = copy();
    edit(dir, 'MATURITY_MAP.md', /^(\| L2 \|(?:[^|]*\|){2}) \*\*E2\*\* \|/m, '$1 **E3** |');
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/L2: claims E3 with no pointer/);
  });

  it('does not take an E-level mentioned elsewhere in a row for the row\'s level', () => {
    const dir = copy();
    edit(dir, 'MATURITY_MAP.md', /^(\| J2 \|(?:[^|]*\|){4}) \*\*E2\*\* \|([^\n]*)$/m, '$1 — |$2 (E2 elsewhere)');
    expect(run(dir).out).toMatch(/J2: no evidence level/);
  });

  it('fails when a table it reads is gone, rather than reading nothing and passing', () => {
    const dir = copy();
    edit(dir, 'IMPLEMENTATION_STATE.md', '## Evidence frontier (do not inflate)', '## Evidence, somewhere');
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/the table under "## Evidence frontier \(do not inflate\)" is gone/);
  });
});
