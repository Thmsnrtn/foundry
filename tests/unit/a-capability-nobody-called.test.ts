import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// =============================================================================
// A CAPABILITY DESCRIBED BY ITS READERS AND CALLED BY NOTHING.
//
// Two paid-tier bullets promised the last step of a pipeline that never ran:
//
//   "Remediation Engine — automated GitHub PRs" ($199/mo tier). `generateFix`
//   creates the row, spends the model tokens, records the fix and returns.
//   `openRemediationPR` — the only code that creates a branch, commits files
//   and calls the GitHub PR API — has no caller anywhere. The polling job waits
//   for a PR number nothing sets.
//
//   "Agent evolution — golden lessons" (all tiers). `addGoldenLesson` is the
//   only writer of `golden_suite` and has no caller. Five readers depend on it:
//   the regression gate, the evolution page, the agents page, the investor
//   board packet and the peer benchmark — so the counter is zero for every
//   company, forever.
//
// This is the same shape as the cohort-analysis defect already recorded against
// this page: a capability described by its READER is a capability nobody has
// checked. The claims gate verified prices and counts; it verifies these now,
// against whether the code that performs them has a caller.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

function runClaimsAudit(): { code: number; output: string } {
  try {
    return { code: 0, output: execFileSync('node', [resolve(ROOT, 'scripts/audit-public-claims.mjs')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('the claims gate covers capabilities, not only prices', () => {
  it('passes on the copy the code actually supports', () => {
    const r = runClaimsAudit();
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain('Remediation Engine');
    expect(r.output).toContain('Agent evolution');
  });

  it('still says nothing opens a pull request, so the claim cannot come back', () => {
    // The gate's source is conditional on reality. If a caller is ever wired,
    // this expectation is what tells the next reader the claim may widen.
    const audit = readFileSync(resolve(ROOT, 'scripts/audit-public-claims.mjs'), 'utf8');
    expect(audit).toContain("hasCallerOutside('openRemediationPR'");
    expect(audit).toContain("hasCallerOutside('addGoldenLesson'");
  });
});

describe('the public page does not sell either of them', () => {
  const landing = readFileSync(resolve(ROOT, 'src/routes/public/landing.ts'), 'utf8');

  it('does not promise automated pull requests', () => {
    expect(landing).not.toContain('automated GitHub PRs');
  });

  it('does not promise a golden lesson, and does promise what corrections do reach', () => {
    // Corrections genuinely do shape future sessions — through the versioned
    // config, which `recordFounderCorrection` writes and which is injected into
    // every prompt. The page says that now instead.
    expect(landing).not.toContain('golden lesson');
    expect(landing).toContain('versioned config');
  });

  it('does not claim an agent promotes itself on a record nothing computes', () => {
    // The only writer of `agent_instances.authority_level` is a founder POST.
    // The page named a specific mechanism — 50 sessions, 91% — that exists
    // nowhere: the nearest real threshold moves the COMPANY lifecycle state at
    // a different number, and touches no agent's authority.
    expect(landing).not.toContain('91% success rate');
    expect(landing).toContain('nothing promotes itself');
  });
});
