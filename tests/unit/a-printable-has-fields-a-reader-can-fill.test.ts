process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '7'.repeat(64);

// =============================================================================
// A PRINTABLE HAS FIELDS A READER CAN FILL (FQ, 9 October 2026).
//
// Every persona on the buyer panel asked for the same thing: "can I fill it in
// on screen?" A printable's blanks were lines drawn by CSS, which a PDF reader
// sees as nothing. Now every blank the design system draws becomes a real
// AcroForm field, placed on the blank itself, named for what it asks:
//   * div.field  — the underline after a label: one text field, named by its label;
//   * div.lines  — writing lines: one text field per line;
//   * table.ws   — every empty cell: one text field, named by its column
//                  (and its row label, when the row has one);
//   * ul.check   — the square before each item: a checkbox, named by the item.
// The proof is read by readers that did NOT write the file: poppler's pdfinfo
// says the file has a form, poppler's word boxes say each field sits on its
// blank, and Mozilla's pdf.js — the engine that fills forms in Firefox — lists
// the fields, reads a value typed into one, and reads a ticked box.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRINTABLE_CONTENT_HONEST } from '../fixtures/printable-home-maintenance.js';

const P = await import('../../src/services/venture/products/printable.js');

const spec = { kind: 'printable_pdf' as const, title: 'The Home Maintenance Log', ...PRINTABLE_CONTENT_HONEST };
const meta = { workshop: 'Apex Micro', version: 1, madeOn: '2026-10-09' };

const HEADLESS = [
  process.env.FOUNDRY_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/usr/lib/chromium/chromium-headless-shell',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((p): p is string => !!p && existsSync(p));
const withBrowser = HEADLESS ? describe : describe.skip;

interface Field { name: string; type: string; page: number; rect: number[]; editable: boolean; value: unknown; alt: string }

/** Every form field pdf.js finds, page by page: what a reader shows. */
async function readerFields(pdf: Uint8Array): Promise<Field[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, useSystemFonts: false }).promise;
  const out: Field[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    for (const a of await page.getAnnotations() as Array<Record<string, unknown>>) {
      if (a.subtype !== 'Widget') continue;
      out.push({ name: String(a.fieldName), type: String(a.fieldType), page: p, rect: a.rect as number[], editable: a.readOnly !== true,
        value: a.fieldValue, alt: String(a.alternativeText ?? '') });
    }
  }
  await doc.destroy();
  return out;
}

let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'ff2-fields-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

withBrowser('the printed file, read by readers that did not write it', () => {
  let pdf: Buffer;
  let fields: Field[];
  beforeAll(async () => {
    pdf = (await P.renderPrintable(spec, meta, P.chromiumRenderer(HEADLESS!))).pdf;
    writeFileSync(join(dir, 'log.pdf'), pdf);
    fields = await readerFields(pdf);
  }, 120_000);

  it('poppler says the file has a form', () => {
    expect(execFileSync('pdfinfo', [join(dir, 'log.pdf')]).toString()).toMatch(/^Form:\s+AcroForm/m);
  });

  it('every blank the fixture draws is a field: labelled lines, every empty table cell, every checklist box', () => {
    const html = PRINTABLE_CONTENT_HONEST.pages.map((p) => p.html).join('\n');
    const labelled = (html.match(/<div class="field">/g) ?? []).length;
    const emptyCells = (html.match(/<td><\/td>/g) ?? []).length;
    const boxes = (html.match(/<ul class="check">[\s\S]*?<\/ul>/g) ?? []).reduce((n, ul) => n + (ul.match(/<li>/g) ?? []).length, 0);
    expect(labelled + emptyCells + boxes).toBeGreaterThan(20);
    expect(fields.filter((f) => f.type === 'Tx')).toHaveLength(labelled + emptyCells);
    expect(fields.filter((f) => f.type === 'Btn')).toHaveLength(boxes);
    for (const f of fields) {
      expect(f.editable, f.name).toBe(true);
      expect(f.alt.length, `${f.name} has a name a screen reader can say`).toBeGreaterThan(2);
    }
    expect(new Set(fields.map((f) => f.name)).size).toBe(fields.length);
  });

  // Two labels at different heights: a field placed upside down can land near
  // its label by coincidence when the label sits near the middle of the page,
  // never for both (found by flipping the y axis: one label alone stayed green).
  for (const label of ['Furnace filter', 'Fridge water filter']) {
    it(`"${label}": its field sits on its own blank — right of its label, on its line, on its page`, () => {
      // pdftotext's word boxes: top-left origin, in points.
      const xhtml = execFileSync('pdftotext', ['-bbox', join(dir, 'log.pdf'), '-']).toString();
      const pages = xhtml.split('<page ').slice(1);
      const field = fields.find((f) => f.alt === label)!;
      expect(field, 'a field named for its label').toBeTruthy();
      const page = pages[field.page - 1]!;
      const height = Number(/height="([\d.]+)"/.exec(page)![1]);
      // The label is found by its OWN words, never by where the field is.
      const words = [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
        .map((m) => ({ xMin: Number(m[1]), yMin: Number(m[2]), xMax: Number(m[3]), yMax: Number(m[4]), t: m[5]! }));
      const sameLine = (a: { yMin: number }, b: { yMin: number }): boolean => Math.abs(a.yMin - b.yMin) < 1;
      const parts = label.split(' ');
      // A label is its words in order on one line, with nothing written after it (the blank follows).
      const labels = words.filter((w) => w.t === parts[0]).map((first) => {
        let at = first;
        for (const next of parts.slice(1)) {
          const n = words.find((w) => w.t === next && sameLine(w, first) && w.xMin > at.xMax && w.xMin - at.xMax < 12);
          if (!n) return null;
          at = n;
        }
        return at;
      }).filter((w): w is NonNullable<typeof w> => !!w && !words.some((x) => sameLine(x, w) && x.xMin > w.xMax));
      expect(labels, `the label "${label}" appears once on the page`).toHaveLength(1);
      const word = labels[0]!;
      const [x1, y1, , y2] = field.rect as [number, number, number, number];
      // Right of the label, within a few points of it.
      expect(x1).toBeGreaterThanOrEqual(word.xMax - 1);
      expect(x1 - word.xMax).toBeLessThan(20);
      // On the label's line: the field's bottom (PDF origin is bottom-left) is near the label's baseline.
      expect(Math.abs(y1 - (height - word.yMax))).toBeLessThan(8);
      expect(y2).toBeGreaterThan(y1);
    });
  }

  it('a reader can fill it: a value typed into a field and a ticked box are read back by pdf.js', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(pdf);
    const form = doc.getForm();
    const text = fields.find((f) => f.alt === 'Furnace filter')!;
    const box = fields.find((f) => f.type === 'Btn')!;
    form.getTextField(text.name).setText('Changed 12 October');
    form.getCheckBox(box.name).check();
    const filled = await doc.save();
    const back = await readerFields(filled);
    expect(back.find((f) => f.name === text.name)!.value).toBe('Changed 12 October');
    expect(back.find((f) => f.name === box.name)!.value).not.toBe('Off');
  });

  it('the fields do not change what is printed: still 9 pages, nothing overflows', async () => {
    expect(P.pdfPageCount(pdf)).toBe(9);
    expect(execFileSync('pdfinfo', [join(dir, 'log.pdf')]).toString()).toMatch(/^Pages:\s+9$/m);
  });
});

describe('placing fields, without a browser', () => {
  it('a box on page 2 lands on page 2, flipped to the PDF origin and scaled from CSS pixels to points', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const blank = await PDFDocument.create();
    blank.addPage([612, 792]); blank.addPage([612, 792]);
    const bytes = Buffer.from(await blank.save());
    const out = await P.addFormFields(bytes, [
      { page: 1, kind: 'text', label: 'Notes', x: 96, y: 96, w: 192, h: 24, pageW: 816, pageH: 1056 },
      { page: 0, kind: 'check', label: 'Find the manuals', x: 72, y: 100, w: 13, h: 13, pageW: 816, pageH: 1056 },
    ]);
    const f = await readerFields(out);
    const notes = f.find((x) => x.alt === 'Notes')!;
    expect(notes.page).toBe(2);
    expect(notes.type).toBe('Tx');
    // x 96px = 72pt; y 96px from the top with h 24px → bottom at 792 − 90 = 702pt.
    expect(notes.rect.map((n) => Math.round(n))).toEqual([72, 702, 216, 720]);
    expect(f.find((x) => x.alt === 'Find the manuals')!.type).toBe('Btn');
  });

  it('no boxes, no form: the file is returned as it was', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const blank = await PDFDocument.create(); blank.addPage([612, 792]);
    const bytes = Buffer.from(await blank.save());
    expect(Buffer.compare(await P.addFormFields(bytes, []), bytes)).toBe(0);
  });
});
