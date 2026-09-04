import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// =============================================================================
// EVERY COLOUR IS READABLE.
//
// `--ink-3` was 2.83:1 on the page background in the light theme. It is the
// token for secondary text everywhere on the owner surface: the labels of the
// entire tab bar, every section heading, the eyebrow on every fact, the
// provenance line under every number. All of it failed WCAG AA, and only in
// light mode — the dark palette passed, so the failure was invisible to anyone
// developing at night.
//
// A reviewer found it once. This finds it every time: the tokens are read out
// of the stylesheet the page actually serves, and the ratios are computed here
// rather than trusted.
// =============================================================================

const CSS = readFileSync('src/routes/dashboard/foundry-shell.ts', 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    out[String(m[1])] = String(m[2]);
  }
  return out;
}

/** The light palette is the bare :root; the dark one is the media override. */
function palette(which: 'light' | 'dark'): Record<string, string> {
  const light = /:root\{([\s\S]*?)\}/.exec(CSS)?.[1] ?? '';
  if (which === 'light') return tokens(light);
  const dark = /prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{([\s\S]*?)\}\}/
    .exec(CSS)?.[1] ?? '';
  return { ...tokens(light), ...tokens(dark) };
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const SURFACES = ['--bg', '--card', '--card-2'];
const TEXT = ['--ink', '--ink-2', '--ink-3'];

describe('text on every surface, in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const ink of TEXT) {
      for (const surface of SURFACES) {
        it(`${ink} on ${surface} (${theme}) meets AA`, () => {
          const p = palette(theme);
          const fg = p[ink]; const bg = p[surface];
          expect(fg, `${ink} is defined`).toBeDefined();
          expect(bg, `${surface} is defined`).toBeDefined();
          const r = ratio(String(fg), String(bg));
          expect(r, `${String(fg)} on ${String(bg)} is ${r.toFixed(2)}:1`)
            .toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  it('the two states colour carries meaning with are readable too', () => {
    for (const theme of ['light', 'dark'] as const) {
      const p = palette(theme);
      for (const token of ['--good', '--alert', '--accent']) {
        const r = ratio(String(p[token]), String(p['--card']));
        expect(r, `${token} on --card (${theme}) is ${r.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('the categorical ramp is made of no token that means anything', () => {
    // A revenue series painted in "this is good" or "look at this" tells him
    // something about the series that is not true.
    const p = palette('light');
    for (const c of ['--c1', '--c2', '--c3', '--c4']) {
      expect(p[c], `${c} is defined`).toBeDefined();
    }
    for (const meaning of ['--good', '--alert', '--line', '--ink-3']) {
      expect(['--c1', '--c2', '--c3', '--c4'].map((c) => p[c]))
        .not.toContain(p[meaning]);
    }
  });
});
