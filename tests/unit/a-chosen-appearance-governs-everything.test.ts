// =============================================================================
// A CHOSEN APPEARANCE GOVERNS EVERYTHING.
//
// The owner, 23 September: "The Green-mode defect illustrates why all three
// explicit appearance modes need to be verified under both light and dark
// device preferences. An owner-selected theme should govern the entire
// component system. Investigate whether any other palette families can
// independently override the canonical appearance."
//
// THE DEFECT THIS EXISTS FOR. The `--os-*` family guarded its light override
// on `:root:not([data-theme="dark"])`. Green is not dark, so on a phone set to
// light the whole family flipped light while `--bg`, `--card` and `--ink`
// stayed green: two palettes inside one appearance. The decision card on Home
// is `--os-panel`, so it rendered as a white block in a dark green
// application — in every green-mode screenshot this campaign produced, read
// past every time as "the one thing stands out".
//
// Two more rules carried the same mistake inverted: a dark body gradient
// guarded on `:not([data-theme="light"])`, which green also satisfies, so
// green mode on a dark-preferring device was painted with the DARK theme's
// hard-coded ground.
//
// The rule is one sentence: a device preference may decide the appearance
// only when the owner has not. Anything else is the device overruling him.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = (): string => readFileSync(
  resolve(import.meta.dirname, '../../src/public/owner.css'), 'utf8');

describe('a device preference may only speak when the owner has not chosen', () => {
  it('guards every prefers-color-scheme block on an unset appearance', () => {
    // Every `@media (prefers-color-scheme: …)` in the sheet, with whatever
    // selector follows it on the same line.
    const blocks = [...css().matchAll(/@media \(prefers-color-scheme:\s*\w+\)\s*\{([^\n]*)/g)]
      .map((m) => m[1]!.trim());
    expect(blocks.length, 'no preference blocks found — the regex stopped looking')
      .toBeGreaterThan(0);

    for (const opener of blocks) {
      // Either the selector is on the same line and must be the right guard,
      // or the block opens onto its own lines and the guard is the first
      // selector inside it — which the next assertion covers.
      if (opener === '') continue;
      expect(opener, `a preference block applies to a chosen appearance: ${opener}`)
        .toMatch(/:root:not\(\[data-theme\]\)/);
    }
  });

  it('leaves no preference block whose guard names a specific theme', () => {
    // THE EXACT SHAPE OF BOTH BUGS. `:not([data-theme="dark"])` and
    // `:not([data-theme="light"])` each let one explicitly chosen appearance
    // through — the one they do not name. There is no honest use for them
    // inside a preference query: the question is never "is it that mode", it
    // is "has he chosen at all".
    const text = css();
    const offenders = [...text.matchAll(
      /@media \(prefers-color-scheme:\s*\w+\)[\s\S]{0,400}?:root:not\(\[data-theme="(\w+)"\]\)/g)]
      .map((m) => m[0].slice(0, 90));
    expect(offenders, 'a preference block still names a theme instead of asking whether one is set')
      .toEqual([]);
  });

  it('gives every appearance its own ground, set by the theme and not the device', () => {
    // Each explicit appearance declares `--bg` under its own `[data-theme=…]`
    // selector, so the ground never depends on what the phone prefers.
    const text = css();
    for (const mode of ['light', 'dark']) {
      expect(text, `${mode} has no ground of its own`)
        .toMatch(new RegExp(`:root\\[data-theme="${mode}"\\]\\{[\\s\\S]{0,400}?--bg:`));
    }
    // Green is the bare `:root`, which is why it is the one that was silently
    // overridden: it has no selector of its own to win with.
    expect(text).toMatch(/:root\{[\s\S]{0,300}?--bg:/);
  });

  // ===========================================================================
  // EVERY COLOUR THE DEFAULT DECLARES, EVERY APPEARANCE DECLARES.
  //
  // The assertions above were written for the defect they were shown: green
  // flipping light because a guard named the wrong theme. They were not the
  // general question, and the general question had a different answer.
  //
  // Twenty `--os-*` colours were declared on the bare `:root` — which IS the
  // green appearance — and under `[data-theme="light"]`, and nowhere under
  // `[data-theme="dark"]`. They are read about eighty times. So DARK MODE WAS
  // PARTLY GREEN: a `#101713` card on a `#0A0A0B` ground, green-tinted
  // hairlines, a green wash behind the body — the exact mirror of the defect
  // this file was created for, in the other direction, all along.
  //
  // Neither instrument could see it. The browser review's skin check asks
  // whether a palette answers to the device preference behind the owner's
  // back; in dark mode it does not — it answers green under both preferences,
  // so it passes. Its shape check asks whether an appearance moves anything,
  // and a wrong colour moves nothing.
  //
  // So this asks the question they cannot, and asks it of the family rather
  // than of the symptom: a colour the default declares is a colour every
  // explicit appearance must declare, or the default leaks into it.
  // ===========================================================================
  it('lets no colour of the default appearance leak into an explicit one', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, '');
    /** Every declaration in every block with this exact selector, unioned. */
    const union = (selector: string): Map<string, string> => {
      const out = new Map<string, string>();
      const at = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 'g');
      for (const block of text.matchAll(at)) {
        for (const d of block[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
          out.set(d[1]!, d[2]!.trim());
        }
      }
      return out;
    };
    const isColour = (v: string): boolean => /#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/.test(v);
    const base = union(':root');
    const coloured = [...base].filter(([, v]) => isColour(v)).map(([k]) => k);
    expect(coloured.length, 'no colours found on :root — the reader stopped reading')
      .toBeGreaterThan(20);
    for (const mode of ['light', 'dark']) {
      const declared = union(`:root[data-theme="${mode}"]`);
      const leaking = coloured.filter((k) => !declared.has(k));
      expect(leaking, `${mode} inherits ${String(leaking.length)} colours from the default `
        + `appearance, so choosing ${mode} leaves part of the application green`)
        .toEqual([]);
    }
  });
});
