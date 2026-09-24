import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// =============================================================================
// A COLOUR WRITTEN INTO A RULE PAINTS THE SAME IN ALL THREE APPEARANCES.
//
// `.btn{background:#102019}` was a dark green in an ordinary rule, applied
// whatever the owner had chosen. In light mode it put `rgb(20,32,27)` ink on
// an `rgb(16,32,25)` button: 1.01:1, which is not low contrast — it is an
// invisible label on every secondary button in the application. Beside it,
// `nav.places{background:rgba(5,12,9,.97)}` put the five doors of the whole
// product on a dark bar wearing the light palette's grey labels.
//
// WHY THE EXISTING GATES COULD NOT SEE EITHER. `every-colour-is-readable`
// computes ratios between TOKENS — right for the palette, blind to a colour
// that is not one. `one-stylesheet-one-vocabulary` forbids hard-coded colours
// in MARKUP; these are in the stylesheet. The browser review does see them,
// by measuring what was painted, and it needs a browser binary so it is not
// in `npm run check`.
//
// So this is the static half, and it is a RATCHET rather than a ban. Forty-one
// pairs remain and the measurement says none of them is currently unreadable;
// they are latent, not harmless, and sweeping all of them at once would be a
// large change with no demonstrated defect behind it. The number may fall and
// never rise.
//
// Gradients are excluded — a gradient stop is a shape, and the tokens it
// blends are checked where they are declared. Shadows and sheens are not
// included because they carry no text.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const BASELINE = 'docs/db/stylesheet-literal-colours.txt';

/** The properties on which a literal decides whether something can be read. */
const PROPS = '(color|background|background-color|border|border-color|border-top'
  + '|border-bottom|border-left|border-right|outline|outline-color|fill|stroke)';

const SHEETS = ['src/public/owner.css', 'src/services/public-workshop/site.ts'];

function found(): Map<string, number> {
  const out = new Map<string, number>();
  for (const file of SHEETS) {
    const text = readFileSync(resolve(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = new RegExp(`(^|[;{])\\s*${PROPS}\\s*:\\s*([^;}]*)`, 'gm');
    for (const m of text.matchAll(at)) {
      const prop = m[2] ?? '';
      const value = m[3] ?? '';
      if (value.includes('gradient')) continue;
      for (const c of value.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)) {
        const key = `${file}\t${prop}: ${c[0].toLowerCase()}`;
        out.set(key, (out.get(key) ?? 0) + 1);
      }
    }
  }
  return out;
}

function baseline(): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of readFileSync(resolve(ROOT, BASELINE), 'utf8').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [count, file, pair] = line.split('\t');
    out.set(`${String(file)}\t${String(pair)}`, Number(count));
  }
  return out;
}

describe('the palette is where colour lives', () => {
  it('admits no literal colour the baseline does not already carry', () => {
    const now = found();
    const was = baseline();
    const added = [...now.keys()].filter((k) => !was.has(k));
    expect(added, 'a colour was written into a rule instead of taken from a token')
      .toEqual([]);
  });

  it('never lets a listed literal spread to more places', () => {
    const now = found();
    const was = baseline();
    const grew = [...now].filter(([k, n]) => n > (was.get(k) ?? 0))
      .map(([k, n]) => `${k} — ${String(was.get(k) ?? 0)} → ${String(n)}`);
    expect(grew, 'a literal colour is being copied rather than replaced').toEqual([]);
  });

  it('says so when one has been removed, so the baseline comes down with it', () => {
    // A ratchet that is never tightened is a list of excuses. This fails when
    // the sheet is cleaner than the file claims, which is a one-line edit and
    // a deliberate one.
    const now = found();
    const was = baseline();
    const stale = [...was].filter(([k, n]) => (now.get(k) ?? 0) < n)
      .map(([k, n]) => `${k} — baseline ${String(n)}, actual ${String(now.get(k) ?? 0)}`);
    expect(stale, `${BASELINE} is out of date; lower it`).toEqual([]);
  });
});
