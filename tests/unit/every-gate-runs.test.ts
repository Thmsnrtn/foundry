import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// A gate nobody runs is a comment.
//
// Two validation paths existed and neither was a superset of the other:
//
//   `npm run check`   typecheck, ratchets, kernel boundary, guard NULL-safety,
//                     public-claims audit, effects audit, full test suite
//   CI's check job    typecheck, ratchets, build, tests
//
// So the four audit gates — including the NULL-safety checker written because
// three institutional guards were defeated by the same NULL bug, and the
// consequential-effects audit — ran ONLY on a developer's machine. A pull
// request could turn any of them red and go green in CI. Meanwhile the column
// drift checkers ran only in CI, because they shell out to the `sqlite3`
// binary and putting them in the local composite would add a dependency to
// every `npm run check`.
//
// This is the family the 47 unrun assertions belonged to: work that reads
// exactly like coverage and is never executed. The fix is not to remember —
// it is to make "written but unrun" impossible to leave in place.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const CI = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');

/** Scripts that exist to fail a build. Anything else in `scripts/` is a tool. */
function gateScripts(): string[] {
  return readdirSync(resolve(ROOT, 'scripts'))
    .filter((f) => /^(check|audit)-.*\.mjs$/.test(f) || f === 'ratchet.mjs')
    .sort();
}

/** Every npm script `npm run check` reaches, following composites. */
function reachableFromCheck(): Set<string> {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const m of (PKG.scripts[name] ?? '').matchAll(/npm run ([\w:-]+)/g)) visit(m[1]);
  };
  visit('check');
  return seen;
}

/** The command text of every npm script CI invokes, directly or via a composite. */
function commandsRunSomewhere(): string {
  const reached = reachableFromCheck();
  const ciScripts = [...CI.matchAll(/run:\s*npm run ([\w:-]+)/g)].map((m) => m[1]);
  const all = new Set<string>([...ciScripts]);
  // CI running a composite pulls in everything that composite reaches.
  for (const name of ciScripts) {
    if (name === 'check') for (const r of reached) all.add(r);
    for (const m of (PKG.scripts[name] ?? '').matchAll(/npm run ([\w:-]+)/g)) all.add(m[1]);
  }
  return [...all].map((n) => PKG.scripts[n] ?? '').join('\n');
}

describe('every gate actually runs somewhere', () => {
  it('names each gate script in a command CI executes', () => {
    const commands = commandsRunSomewhere();
    const unrun = gateScripts().filter((f) => !commands.includes(f));
    expect(unrun,
      'These scripts exist to fail a build and nothing in CI invokes them. Add them to '
      + '`npm run check`, or give them their own CI job:\n' + unrun.join('\n')).toEqual([]);
  });

  it('runs the composite gate in CI, not a hand-copied subset of it', () => {
    // The specific regression this prevents. CI listed typecheck, ratchet and
    // the tests individually — a subset that silently stopped tracking `check`
    // as gates were added to it. Naming the composite means a new gate is
    // covered the moment it joins.
    expect(CI, 'CI must run the composite gate').toMatch(/run:\s*npm run check\b/);
    expect(PKG.scripts.check).toContain('npm run test:ci');
    for (const gate of ['ratchet', 'kernel:boundary', 'guards:nullsafe', 'truth:audit', 'effects:audit']) {
      expect(PKG.scripts.check, `${gate} must be part of the composite`).toContain(gate);
    }
  });

  it('keeps the sqlite-dependent checkers in CI, where the binary exists', () => {
    // These are deliberately NOT in the local composite: they shell out to the
    // `sqlite3` binary, and requiring it for every `npm run check` would be a
    // real cost for a class of defect CI already covers on every push. That is
    // a choice, and it only stays honest while CI genuinely runs them.
    expect(CI).toMatch(/run:\s*npm run lint:columns/);
    expect(CI).toMatch(/apt-get install -y sqlite3/);
    expect(PKG.scripts['lint:columns']).toContain('check-insert-columns.mjs');
    expect(PKG.scripts['lint:columns']).toContain('check-sql-columns.mjs');
  });

  it('verifies the committed schema snapshot against the migrations', () => {
    // The recursive responsibility the owner named depends on this being true
    // somewhere other than a developer's laptop.
    expect(CI).toMatch(/schema-snapshot\.sh/);
    expect(CI).toMatch(/git diff --exit-code docs\/db\/schema\.snapshot\.sql/);
  });
});
