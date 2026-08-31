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
// responsive". False: the sidebar collapses, a bottom tab bar appears, safe-area
// insets and reduced-motion are handled. Looking at a screenshot then said the
// whole page overflowed. Also false — headless Chromium laid the page out at
// 500px while cropping the image to 390, so everything merely LOOKED cut off.
//
// The measurement settled it. With the original stylesheet the document
// reported clientWidth 495 against scrollWidth 504, and named the widest
// offending element itself: `A.btn.btn-primary`, 468px. `.btn` carried
// `white-space: nowrap`, so a button is as wide as its label refuses to wrap —
// and the day-one call to action is a sentence. One primitive, every long
// button on every page, off the side of the screen.
//
// The browser probe is the instrument, not the gate: CI has no Chromium. What
// runs everywhere is this — the two properties that make the primitive unable
// to exceed its container.
// =============================================================================

const css = () => readFileSync(
  resolve(import.meta.dirname, '../../src/public/styles.css'), 'utf8');

/** The body of a rule, so a property is read from the rule it belongs to. */
function rule(source: string, selector: string, within?: string): string {
  const scope = within
    ? (new RegExp(`@media[^{]*${within}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? '')
    : source;
  const m = new RegExp(`(?:^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(scope);
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
    const mobile = rule(css(), '.btn', 'max-width: 768px');
    expect(mobile, 'no .btn rule inside the 768px breakpoint').not.toBe('');
    expect(/white-space:\s*normal/.test(mobile),
      'nowrap at phone width is what pushed the call to action off screen').toBe(true);
  });

  it('still refuses to break short labels on wide screens', () => {
    // The default is deliberate: "Save & Connect" reading across two lines is
    // worse than one long button on a desktop that has room for it.
    expect(/white-space:\s*nowrap/.test(rule(css(), '.btn'))).toBe(true);
  });
});
