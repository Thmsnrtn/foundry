process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '7'.repeat(64);

// =============================================================================
// A PRINTABLE IS MADE, AND REFUSED, HONESTLY (Stage 2, C2).
//
// The printable_pdf kind: the model writes a printable's words inside a fixed
// design system the repository owns, headless Chromium prints it, and nothing
// can ship until it has passed its gates. Each gate here is held against the
// defect it exists for, not against the symbol that names it:
//   * a style attribute, a script, a link or an unknown class in the model's
//     HTML is refused, so it cannot move the layout;
//   * an invented statistic, testimonial or credential is refused;
//   * a legal, medical or money topic carries the owned disclaimer, and
//     personal regulated advice is refused;
//   * the printed file has the pages it was composed with, and a page whose
//     content runs past its bottom margin is caught;
//   * the panel of strangers ships, holds for the owner, or refuses;
//   * the model check fails closed;
//   * the download link is signed, expires, and binds one fulfilment.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PRINTABLE_CONTENT_HONEST, PRINTABLE_CONTENT_WITH_A_STATISTIC } from '../fixtures/printable-home-maintenance.js';

let modelAnswer: () => Promise<{ content: string; tokensUsed: number; costUsd: number }> = async () => ({ content: '{}', tokensUsed: 0, costUsd: 0 });
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => modelAnswer()),
}));

const P = await import('../../src/services/venture/products/printable.js');

// FOUNDRY_CHROMIUM_PATH FIRST, as production reads it, so running this file
// with the image's environment proves the image's printer; then the usual paths.
const CHROMIUM = [
  process.env.FOUNDRY_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p): p is string => !!p && existsSync(p));
const withBrowser = CHROMIUM ? describe : describe.skip;

const spec = (content = PRINTABLE_CONTENT_HONEST) => ({ kind: 'printable_pdf' as const, title: 'The Home Maintenance Log', ...content });
const text = (content = PRINTABLE_CONTENT_HONEST) => P.plainTextOf(spec(content));

describe('the model writes words, never layout', () => {
  it('the honest pages use only the owned vocabulary', () => {
    for (const p of PRINTABLE_CONTENT_HONEST.pages) expect(P.sanitizePageHtml(p.html)).toEqual([]);
  });

  it('a style, a script, a link, an image, a comment or an unknown class is refused by name', () => {
    expect(P.sanitizePageHtml('<p style="margin:-2in">x</p>').join(' ')).toMatch(/attribute "style"/);
    expect(P.sanitizePageHtml('<script>alert(1)</script>').join(' ')).toMatch(/<script>/);
    expect(P.sanitizePageHtml('<a href="https://x.example">x</a>').join(' ')).toMatch(/<a>/);
    expect(P.sanitizePageHtml('<img src="x.png">').join(' ')).toMatch(/<img>/);
    expect(P.sanitizePageHtml('<!-- hidden --><p>x</p>').join(' ')).toMatch(/comment/);
    expect(P.sanitizePageHtml('<div class="page">x</div>').join(' ')).toMatch(/class "page"/);
    expect(P.sanitizePageHtml('<p>open <strong>never closed</p>').join(' ')).toMatch(/not closed|closes/);
    expect(P.sanitizePageHtml('<style>.page{height:auto}</style>').join(' ')).toMatch(/<style>/);
  });
});

describe('nothing invented', () => {
  it('the honest file has no finding', () => {
    expect(P.fabricationScan(text())).toEqual([]);
  });

  it('an invented statistic is found, quoted', () => {
    const found = P.fabricationScan(text(PRINTABLE_CONTENT_WITH_A_STATISTIC));
    expect(found.join(' ')).toMatch(/statistic.*43%/);
  });

  it('a testimonial, a review, a credential and a source nobody can check are each found', () => {
    expect(P.fabricationScan('"This log saved our roof." — Sarah K., Ohio').join(' ')).toMatch(/testimonial/);
    expect(P.fabricationScan('Rated 4.9 stars by buyers').join(' ')).toMatch(/review|rating/);
    expect(P.fabricationScan('Written by a certified home inspector with 20 years of experience').join(' ')).toMatch(/credential/);
    expect(P.fabricationScan('Studies show most furnaces fail in January').join(' ')).toMatch(/statistic|source/);
    expect(P.fabricationScan('Nine out of ten homeowners forget their filters').join(' ')).toMatch(/statistic/);
  });
});

describe('a sensitive topic carries its disclaimer; regulated advice is refused', () => {
  it('a household file that names wills and powers of attorney is a legal topic, and the owned disclaimer is printed', () => {
    const legal = { ...PRINTABLE_CONTENT_HONEST, pages: [{ heading: 'Papers', lede: 'Where they are.', html: '<p>Where the will is kept, and who holds the power of attorney.</p>' }] };
    expect(P.sensitiveTopicsOf(text(legal))).toEqual(['legal']);
    const html = P.composePrintableHtml(spec(legal), { workshop: 'Apex Micro', version: 1, madeOn: '2026-10-07', css: '' });
    expect(html).toContain(P.DISCLAIMERS.legal);
    expect(P.composePrintableHtml(spec(), { workshop: 'Apex Micro', version: 1, madeOn: '2026-10-07', css: '' })).not.toContain(P.DISCLAIMERS.legal);
  });

  it('telling a reader what their own legal, medical or money decision should be is refused', () => {
    expect(P.regulatedAdviceScan('You do not need a lawyer: sign the will in front of one witness and it is valid.').length).toBeGreaterThan(0);
    expect(P.regulatedAdviceScan('Take 400 mg every four hours until the pain stops.').length).toBeGreaterThan(0);
    expect(P.regulatedAdviceScan('You should move your retirement savings into index funds now.').length).toBeGreaterThan(0);
    expect(P.regulatedAdviceScan(text())).toEqual([]);
  });
});

describe('the panel of strangers', () => {
  const v = (verdict: 'yes' | 'maybe' | 'no', max: number) => ({ persona: 'p', verdict, maxPriceDollars: max, why: 'w' });
  it('ships on a clear yes at the asking price, refuses a clear no, and holds the middle for the owner', () => {
    expect(P.panelVerdict([v('yes', 12), v('yes', 10), v('maybe', 9), v('yes', 15)], 9).outcome).toBe('ship');
    expect(P.panelVerdict([v('no', 0), v('no', 2), v('maybe', 3), v('no', 0)], 9).outcome).toBe('refuse');
    // The bench's real result: 0 yes, 4 maybe, 1 no, median about $9.
    expect(P.panelVerdict([v('maybe', 9), v('maybe', 12), v('maybe', 7), v('maybe', 9), v('no', 0)], 9).outcome).toBe('hold');
    // Every yes at a price below what is asked is not a yes to this offer.
    expect(P.panelVerdict([v('yes', 4), v('yes', 5), v('yes', 3)], 9).outcome).not.toBe('ship');
  });

  it('too few strangers is no panel', () => {
    expect(P.panelVerdict([v('yes', 20), v('yes', 20)], 9).outcome).toBe('refuse');
  });
});

describe('the model check fails closed', () => {
  it('an unreachable model refuses the file, with the reason', async () => {
    modelAnswer = async () => { throw new Error('the model door is down'); };
    const r = await P.modelHonestyCheck(text(), { founderId: 'f', experimentId: 'x' });
    expect(r.clean).toBe(false);
    expect(r.findings.join(' ')).toMatch(/could not be (read|asked)/);
  });
  it('an answer that is not the schema refuses the file', async () => {
    modelAnswer = async () => ({ content: 'Looks fine to me!', tokensUsed: 1, costUsd: 0 });
    expect((await P.modelHonestyCheck(text(), { founderId: 'f', experimentId: 'x' })).clean).toBe(false);
  });
  it('a model that finds an invented fact refuses it; a model that finds none passes', async () => {
    modelAnswer = async () => ({ content: JSON.stringify({ invented: [{ kind: 'statistic', quote: '43% less' }], regulated_advice: false }), tokensUsed: 1, costUsd: 0 });
    expect((await P.modelHonestyCheck(text(), { founderId: 'f', experimentId: 'x' })).findings.join(' ')).toMatch(/43% less/);
    modelAnswer = async () => ({ content: JSON.stringify({ invented: [], regulated_advice: false }), tokensUsed: 1, costUsd: 0 });
    expect(await P.modelHonestyCheck(text(), { founderId: 'f', experimentId: 'x' })).toEqual({ clean: true, findings: [] });
  });
});

describe('the download link', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it('is signed for one fulfilment and works until it expires', () => {
    const link = P.downloadLinkFor('ful_abc123', now);
    const m = /\/share\/download\/(ful_abc123)\/(\d+)\/([0-9a-f]{64})$/.exec(link)!;
    expect(m).not.toBeNull();
    expect(P.checkDownloadToken('ful_abc123', m[2]!, m[3]!, now)).toBe('ok');
    expect(P.checkDownloadToken('ful_abc124', m[2]!, m[3]!, now)).toBe('invalid');
    expect(P.checkDownloadToken('ful_abc123', String(Number(m[2]) + 86_400), m[3]!, now)).toBe('invalid');
    const later = new Date(now.getTime() + (P.DOWNLOAD_LINK_DAYS * 86_400 + 1) * 1000);
    expect(P.checkDownloadToken('ful_abc123', m[2]!, m[3]!, later)).toBe('expired');
  });
});

withBrowser('the printed file', () => {
  it('has exactly the pages it was composed with, matches pdfinfo, and nothing overflows', async () => {
    const r = await P.renderPrintable(spec(), { workshop: 'Apex Micro', version: 1, madeOn: '2026-10-07' }, P.chromiumRenderer(CHROMIUM!));
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // cover, contents, six pages, colophon
    expect(r.sections).toBe(9);
    expect(P.pdfPageCount(r.pdf)).toBe(9);
    expect(r.overflow).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), 'printable-'));
    writeFileSync(join(dir, 'f.pdf'), r.pdf);
    if (existsSync('/usr/bin/pdfinfo')) {
      expect(execFileSync('pdfinfo', [join(dir, 'f.pdf')]).toString()).toMatch(/Pages:\s+9\b/);
      const words = execFileSync('pdftotext', [join(dir, 'f.pdf'), '-']).toString();
      expect(words).toContain('The Home Maintenance Log');
      expect(words).toContain('Version 1');
    }
  }, 120_000);

  it('a page whose content runs past its margin is named as overflowing', async () => {
    const long = { ...PRINTABLE_CONTENT_HONEST, pages: [...PRINTABLE_CONTENT_HONEST.pages.slice(0, 4),
      { heading: 'Service record', lede: 'Every repair.', html: `<table class="ws"><tbody>${'<tr><td>x</td><td></td></tr>'.repeat(40)}</tbody></table>` }] };
    const r = await P.renderPrintable(spec(long), { workshop: 'Apex Micro', version: 1, madeOn: '2026-10-07' }, P.chromiumRenderer(CHROMIUM!));
    expect(r.overflow.join(' ')).toMatch(/Service record/);
  }, 120_000);
});
