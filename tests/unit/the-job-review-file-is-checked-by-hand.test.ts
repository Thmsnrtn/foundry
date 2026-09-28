// =============================================================================
// THE JOB REVIEW FILE IS CHECKED BY HAND, NOT BY ITSELF.
//
// The owner's handoff of 28 September: "The independent oracle must include
// normal work, a loss, a change-approved job, missing hours, a supplier credit,
// zero revenue, unit mismatch, and locale/rounding cases", and "the
// generator's own formulas cannot be its oracle".
//
// So every expected figure below was worked out by hand, outside the file,
// and written here as a number. The file is built for each case, unzipped,
// and the formulas AS WRITTEN IN IT are executed by a small evaluator in this
// test — an independent reading of the same cells, with Excel's rule for
// ROUND (15 significant digits, halves away from zero). The renderer never
// computes an answer anywhere.
//
// What this does not show, and the record says so: that Excel or Google
// Sheets calculate these cells the same way. That needs those programs.
// =============================================================================
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildJobReview, CELLS, EXAMPLE_JOB, type JobInputs } from '../../src/services/venture/products/recipes/job-review.js';
import { readStoredZip } from '../../src/services/venture/products/recipes/xlsx.js';
import { BY_HAND, NORMAL, expectedCells } from '../fixtures/job-review-by-hand.js';

// ─── An independent reading of the sheet ─────────────────────────────────────

type V = number | string | null;
interface Raw { kind: 'number' | 'text' | 'formula' | 'blank'; v: string }

function cellsOf(xml: string): Map<string, Raw> {
  const out = new Map<string, Raw>();
  const re = /<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g;
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const m of xml.matchAll(re)) {
    const inner = m[2] ?? '';
    const fm = /<f>([\s\S]*?)<\/f>/.exec(inner);
    const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
    const tm = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
    out.set(m[1], fm ? { kind: 'formula', v: unesc(fm[1]) } : vm ? { kind: 'number', v: vm[1] }
      : tm ? { kind: 'text', v: unesc(tm[1]) } : { kind: 'blank', v: '' });
  }
  return out;
}

/** Excel's ROUND: to 15 significant digits first, then halves away from zero, in decimal. */
function excelRound(x: number, digits: number): number {
  const clean = Math.abs(Number(x.toPrecision(15)));
  const shown = String(clean);
  if (shown.includes('e')) return Math.sign(x) * Math.round(clean * 10 ** digits) / 10 ** digits;
  // Shifting the decimal point in the text, not by multiplying, keeps 1.005 from becoming 100.4999….
  return Math.sign(x) * Number(`${String(Math.round(Number(`${shown}e${String(digits)}`)))}e-${String(digits)}`);
}

function evaluator(cells: Map<string, Raw>) {
  const memo = new Map<string, V>();
  const valueOf = (ref: string): V => {
    if (memo.has(ref)) return memo.get(ref)!;
    const c = cells.get(ref);
    const v: V = !c || c.kind === 'blank' ? null : c.kind === 'number' ? Number(c.v) : c.kind === 'text' ? c.v : run(c.v);
    memo.set(ref, v);
    return v;
  };
  const num = (v: V): number => {
    if (v === null) return 0;
    if (typeof v === 'number') return v;
    throw new Error(`#VALUE! from "${v}"`);
  };
  function run(src: string): V {
    let i = 0;
    const ws = () => { while (src[i] === ' ') i++; };
    const peek = (s: string) => { ws(); return src.startsWith(s, i); };
    const eat = (s: string) => { if (!peek(s)) throw new Error(`expected ${s} at ${String(i)} in ${src}`); i += s.length; };
    type Thunk = () => V;
    const args = (): Thunk[] => {
      const out: Thunk[] = [];
      eat('(');
      if (peek(')')) { i++; return out; }
      for (;;) { out.push(expr()); if (peek(',')) { i++; continue; } eat(')'); return out; }
    };
    const primary = (): Thunk => {
      ws();
      if (src[i] === '"') { const j = src.indexOf('"', i + 1); const s = src.slice(i + 1, j); i = j + 1; return () => s; }
      if (src[i] === '(') { i++; const e = expr(); eat(')'); return e; }
      const n = /^\d+(\.\d+)?/.exec(src.slice(i));
      if (n) { i += n[0].length; const x = Number(n[0]); return () => x; }
      const name = /^[A-Z]+\d*/.exec(src.slice(i))![0];
      i += name.length;
      if (/\d/.test(name)) return () => valueOf(name);
      const a = args();
      switch (name) {
        case 'IF': return () => { const c = a[0](); return c !== null && c !== '' && num(c) !== 0 ? a[1]() : a[2](); };
        case 'AND': return () => (a.every((t) => { const v = t(); return v !== null && v !== '' && num(v) !== 0; }) ? 1 : 0);
        case 'ISNUMBER': return () => (typeof a[0]() === 'number' ? 1 : 0);
        case 'ISBLANK': return () => (a[0]() === null ? 1 : 0);
        case 'ROUND': return () => excelRound(num(a[0]()), num(a[1]()));
        default: throw new Error(`unknown function ${name}`);
      }
    };
    const unary = (): Thunk => { if (peek('-')) { i++; const u = unary(); return () => -num(u()); } return primary(); };
    const term = (): Thunk => {
      let l = unary();
      for (;;) {
        if (peek('*')) { i++; const a = l, b = unary(); l = () => num(a()) * num(b()); }
        else if (peek('/')) { i++; const a = l, b = unary(); l = () => { const d = num(b()); if (d === 0) throw new Error('#DIV/0!'); return num(a()) / d; }; }
        else return l;
      }
    };
    const additive = (): Thunk => {
      let l = term();
      for (;;) {
        if (peek('+')) { i++; const a = l, b = term(); l = () => num(a()) + num(b()); }
        else if (peek('-')) { i++; const a = l, b = term(); l = () => num(a()) - num(b()); }
        else return l;
      }
    };
    function expr(): Thunk {
      const l = additive();
      for (const op of ['<>', '<=', '>=', '=', '<', '>']) {
        if (peek(op)) {
          i += op.length; const r = additive();
          return () => { const a = l(), b = r();
            const x = typeof a === 'number' ? a : a ?? 0, y = typeof b === 'number' ? b : b ?? 0;
            const res = op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
            return res ? 1 : 0; };
        }
      }
      return l;
    }
    const t = expr(); ws();
    if (i !== src.length) throw new Error(`unparsed tail in ${src}: ${src.slice(i)}`);
    return t();
  }
  return valueOf;
}

function sheetFor(job: JobInputs) {
  const built = buildJobReview(job);
  if ('refused' in built) throw new Error(built.refused);
  const parts = readStoredZip(built.bytes);
  const xml = parts.get('xl/worksheets/sheet1.xml')!.toString('utf8');
  return { at: evaluator(cellsOf(xml)), xml, built };
}

const O = CELLS.out;

describe('worked by hand', () => {
  for (const c of BY_HAND) {
    it(c.name, () => {
      const { at } = sheetFor(c.job);
      const got = expectedCells(c.expect).map(([ref]) => [ref, at(ref)]);
      expect(got).toEqual(expectedCells(c.expect));
    });
  }

  it('the example worked by hand is the example the file ships with', () => {
    expect(BY_HAND.at(-1)!.job).toEqual(EXAMPLE_JOB);
  });
});

describe('what the recipe refuses', () => {
  it('another currency or unit of time, a negative amount, or an absurd one', () => {
    expect(buildJobReview({ ...NORMAL, currency: 'eur' })).toHaveProperty('refused');
    expect(buildJobReview({ ...NORMAL, hoursUnit: 'min' })).toHaveProperty('refused');
    expect(buildJobReview({ ...NORMAL, estimate: { ...NORMAL.estimate, materials: -5 } })).toHaveProperty('refused');
    expect(buildJobReview({ ...NORMAL, quotedPrice: 1e12 })).toHaveProperty('refused');
    expect(buildJobReview({ ...NORMAL, quotedPrice: Number.NaN })).toHaveProperty('refused');
  });

  it('text typed into a number cell reads as unknown, never as a number', () => {
    const { xml } = sheetFor(NORMAL);
    const cells = cellsOf(xml);
    cells.set(CELLS.actual.materials, { kind: 'text', v: 'about 3400' });
    const at = evaluator(cells);
    expect(at(O.directCost.actual)).toBe('unknown');
    expect(at(O.directCost.estimate)).toBe(7200);
  });
});

describe('the file itself', () => {
  it('is the same bytes every time it is built, and carries its digest and version', () => {
    const a = buildJobReview(EXAMPLE_JOB), b = buildJobReview(EXAMPLE_JOB);
    if ('refused' in a || 'refused' in b) throw new Error('refused');
    expect(a.bytes.equals(b.bytes)).toBe(true);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.file).toBe(`job-review-v${a.version}.xlsx`);
  });

  it('locks every formula and leaves only the yellow input cells open, and asks the spreadsheet to calculate on open', () => {
    const { xml, built } = sheetFor(EXAMPLE_JOB);
    expect(xml).toContain('<sheetProtection sheet="1"');
    for (const ref of [O.revenue.actual, O.directCost.actual, O.margin.actual, O.priceForPlannedContribution]) {
      expect(xml).toMatch(new RegExp(`<c r="${ref}" s="[45]"><f>`));
    }
    const wb = readStoredZip(built.bytes).get('xl/workbook.xml')!.toString('utf8');
    expect(wb).toContain('fullCalcOnLoad="1"');
  });

  it('the copy the owner is asked to try is the one the recipe builds, and its manifest says so', () => {
    const built = buildJobReview(EXAMPLE_JOB);
    if ('refused' in built) throw new Error(built.refused);
    const committed = readFileSync(`river/proof-3-candidates/a03/${built.file}`);
    expect(createHash('sha256').update(committed).digest('hex')).toBe(built.sha256);
    expect(readFileSync('river/proof-3-candidates/a03/MANIFEST.md', 'utf8')).toContain(built.sha256);
  });

  it('is still not a kind of product Foundry may make on its own', async () => {
    const { KINDS } = await import('../../src/services/venture/products/registry.js');
    const kind = KINDS.find((k) => k.kind === 'template_file')!;
    expect(kind.canMake).toBe(false);
    expect(kind.needs).toMatch(/a buyer who used/);
  });
});
