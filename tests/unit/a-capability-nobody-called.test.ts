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
// checked.
//
// THE PAGE THAT MADE THOSE CLAIMS NO LONGER EXISTS. `routes/public/landing.ts`
// was deleted on 13 September 2026 — Private Foundry has no marketing surface
// of its own and apexmicro.ai is the only public face — so the bullets went
// with it, and with them every check here that read the page for a promise it
// should not be making. They are DELETED rather than pointed at a substitute:
// there is no substitute, because there is no page.
//
// What went, and where its guard lives now:
//
//   • The claims-gate checks. `audit-public-claims.mjs` no longer verifies
//     pricing bullets against `hasCallerOutside('openRemediationPR')` — it
//     verifies the Apex Micro site's three promises against the last step of
//     each pipeline. Whether that gate can still go red is asserted directly,
//     three ways, in `gates-fail-when-they-should.test.ts`.
//   • "does not promise a golden lesson". `addGoldenLesson` having no caller is
//     still asserted, on the function rather than the copy, in
//     `a-benchmark-over-a-constant.test.ts`.
//   • "does not promise automated pull requests". Nothing replaces this one.
//     `openRemediationPR` is still uncalled, and that fact is now recorded in
//     `docs/` and enforced nowhere — worth knowing before anyone wires it.
//
// What survives below is the half that was never copy: the table no code
// reaches, the share link that really does compute a Signal, and the one
// processor that really does receive the prompts.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

describe('the service that actually receives the prompts', () => {
  const client = readFileSync(resolve(ROOT, 'src/services/ai/client.ts'), 'utf8');

  it('is OpenRouter, and there is no second path to a processor', () => {
    // The deleted privacy copy named Anthropic. `api.anthropic.com` appears
    // nowhere in the repository, and `getBaseUrl()` returns OpenRouter
    // unconditionally — its own comment says a direct Anthropic key "still
    // routes through OpenRouter". The disclosure named the one service that was
    // not in the path. The disclosure is gone; the fact it got wrong is still
    // true, and this is where a second path would show up.
    expect(client).not.toContain('api.anthropic.com');
    expect(client).toContain('https://openrouter.ai/api/v1');
  });
});

describe('a table nothing touches', () => {
  it('is reached by no TypeScript, only by the migrations that create and erase it', () => {
    // `deal_rooms` is created by migration 011 and touched by nothing: no
    // INSERT, no SELECT, no service, no route. Its only mention in src/ is the
    // erasure classifier — and the gate suite cites it BY NAME as the canonical
    // example of a table no code reaches. The repository knew; the investor
    // tier sold it. The page is gone, so nothing sells it now; what has to stay
    // true is that nothing started using it either, which would make the next
    // person to read the table think it had always been real.
    const codeMentions = execFileSync('grep',
      ['-rl', '--include=*.ts', 'deal_rooms', resolve(ROOT, 'src')], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    expect(codeMentions.map((f) => f.split('/src/')[1]))
      .toEqual(['services/privacy/consent.ts']);
  });
});

describe('the half of that tier that was real', () => {
  it('still works: a public page computes the Signal for a token the owner can rotate', () => {
    const share = readFileSync(resolve(ROOT, 'src/routes/share/index.ts'), 'utf8');
    expect(share).toContain("'/share/:token'");
    expect(share).toContain('computeSignal');
    expect(readFileSync(resolve(ROOT, 'src/routes/dashboard/settings.ts'), 'utf8'))
      .toContain('share_token = ?');
  });
});

describe('the last step that still has no caller', () => {
  it('openRemediationPR is defined, reachable, and invoked by nothing', () => {
    // THE PAGE WENT AND TOOK THE GUARD WITH IT.
    //
    // This file's own header records that `openRemediationPR` is the only code
    // that creates a branch, commits files and calls the GitHub PR API, and
    // that nothing calls it. The thing ASSERTING that was
    // `hasCallerOutside('openRemediationPR')` inside `audit-public-claims.mjs`,
    // which existed to stop a pricing bullet claiming automated PRs. The bullet
    // and the page are gone, so the assertion went with them — and the defect
    // did not.
    //
    // `addGoldenLesson`, the other half of the pair, kept its guard because
    // `a-benchmark-over-a-constant.test.ts` asserts the no-caller status on the
    // FUNCTION rather than on the copy that sold it. That is the durable shape,
    // and this is the same shape for the one that lost its.
    //
    // `services/audit/remediation.ts` is NOT in the unreachable-modules
    // baseline, so this is not a dead file whose contents stopped mattering:
    // the module is reachable from production and one function inside it is
    // the end of a pipeline that never runs.
    const ROOT = resolve(__dirname, '../..');
    const defined = readFileSync(resolve(ROOT, 'src/services/audit/remediation.ts'), 'utf8');
    expect(defined, 'the function still exists to be called')
      .toContain('export async function openRemediationPR');

    const baseline = readFileSync(resolve(ROOT, 'docs/db/unreachable-modules-baseline.txt'), 'utf8');
    expect(baseline.split('\n').map((l) => l.trim()),
      'if the module became unreachable this test is measuring a corpse')
      .not.toContain('src/services/audit/remediation.ts');

    const callers = execFileSync('grep', [
      '-rl', 'openRemediationPR', resolve(ROOT, 'src'), '--include=*.ts',
    ], { encoding: 'utf8' }).trim().split('\n')
      .filter((f) => f && !f.endsWith('services/audit/remediation.ts'));

    // Deliberately asserted as the CURRENT TRUTH rather than as a desire. If
    // somebody wires it up, this fails and they delete the test — which is the
    // correct outcome and the point of writing it this way round. What must not
    // happen is the promise coming back with nothing behind it and no gate
    // noticing, which is what the last month of this repository was about.
    expect(callers, 'nothing calls it; if that changed, say so here').toEqual([]);
  });
});
