process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '7'.repeat(64);

// =============================================================================
// A PRINTABLE IS TAGGED FOR A SCREEN READER (FQ, 9 October 2026).
//
// An untagged PDF is a picture of text to a screen reader: no headings, no
// reading order, no language. Chromium can write a tagged PDF (a structure
// tree built from the HTML: headings, paragraphs, lists, tables) and an
// outline from the headings; the printer asks for both, and the fields added
// after printing must not strip them. Read by readers that did not write the
// file: poppler says "Tagged: yes"; pdf.js reads the structure tree (with the
// page's headings in it), the outline, the document's language and its title,
// which carries the version — the same version the cover and footers print.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRINTABLE_CONTENT_HONEST } from '../fixtures/printable-home-maintenance.js';

const P = await import('../../src/services/venture/products/printable.js');
const spec = { kind: 'printable_pdf' as const, title: 'The Home Maintenance Log', ...PRINTABLE_CONTENT_HONEST };
const meta = { workshop: 'Apex Micro', version: 3, madeOn: '2026-10-09' };

const HEADLESS = [
  process.env.FOUNDRY_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/usr/lib/chromium/chromium-headless-shell',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((p): p is string => !!p && existsSync(p));
const withBrowser = HEADLESS ? describe : describe.skip;

interface Node { role?: string; children?: Node[] }
const roles = (n: Node | null, out: string[] = []): string[] => {
  if (!n) return out;
  if (n.role) out.push(n.role);
  for (const c of n.children ?? []) roles(c, out);
  return out;
};

withBrowser('the printed file is tagged, titled, in a language, with an outline', () => {
  let dir = '';
  let pdf: Buffer;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ff2-tagged-'));
    pdf = (await P.renderPrintable(spec, meta, P.chromiumRenderer(HEADLESS!))).pdf;
    writeFileSync(join(dir, 'log.pdf'), pdf);
  }, 120_000);
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('poppler says it is tagged, and its title names the version', () => {
    const info = execFileSync('pdfinfo', [join(dir, 'log.pdf')]).toString();
    expect(info).toMatch(/^Tagged:\s+yes$/m);
    expect(info).toMatch(/^Title:\s+The Home Maintenance Log · Version 3$/m);
    // And the form survives beside the tags.
    expect(info).toMatch(/^Form:\s+AcroForm$/m);
  });

  it('pdf.js reads a structure tree with headings on every content page, an outline, and the language', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false }).promise;
    const metaInfo = (await doc.getMetadata()).info as Record<string, unknown>;
    expect(String(metaInfo.Language ?? '')).toMatch(/^en/);
    // The outline nests each page's heading under the cover's title: count every entry.
    type Item = { title: string; items?: Item[] };
    const all = (xs: Item[] | null): Item[] => (xs ?? []).flatMap((x) => [x, ...all(x.items ?? [])]);
    const outline = all(await doc.getOutline() as Item[] | null);
    for (const pg of PRINTABLE_CONTENT_HONEST.pages) expect(outline.map((o) => o.title), pg.heading).toContain(pg.heading);
    for (let p = 3; p <= doc.numPages - 1; p++) {
      const tree = await (await doc.getPage(p)).getStructTree() as Node | null;
      const r = roles(tree);
      expect(r.some((x) => /^H[1-6]?$/.test(x)), `page ${String(p)} has a heading in its structure`).toBe(true);
    }
    await doc.destroy();
  });

  it('the version the title names is the version the cover and footers print', () => {
    const text = execFileSync('pdftotext', [join(dir, 'log.pdf'), '-']).toString();
    expect(text).toContain('Version 3');
    expect(text).not.toMatch(/Version [124-9]\b/);
  });
});
