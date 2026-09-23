import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// ONE STYLESHEET, ONE VOCABULARY.
//
// There were two visual systems. `views/layout.ts` served `public/styles.css`
// to the commercial pages; `views/owner/shell.ts` serves `public/owner.css` to
// the owner's. The commercial half is deleted and every surviving page renders
// through the shell — so the second stylesheet went, and with it the
// definitions of everything its markup was still naming.
//
// THAT FAILURE IS SILENT, WHICH IS WHY IT IS WORTH A TEST. A class that matches
// no rule is not an error; the element simply draws unstyled next to elements
// that do not. An undefined custom property is worse: `color:var(--text-primary)`
// where nothing declares `--text-primary` is an INVALID DECLARATION, so the
// property is dropped and the value inherits. That one was used fifty-five
// times across the Letter and had never once applied, and it looked right
// because what it inherited was the body colour.
//
// So, three things, checked against the stylesheet that actually ships:
//
//   1. every class name in owner markup is defined in `owner.css` or in that
//      page's own <style> block;
//   2. every `var(--x)` used without a fallback names a property `owner.css`
//      declares;
//   3. no owner page hard-codes a colour — the palette is tokens, and a hex in
//      a template is a colour that cannot follow the light/dark switch.
//
// Interpolated class attributes (`class="${...}"`) are skipped: the value is
// decided at runtime and a static reader cannot know it.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const CSS = readFileSync(resolve(ROOT, 'src/public/owner.css'), 'utf8');

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);

/** Owner-surface markup: the shell, the places, and the pages under them. */
const FILES = [...walk(resolve(ROOT, 'src/routes/dashboard')), ...walk(resolve(ROOT, 'src/views'))]
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const);

const definedClasses = new Set([...CSS.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const definedProps = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

// Names that are deliberately structural rather than visual. Each one is a hook
// the markup or a test reads, and none of them makes a promise about how the
// element looks.
const STRUCTURAL = new Set([
  'btn-secondary',   // the default look; naming it is already what it does
  'decision', 'unknown', 'elsewhere', // decision-control's shape, not its paint
]);

describe('the owner surface speaks one stylesheet', () => {
  it('names no class that nothing defines', () => {
    const missing: string[] = [];
    for (const [name, src] of FILES) {
      const local = new Set([...src.matchAll(/\.([a-zA-Z][\w-]*)[\s,{]/g)].map((m) => m[1]));
      for (const m of src.matchAll(/class="([^"$]*)"/g)) {
        for (const c of m[1].split(/\s+/).filter(Boolean)) {
          if (definedClasses.has(c) || local.has(c) || STRUCTURAL.has(c)) continue;
          missing.push(`${name}: .${c}`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('reads no custom property that nothing declares', () => {
    const missing: string[] = [];
    for (const [name, src] of FILES) {
      const local = new Set([...src.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
      // `var(--x, fallback)` is a deliberate default and is allowed; a bare
      // `var(--x)` on an undeclared property is a declaration that does nothing.
      for (const m of src.matchAll(/var\((--[\w-]+)\s*\)/g)) {
        if (definedProps.has(m[1]) || local.has(m[1])) continue;
        missing.push(`${name}: ${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  // A COLOUR HAS MORE THAN ONE SPELLING, AND THIS GATE KNEW ONE.
  //
  // The paragraph above says "no owner page hard-codes a colour". It checked
  // `#rrggbb` and nothing else, and sixty-two `rgba(...)` literals sat behind
  // it across the Letter, Privacy, Connections and Settings for the whole
  // campaign — thirty-four of them the same row separator,
  // `border-top:1px solid rgba(255,255,255,0.05)`.
  //
  // That is not a tidiness complaint. A five-percent white film is a DARK-MODE
  // IDIOM: it reads as a hairline over a dark card and disappears completely
  // over the light one. So on the appearance the owner is most likely to pick
  // on a bright phone, every row separator on those pages was simply absent,
  // and no instrument in this repository could see it — the stylesheet gates
  // read the stylesheet, and these colours are in the markup.
  //
  // It is also the answer to the owner's question about whether another
  // palette can override the canonical appearance. It can, and not through a
  // rival `--var` family: an inline literal outranks every token there is.
  //
  // So the gate now knows every spelling a colour has.
  it('hard-codes no colour, in any spelling, outside the two theme-color metas', () => {
    const offenders: string[] = [];
    for (const [name, raw] of FILES) {
      const src = stripComments(raw)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/var\(\s*--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, '')
        // A <meta name="theme-color"> paints the browser chrome before any CSS
        // is parsed, so it cannot read a token and must carry the literal.
        .replace(/<meta name="theme-color"[^>]*>/g, '');
      for (const m of src.matchAll(/(?:^|[^&\w])(#[0-9a-fA-F]{3,8})\b/g)) {
        offenders.push(`${name}: ${m[1]}`);
      }
      // The functional notations. `color-mix()` and `color()` are included
      // because a literal inside either is still a literal, and leaving a
      // spelling out is how this gate came to be half a gate.
      for (const m of src.matchAll(
        /(?:^|[^\w-])((?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([^)]*\))/g)) {
        // `rgb(var(--x))` and `color-mix(in srgb, var(--a), var(--b))` name no
        // colour of their own — they compose ones the palette already owns.
        if (/var\(\s*--/.test(m[1])) continue;
        offenders.push(`${name}: ${m[1]}`);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
