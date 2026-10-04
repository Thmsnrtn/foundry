import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// A KNOWN HOLE IS WRITTEN DOWN, OR IT FAILS (Roadmap 2027 R2).
//
// CI's dependency audit ended in `|| true`, so it could never fail.
// `check-dependency-advisories.mjs` replaces it, and a gate that has never
// failed is indistinguishable from one that cannot: each case below plants a
// report and asserts the exit code.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const GATE = join(ROOT, 'scripts/check-dependency-advisories.mjs');
const dir = mkdtempSync(join(tmpdir(), 'advisories-'));

const advisory = (id: string, severity = 'high') => ({
  name: 'pkg', severity, title: 'planted', url: `https://github.com/advisories/${id}` });
const ACCEPTED = ['GHSA-qjx8-664m-686j', 'GHSA-5xrq-8626-4rwp', 'GHSA-fx2h-pf6j-xcff', 'GHSA-vfj7-8cjw-p6xm'];

function run(vias: object[]): number {
  const file = join(dir, `${String(Math.random()).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ vulnerabilities: { pkg: { severity: 'high', via: vias } } }));
  try { execFileSync('node', [GATE, '--report', file], { stdio: 'pipe' }); return 0; }
  catch (err) { return (err as { status: number }).status; }
}

describe('the dependency advisory gate', () => {
  it('passes when every high or critical advisory has a written reason', () => {
    expect(run(ACCEPTED.map((id) => advisory(id)))).toBe(0);
  });

  it('fails on a high advisory nobody has explained', () => {
    expect(run([...ACCEPTED.map((id) => advisory(id)), advisory('GHSA-aaaa-bbbb-cccc')])).toBe(1);
  });

  it('fails on a critical one too', () => {
    expect(run([...ACCEPTED.map((id) => advisory(id)), advisory('GHSA-dddd-eeee-ffff', 'critical')])).toBe(1);
  });

  it('fails when an accepted hole has closed, so the exemption cannot outlive it', () => {
    expect(run(ACCEPTED.slice(1).map((id) => advisory(id)))).toBe(1);
  });

  it('ignores moderate and low findings, as the old audit level did', () => {
    expect(run([...ACCEPTED.map((id) => advisory(id)), advisory('GHSA-gggg-hhhh-iiii', 'moderate')])).toBe(0);
  });
});
