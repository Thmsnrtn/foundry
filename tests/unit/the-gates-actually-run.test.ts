// =============================================================================
// Tests: a gate that never runs is not a gate.
//
// This repository has built a large number of CI gates, and each one has a
// planted-defect test proving it FAILS when it should. That proves the gate
// works. It does not prove the gate RUNS.
//
// Two ways it was not running:
//
//   • CI triggered on `master` and `main` only. All development happens on a
//     long-lived working branch that is deliberately never merged, with no
//     pull request open — so every gate in this repository had never once run
//     in CI. They were enforced by somebody remembering to run them locally,
//     which is precisely the shape of defect the gates exist to catch: a rule
//     with no edge to the thing it governs.
//
//   • `npm run check` is described everywhere — in CI's own comment, in
//     institutional memory, in commit messages — as THE composite gate and the
//     evidence that validation is green. It omitted `lint:columns`, which is
//     twelve of them. A developer running `check` was told they were green on
//     gates they had not run.
//
// Both are configuration, so both are asserted here rather than remembered.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('the composite gate is composite', () => {
  it('runs every gate script the repository defines', () => {
    // Derived, not listed: a `check-*.mjs` added next year must be chained
    // into something `check` reaches, or this fails. That is the point — a new
    // gate nobody wired up is a new gate nobody runs.
    const scripts = readdirSync('scripts').filter(
      (f) => f.startsWith('check-') && f.endsWith('.mjs'));

    // Everything `check` transitively invokes.
    const seen = new Set<string>();
    const expand = (cmd: string): string => {
      let out = cmd;
      for (let i = 0; i < 6; i++) {
        out = out.replace(/npm run ([a-z:_-]+)/g, (_m, name: string) => {
          if (seen.has(name)) return '';
          seen.add(name);
          return pkg.scripts[name] ?? '';
        });
      }
      return out;
    };
    const reached = expand(pkg.scripts.check);

    const unreached = scripts.filter((f) => !reached.includes(f));
    expect(unreached,
      `these gates exist and \`npm run check\` never runs them: ${unreached.join(', ')}`)
      .toEqual([]);
  });

  it('includes the twelve schema and authority gates by name', () => {
    expect(pkg.scripts.check, '`check` must reach lint:columns')
      .toContain('lint:columns');
  });
});

describe('CI runs on the branch the work is on', () => {
  it('triggers on the working branch, not only on master', () => {
    // The branch policy is that `claude/**` is where development happens and it
    // is never merged to master. A trigger listing only master therefore fires
    // for nothing this project does.
    const trigger = ci.slice(ci.indexOf('on:'), ci.indexOf('jobs:'));
    expect(trigger, 'CI never fires for the branch all the work is on')
      .toMatch(/claude\/\*\*/);
  });

  it('still names the branches expected to be green', () => {
    // Not `'**'`. The trigger should say which branches are expected to pass,
    // rather than quietly including every experimental branch and turning a
    // red CI into background noise.
    const trigger = ci.slice(ci.indexOf('on:'), ci.indexOf('jobs:'));
    expect(trigger).toContain('master');
    expect(trigger).not.toMatch(/branches:\s*\[\s*'\*\*'\s*\]/);
  });

  it('runs the composite gate in CI, not a hand-copied subset', () => {
    // The failure this replaced: CI ran typecheck, ratchet and the tests
    // individually, so four audit gates ran only on a developer's machine.
    expect(ci).toContain('npm run check');
  });
});
