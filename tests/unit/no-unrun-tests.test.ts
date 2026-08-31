import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// A test the runner never runs is worse than no test.
//
// Four files sat under `src/` containing 47 assertions — crypto, env,
// validation, middleware security. `vitest.config.ts` includes only
// `tests/**/*.test.ts`, so none of them had run in a very long time. Two had
// silently gone stale: one asserted an `access_token` field that was
// deliberately removed for security, and one required a model credential the
// setup deliberately stopped providing.
//
// Nobody was lying. The files simply became invisible, and invisible coverage
// reads exactly like coverage until you look.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('no unrun tests', () => {
  it('has no test file outside the runner\'s include pattern', () => {
    const include = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf8');
    // The gate is only meaningful while the runner looks exactly here.
    expect(include).toContain("include: ['tests/**/*.test.ts']");

    const stray = walk(resolve(ROOT, 'src'))
      .filter((f) => /\.(test|spec)\.ts$/.test(f))
      .map((f) => f.replace(ROOT + '/', ''));

    expect(stray,
      'These contain assertions that no runner executes. Move them under tests/ '
      + 'or delete them — a test nobody runs is worse than no test, because it '
      + 'reads as coverage:\n' + stray.join('\n')).toEqual([]);
  });

  it('finds every test file the runner claims to run', () => {
    // The other direction: a file under tests/ that is not named so the
    // include pattern picks it up is equally invisible.
    const all = walk(resolve(ROOT, 'tests'));
    const sources = all.map((f) => readFileSync(f, 'utf8'));

    const missed = all
      .filter((f) => !/\.(test)\.ts$/.test(f))
      .filter((f) => /\b(describe|it)\s*\(/.test(readFileSync(f, 'utf8')))
      // A shared helper that DEFINES describe/it for other suites is not a
      // hidden test — `tests/evals/_framework.ts` is imported by real test
      // files and runs through them. It is exempt because something else runs
      // it, which is checked rather than assumed.
      .filter((f) => {
        const base = f.split('/').pop()!.replace(/\.ts$/, '');
        const importedElsewhere = sources.some((src, i) =>
          all[i] !== f && new RegExp(`['"\`][^'"\`]*${base}\\.js['"\`]`).test(src));
        return !importedElsewhere;
      })
      .map((f) => f.replace(ROOT + '/', ''));

    expect(missed,
      'These contain describe/it but are not named *.test.ts, so the runner '
      + 'skips them:\n' + missed.join('\n')).toEqual([]);
  });
});
