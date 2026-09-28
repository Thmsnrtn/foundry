// =============================================================================
// ASK A REAL SPREADSHEET TO CALCULATE THE JOB REVIEW, AND COMPARE BY HAND.
//
// The unit test executes the file's formulas in an evaluator of its own. That
// is independent of the renderer, but it is still Foundry's reading of the
// formulas. This asks LibreOffice Calc, when it is installed, to open each
// hand-worked case, calculate it from nothing (the file carries no cached
// values), and export what it shows; then compares every result cell with the
// figure worked on paper.
//
// It is not part of `npm run check`: LibreOffice is not in the image, and a
// check that silently skips is worse than one that is not there. Run it by
// hand; with --write it records what it saw, with the engine's version, in
// river/proof-3-candidates/a03/RECALCULATED.md. Excel and Google Sheets are
// other engines, and nothing here speaks for them.
//
//   npx tsx scripts/recalculate-job-review.mts [--write]
// =============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildJobReview, JOB_REVIEW_VERSION } from '../src/services/venture/products/recipes/job-review.js';
import { BY_HAND, expectedCells, type Expected } from '../tests/fixtures/job-review-by-hand.js';

const out = (s: string): void => { process.stdout.write(`${s}\n`); };

let version: string;
try {
  version = execFileSync('soffice', ['--version'], { encoding: 'utf8' }).trim();
} catch {
  out('LibreOffice is not installed here, so nothing was recalculated. The claim stays narrowed.');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'job-review-'));
const files = BY_HAND.map((c, i) => {
  const built = buildJobReview(c.job);
  if ('refused' in built) throw new Error(`${c.name}: refused (${built.refused})`);
  const path = join(dir, `case${String(i)}.xlsx`);
  writeFileSync(path, built.bytes);
  return path;
});
// Raw values, not "as shown"; percentages still come back with a % sign.
execFileSync('soffice', ['--headless', '--convert-to',
  'csv:Text - txt - csv (StarCalc):44,34,76,1,,1033,false,false,false,false,false', '--outdir', dir, ...files],
{ env: { ...process.env, HOME: dir }, stdio: 'ignore', timeout: 300_000 });

function parseCsv(text: string): string[][] {
  return text.split('\n').map((line) => {
    const cells: string[] = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

const shown = (raw: string): Expected | string => {
  if (raw === 'unknown' || raw === 'undefined') return raw;
  const pct = /^(-?[\d.]+)%$/.exec(raw);
  if (pct) return Number(pct[1]) / 100;
  return raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
};
const same = (a: Expected | string, b: Expected): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;

const lines: string[] = [];
let wrong = 0;
BY_HAND.forEach((c, i) => {
  const grid = parseCsv(readFileSync(join(dir, `case${String(i)}.csv`), 'utf8'));
  const misses: string[] = [];
  const checks = expectedCells(c.expect);
  for (const [ref, want] of checks) {
    const m = /^([A-Z])(\d+)$/.exec(ref)!;
    const got = shown(grid[Number(m[2]) - 1]?.[m[1].charCodeAt(0) - 65] ?? '');
    if (!same(got, want)) misses.push(`${ref}: worked ${String(want)}, LibreOffice ${String(got)}`);
  }
  wrong += misses.length;
  lines.push(`| ${c.name} | ${String(checks.length)} | ${misses.length ? misses.join('; ') : 'all agree'} |`);
});

const today = new Date().toISOString().slice(0, 10);
const record = [
  '# The job review, recalculated by LibreOffice',
  '',
  `Recorded ${today} by \`scripts/recalculate-job-review.mts\`, against job review v${JOB_REVIEW_VERSION}.`,
  `Engine: ${version}, headless, calculating each file from nothing (the files carry no cached values).`,
  '',
  '| Case, worked by hand | Cells compared | Result |',
  '|---|---|---|',
  ...lines,
  '',
  wrong === 0
    ? 'Every compared cell agrees with the figure worked on paper.'
    : `${String(wrong)} cells disagree with the figure worked on paper. The file is wrong until they agree.`,
  '',
  'What this does not show: that Excel, Numbers or Google Sheets calculate the same, that the sheet',
  'protection and input validation behave in them as written, or that a buyer can use the file. Those',
  'are recorded as proof debt in `river/proof-3-candidates/DOSSIER.md`.',
  '',
].join('\n');
out(record);
if (process.argv.includes('--write')) writeFileSync('river/proof-3-candidates/a03/RECALCULATED.md', record);
process.exit(wrong === 0 ? 0 : 1);
