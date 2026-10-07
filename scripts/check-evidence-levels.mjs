#!/usr/bin/env node
// =============================================================================
// FOUNDRY — every capability claim carries its evidence level
//
// PROOF_PROGRAM.md defines the ladder (E0 hypothesis … E6 broad institutional
// evidence) and says every maturity claim uses it. Nothing checked that they
// did: the evidence frontier mixed levels with words ("frozen", "unproven"),
// the maturity map's journeys and loop transitions carried verdicts and no
// level at all, and an E3 could stand with nothing saying what proved it.
//
// THE POPULATION is named here, table by table — a claim is a ROW of one of
// these tables — and the check fails if a table it names is gone or empty,
// so a heading renamed away is not a clean result:
//
//   IMPLEMENTATION_STATE.md  "Evidence frontier (do not inflate)"
//                            "Proven — E3, or structurally enforced and mutation-verified"
//   MATURITY_MAP.md          "Owner journeys"
//                            "The economic loop, transition by transition"
//
// EACH ROW must name a level (E0–E6) in the table's Level column. A row at E3 or above must also carry a
// POINTER to what proved it: a benchmark or test file, a run record
// (`run: …`), or a scorecard. A claim of benchmark, pilot or production
// evidence with nothing to look at is the inflation the frontier's own
// heading forbids.
//
// Run: node scripts/check-evidence-levels.mjs   (EVIDENCE_DOCS_DIR overrides the directory, for the planted-defect test)
// =============================================================================
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = process.env.EVIDENCE_DOCS_DIR ?? resolve(new URL('..', import.meta.url).pathname, 'docs/foundry-institution');

export const TABLES = [
  { file: 'IMPLEMENTATION_STATE.md', heading: '## Evidence frontier (do not inflate)' },
  { file: 'IMPLEMENTATION_STATE.md', heading: '### Proven — E3, or structurally enforced and mutation-verified' },
  { file: 'MATURITY_MAP.md', heading: '## Owner journeys' },
  { file: 'MATURITY_MAP.md', heading: '## The economic loop, transition by transition' },
];

const LEVEL = /\bE([0-6])\b/;
const POINTER = /`[^`\n]*(?:\.test\.ts|-benchmark(?:\.ts)?|\.mts|scorecard\.json|run:[^`\n]*)`/;

/** The rows of the first markdown table after a heading, or null when the heading is absent. */
function rowsAfter(text, heading) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at < 0) return null;
  const rows = [];
  let header = null;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6} /.test(l)) break;
    if (l.startsWith('|')) {
      if (header === null) { header = l.split('|').map((c) => c.trim()); i += 1; continue; } // the header and its separator
      rows.push(l);
    } else if (header !== null) break;
  }
  return { rows, levelColumn: header ? header.indexOf('Level') : -1 };
}

const failures = [];
let claims = 0;
const byLevel = new Map();
for (const t of TABLES) {
  const path = resolve(DIR, t.file);
  if (!existsSync(path)) { failures.push(`${t.file} is missing`); continue; }
  const table = rowsAfter(readFileSync(path, 'utf8'), t.heading);
  if (table === null) { failures.push(`${t.file}: the table under "${t.heading}" is gone — a claim moved out of the population this check reads`); continue; }
  if (table.levelColumn < 0) { failures.push(`${t.file}: the table under "${t.heading}" has no Level column`); continue; }
  if (table.rows.length === 0) { failures.push(`${t.file}: the table under "${t.heading}" has no rows`); continue; }
  for (const row of table.rows) {
    claims += 1;
    const cells = row.split('|');
    const name = cells[1]?.trim().slice(0, 70) ?? row.slice(0, 70);
    // THE LEVEL IS READ FROM ITS OWN COLUMN: an "E2" mentioned in passing elsewhere in a row is not the row's level.
    const level = LEVEL.exec(cells[table.levelColumn] ?? '');
    if (!level) { failures.push(`${t.file} · ${name}: no evidence level (E0–E6)`); continue; }
    byLevel.set(`E${level[1]}`, (byLevel.get(`E${level[1]}`) ?? 0) + 1);
    if (Number(level[1]) >= 3 && !POINTER.test(row)) failures.push(`${t.file} · ${name}: claims E${level[1]} with no pointer to what proved it (a benchmark or test file, or a \`run: …\` record)`);
  }
}

if (failures.length) {
  process.stdout.write(`evidence levels: ${String(failures.length)} claim(s) fail of ${String(claims)} read\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
  process.exit(1);
}
const tally = [...byLevel.entries()].sort().map(([k, n]) => `${k} ${String(n)}`).join(', ');
process.stdout.write(`evidence levels: every one of ${String(claims)} claims in ${String(TABLES.length)} tables carries a level, and every E3+ a pointer (${tally})\n`);
