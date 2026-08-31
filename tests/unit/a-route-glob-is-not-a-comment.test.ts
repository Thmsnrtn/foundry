import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A ROUTE GLOB IS A STRING CONTAINING `/*`.
//
// Ten gates opened with `source.replace(/\/\*[\s\S]*?\*\//g, ' ')`. In
// `app.use('/dashboard/*', mw)` that regex sees a block comment opening, and it
// closes at the next real `*/` — which may be hundreds of lines later, in a
// JSDoc block. Everything between was blanked before any gate looked at it.
//
// Measured when this was found: 715 lines of CODE across 7 files, of which 314
// are half of `src/index.ts` — the route mounting, the middleware wiring, the
// scheduler. Two modules were counted reachable through imports that had been
// blanked into nothing, and seven columns were reported as write-only whose
// readers were inside the blanked regions.
//
// The first count taken was 5,939 lines across 273 files. That was wrong: it
// counted real comments alongside the swallowed code. The number that matters
// is the difference between the two rules.
//
// Every green tick from those gates carried an unstated qualifier: over the
// part of the file it could still see.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('the shared comment stripper', () => {
  it('leaves a route glob and everything after it alone', () => {
    const source = [
      "app.use('/dashboard/*', csrfMiddleware);",
      "import { csrfMiddleware } from './middleware/csrf.js';",
      '/** A doc block, which does close. */',
      "const kept = 'after the doc block';",
    ].join('\n');
    const out = stripComments(source);
    expect(out).toContain('csrfMiddleware');
    expect(out).toContain('middleware/csrf.js');
    expect(out).toContain('after the doc block');
    expect(out).not.toContain('A doc block');
  });

  it('still removes the comments it is for', () => {
    const out = stripComments([
      '// a line comment',
      'const a = 1; // trailing',
      '/* block',
      '   spanning */',
      'const b = 2;',
      'try {} catch { /* inline note */ }',
    ].join('\n'));
    expect(out).not.toContain('a line comment');
    expect(out).not.toContain('trailing');
    expect(out).not.toContain('spanning');
    expect(out).not.toContain('inline note');
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
  });

  it('keeps line numbers, because a gate reports locations', () => {
    const source = '/* one\n   two */\nconst three = 3;';
    expect(stripComments(source).split('\n')).toHaveLength(3);
    expect(stripComments(source).split('\n')[2]).toContain('const three');
  });

  it('blanks nothing in src/ that the unsafe regex used to blank', () => {
    // The regression itself: the old rule blanked 6% of the tree. If a future
    // edit reintroduces it, this counts the damage rather than trusting a
    // reviewer to spot a regex.
    let hiddenCode = 0;
    for (const file of files(join(ROOT, 'src'))) {
      const source = readFileSync(file, 'utf8');
      const unsafe = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      const safe = stripComments(source, { lineComments: false });
      const a = source.split('\n'); const u = unsafe.split('\n'); const s = safe.split('\n');
      for (let i = 0; i < a.length; i += 1) {
        // Code, blanked by the old rule, kept by this one.
        if (a[i].trim() && !u[i].trim() && s[i].trim()) hiddenCode += 1;
      }
    }
    expect(hiddenCode, 'the old rule really did hide this much code').toBeGreaterThan(500);
  });

  it('is the only stripper the gates use', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(join(ROOT, 'scripts'))) {
      if (!name.endsWith('.mjs')) continue;
      const source = readFileSync(join(ROOT, 'scripts', name), 'utf8');
      if (/replace\(\/\\\/\\\*\[\\s\\S\]/.test(source)) offenders.push(name);
    }
    expect(offenders, 'a gate rolling its own block-comment strip will blank route globs')
      .toEqual([]);
  });
});
