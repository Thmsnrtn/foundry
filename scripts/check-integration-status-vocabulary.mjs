#!/usr/bin/env node
// =============================================================================
// FOUNDRY — the integration status that nothing reads
//
// `integrations.status` is `TEXT NOT NULL DEFAULT 'pending'` with NO CHECK
// constraint on the live table. A column with no vocabulary accepts every
// spelling of every state, and only the READERS know which ones mean anything.
// Here they agree completely: `sync.ts` selects `status IN ('active','error')`,
// every adapter in `services/integration/` guards on `status === 'active'`,
// `framework.ts` selects `WHERE status = 'active'` for the due-sync sweep, and
// the integrations page's badge tests `status === 'active'`.
//
// So 'connected' means nothing. Writing it stores an integration nothing will
// ever sync; guarding on it refuses every integration that is correctly
// connected.
//
// MIGRATION 074 ESTABLISHED THIS AND REPAIRED THE ROWS. `fabric.ts` repeats it
// in a JSDoc that says, in these words, "Do NOT write 'connected'". Both were
// written down, and two sites were still wrong:
//
//   • `POST /integrations/:type/connect` wrote 'connected' on INSERT while its
//     own UPDATE branch four lines above wrote 'active' — so every FIRST
//     connect produced an integration that never synced and a page reading
//     "Not connected", and 074's repair was undone one founder at a time.
//   • `executeLinearTicket` still REQUIRED 'connected', so every Linear ticket
//     came back "not connected" for a correctly connected integration.
//
// A rule written into a migration and a docstring and broken twice anyway is a
// wish. This is the mechanical version.
//
// WHAT IT CHECKS: the literal 'connected' anywhere in `src/`, with comments
// stripped first — so the paragraphs above, and the ones in `fabric.ts` and
// migration 074 that explain the rule, do not trip the rule they explain. The
// baseline holds the uses that are not about this column at all.
//
// WHY A BARE LITERAL AND NOT SOMETHING CLEVERER: the value is not on the same
// line as the column in an INSERT — the column list is one line up — so a
// line-scoped check for `status` near 'connected' misses exactly the case that
// caused this. The literal is rare enough that a baseline of the legitimate
// uses is smaller and more honest than a parser that could be wrong.
// =============================================================================

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'docs/db/integration-status-literals-baseline.txt');

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const findings = [];
for (const file of files(SRC)) {
  const source = stripComments(readFileSync(file, 'utf8'), { lineComments: true });
  source.split('\n').forEach((line, index) => {
    if (!line.includes("'connected'")) return;
    findings.push(`${relative(ROOT, file)}:${index + 1}`);
  });
}
findings.sort();

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').trim().split('\n').filter(Boolean);
} catch { /* first run */ }

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, `${findings.join('\n')}\n`);
  console.log(`integration status literals baseline written: ${findings.length}`);
  process.exit(0);
}

// Line numbers move, so the baseline is compared by FILE. A new occurrence in a
// file that already has one still has to be justified by rewriting the
// baseline, which is the moment somebody reads this header.
const countByFile = (list) => list.reduce((m, f) => {
  const file = f.split(':')[0];
  m.set(file, (m.get(file) ?? 0) + 1);
  return m;
}, new Map());

const now = countByFile(findings);
const known = countByFile(baseline);
const appeared = [...now].filter(([f, n]) => n > (known.get(f) ?? 0));
const fixed = [...known].filter(([f, n]) => n > (now.get(f) ?? 0));

if (appeared.length) {
  console.error("\n✗ the literal 'connected' appeared in:\n");
  for (const [f, n] of appeared) console.error(`  ${f}  (${n}, baseline ${known.get(f) ?? 0})`);
  console.error("\nNothing reads that integration status. Writing it stores an");
  console.error('integration no sync will ever pick up; guarding on it refuses every');
  console.error("integration that is correctly connected. Use 'active'. If this");
  console.error(`occurrence is about something else entirely, add it to ${relative(ROOT, BASELINE)}`);
  console.error('with --write in the same commit, so the next reader can see why.\n');
  process.exit(1);
}
if (fixed.length) {
  console.error(`✓ ${fixed.length} file(s) no longer carry it: ${fixed.map(([f]) => f).join(', ')}`);
  console.error(`Rerun with --write so it cannot come back.`);
  process.exit(1);
}
console.log(`✓ integration status vocabulary: ${findings.length} permitted 'connected' literal(s)`);
