// =============================================================================
// A BROWSER GATE RUNS WHERE THE RELEASE IS DECIDED (remediation 3, 6 October 2026).
//
// The browser tests — the one thing on the first screen, axe and the 24px
// floor, the four doors, the twelve journeys, the phone fit — skip rather than
// fail where no Chromium is installed, so a laptop without one can still run
// the suite. That is only safe while the machine that decides a release has
// one. It does: GitHub's `ubuntu-latest` carries `/usr/bin/google-chrome`, and
// the shard totals on the CI log read "passed" with nothing skipped. This
// remediation first wrote the opposite into the record, from a comment, and
// the independent audit caught it.
//
// So the fact is held, not remembered: on a CI runner (GitHub sets `CI`), a
// browser must be found, and every browser test must look for the one the
// runner has. A runner image that drops Chrome, or a new browser test with a
// shorter list, now fails here by name instead of turning six gates into six
// silent skips on the path to production.
// =============================================================================
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(import.meta.dirname);
const RUNNER_BROWSER = '/usr/bin/google-chrome';
const CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', RUNNER_BROWSER,
];

/** The test files that skip without a browser and do not look for the runner's. */
export function blindOnTheRunner(files: Array<[string, string]>): string[] {
  return files
    .filter(([, src]) => /describe\.skip|if \(!CHROMIUM\) return/.test(src) && /chromium/i.test(src))
    .filter(([, src]) => !src.includes(`'${RUNNER_BROWSER}'`))
    .map(([name]) => name);
}

describe('the browser gates on the release runner', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(resolve(DIR, f), 'utf8')] as [string, string]);

  it('there are browser gates, or this proves nothing', () => {
    expect(files.filter(([, s]) => /describe\.skip/.test(s) && /CHROMIUM/.test(s)).length).toBeGreaterThanOrEqual(5);
  });

  it('every one looks for the browser the runner has', () => {
    expect(blindOnTheRunner(files)).toEqual([]);
  });

  it('on a CI runner, a browser is there, so they run rather than skip', () => {
    if (!process.env.CI) return;
    expect(CANDIDATES.find((p) => existsSync(p)), 'no Chromium on the CI runner: the browser gates would skip').toBeTruthy();
  });

  it('a browser test that cannot see the runner is caught; one that can is not', () => {
    const blind = "const CHROMIUM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);\nconst d = CHROMIUM ? describe : describe.skip;";
    const seeing = `const CHROMIUM = ['/usr/bin/chromium', '${RUNNER_BROWSER}'].find(existsSync);\nconst d = CHROMIUM ? describe : describe.skip;`;
    const noBrowser = 'describe.skip("later", () => {});';
    expect(blindOnTheRunner([['a', blind], ['b', seeing], ['c', noBrowser]])).toEqual(['a']);
  });
});
