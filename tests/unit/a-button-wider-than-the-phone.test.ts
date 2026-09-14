import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// =============================================================================
// A BUTTON WIDER THAN THE PHONE.
//
// Found by rendering the product in a real browser and MEASURING it, after two
// wrong readings that are worth recording.
//
// Reading the repository said "5 media queries for 126 pages — effectively not
// responsive". False: the sidebar collapsed, a bottom tab bar appeared,
// safe-area insets and reduced-motion were handled. Looking at a screenshot
// then said the whole page overflowed. Also false — headless Chromium laid the
// page out at 500px while cropping the image to 390, so everything merely
// LOOKED cut off.
//
// The measurement settled it. The document reported clientWidth 495 against
// scrollWidth 504, and named the widest offending element itself:
// `A.btn.btn-primary`, 468px. `.btn` carried `white-space: nowrap`, so a button
// is as wide as its label refuses to wrap — and the day-one call to action was
// a sentence. One primitive, every long button on every page, off the side of
// the screen.
//
// THE STYLESHEET THIS MEASURED IS GONE. `public/styles.css` was the other
// visual system's, and it went with the commercial pages; there is one
// stylesheet now, and it is `public/owner.css`. The invariant did not go with
// it — the same mistake is available in any stylesheet, and this one has three
// rules that set `width:auto` on a button inside a flex row, which is exactly
// the shape that overflows. So the test moved rather than being deleted, and it
// is written against how THIS sheet is built: mobile-first, with the desk as
// the `min-width:900px` exception rather than the phone as a breakpoint.
//
// The browser probe is the instrument, not the gate: CI has no Chromium. What
// runs everywhere is this.
// =============================================================================

const SHEET = resolve(import.meta.dirname, '../../src/public/owner.css');
const css = () => readFileSync(SHEET, 'utf8');

/** Everything outside the desk breakpoint: the stylesheet a phone gets. */
function phoneOnly(source: string): string {
  const desk = source.indexOf('@media (min-width:900px){');
  if (desk === -1) return source;
  // The desk block runs to the closing brace on its own line at column 0.
  const end = source.indexOf('\n}\n', desk);
  return source.slice(0, desk) + source.slice(end === -1 ? source.length : end + 3);
}

/** The body of a rule, so a property is read from the rule it belongs to. */
function rule(source: string, selector: string): string {
  const m = new RegExp(
    `(?:^|\\n)\\s*${selector.replace(/\./g, '\\.')}\\s*\\{([\\s\\S]*?)\\}`,
  ).exec(source);
  return m?.[1] ?? '';
}

describe('a button cannot be wider than what contains it', () => {
  it('is bounded by its container', () => {
    const btn = rule(css(), '.btn');
    expect(btn, '.btn rule not found — this test is stale').not.toBe('');
    expect(/max-width:\s*100%/.test(btn),
      'without this a long label makes the button wider than the viewport').toBe(true);
  });

  it('wraps its label rather than the page on a narrow screen', () => {
    // Not "has white-space:normal" — this sheet never sets nowrap on the
    // primitive, so the default IS wrapping. The thing to hold is that nobody
    // reintroduces nowrap for a button on the surface a phone gets.
    const phone = phoneOnly(css());
    const offenders = phone
      .split('\n')
      .filter((l) => /\.btn[^{]*\{[^}]*white-space:\s*nowrap/.test(l));
    expect(offenders,
      'a button that refuses to wrap at phone width is what left the screen').toEqual([]);
  });

  it('still refuses to break short labels where there is room for it', () => {
    // The desk keeps the two-button row on one line: "Yes" and "Not now"
    // reading across two lines each is worse than one wide row on a screen
    // that has the width for it.
    const css_ = css();
    expect(css_.slice(css_.indexOf('@media (min-width:900px){')))
      .toMatch(/\.pair\s+\.btn\{white-space:nowrap\}/);
  });

  it('only lets an element refuse to wrap for a reason written down here', () => {
    // A list, and deliberately a short one, because there are only two reasons
    // a thing may refuse to wrap on a phone:
    //
    //   IT SCROLLS ITSELF. `.local a` and `.filters a` sit in rows with
    //   `overflow-x:auto`, so the row moves and the document does not.
    //
    //   IT CANNOT BE LONG. `.mline dd` is one money figure in the right-hand
    //   column of the subtraction on Money — "$2,786.00", "not known" — and a
    //   currency amount broken across two lines is harder to read than one that
    //   sets the column's width. The longest thing it can hold is a negative
    //   figure with the word "estimated" after it, and the column is `auto`.
    //
    //   `.sr` is the screen-reader-only class: one pixel square and clipped.
    //
    // Anything else added to this list needs one of those two sentences.
    const named = [...phoneOnly(css()).matchAll(/(?:^|\n)([^\n{]*)\{[^}]*white-space:\s*nowrap/g)]
      .map((m) => m[1].trim())
      .filter((s) => !s.startsWith('@'));
    expect(named.sort()).toEqual(['.filters a', '.local a', '.mline dd', '.sr'].sort());
  });
});
