#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a migration must apply in the same order everywhere
//
// `migrate.ts` reads the migrations directory, sorts LEXICALLY, and applies
// every file not already named in `schema_migrations`. That is deterministic
// on a fresh database. It is not the order an EXISTING database uses.
//
// An existing database applies only the files it has never seen, and it
// applies them after everything it already has. So a migration whose number
// sorts BEFORE an already-applied file runs in one position on a fresh
// database and a different position in production. Every test in this
// repository builds a fresh database, and `docs/db/schema.snapshot.sql` is
// generated from one — so the divergence is invisible to all of them. The
// suite stays green while production ends up with a schema nobody has
// described, and a migration mis-order in production is close to
// irreversible.
//
// Nothing prevented that. This does.
//
// THREE INVARIANTS:
//
//   1. FIXED-WIDTH NUMBERING. `NNN_name.sql`, three digits. This is what makes
//      lexical order equal numeric order — the assumption `migrate.ts` is
//      built on and states in a comment. The day somebody writes
//      `1000_thing.sql`, it sorts before `999_thing.sql` and the comment
//      becomes false silently.
//
//   2. LEXICAL ORDER == NUMERIC ORDER. Computed rather than assumed, so this
//      keeps holding if the naming rule is ever widened.
//
//   3. THE HIGHEST NUMBER IS UNIQUE, and duplicate numbers may only decrease.
//      Thirty-one numbers are duplicated from early parallel development
//      (004–033, 056). Those are long applied everywhere and their relative
//      order is settled; rewriting them now would be the more dangerous act.
//      They are baselined. What must never happen again is a NEW file taking a
//      number that already exists — and in particular taking a number at or
//      below the current maximum, which is the case that reorders production.
//
// Run: node scripts/check-migration-order.mjs [--write]
// =============================================================================
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'src/db/migrations');
const BASELINE = join(ROOT, 'docs/db/duplicate-migration-numbers.txt');

const NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const problems = [];

// ── 1. shape ────────────────────────────────────────────────────────────────
const malformed = files.filter((f) => !NAME.test(f));
if (malformed.length > 0) {
  problems.push(
    'Migration filenames must be NNN_lower_snake.sql with exactly three digits.\n'
    + 'Three digits is what makes lexical order equal numeric order, which is\n'
    + 'the assumption the migrator applies them under:\n'
    + malformed.map((f) => `  ${f}`).join('\n'));
}

// ── 2. lexical order == numeric order ───────────────────────────────────────
const numbered = files.filter((f) => NAME.test(f));
const byNumber = [...numbered].sort((a, b) => {
  const d = Number(a.match(NAME)[1]) - Number(b.match(NAME)[1]);
  return d !== 0 ? d : a.localeCompare(b);
});
const firstDivergence = numbered.findIndex((f, i) => f !== byNumber[i]);
if (firstDivergence !== -1) {
  problems.push(
    'Lexical order and numeric order disagree, so the migrator does not apply\n'
    + 'these in the order their numbers imply. First divergence at position '
    + `${firstDivergence}:\n`
    + `  lexical: ${numbered[firstDivergence]}\n`
    + `  numeric: ${byNumber[firstDivergence]}`);
}

// ── 3. duplicate numbers, ratcheted; and the maximum must be unique ─────────
const byPrefix = new Map();
for (const f of numbered) {
  const n = f.match(NAME)[1];
  if (!byPrefix.has(n)) byPrefix.set(n, []);
  byPrefix.get(n).push(f);
}
const duplicates = [...byPrefix.entries()]
  .filter(([, fs]) => fs.length > 1).map(([n]) => n).sort();

const maxPrefix = numbered.length > 0
  ? [...byPrefix.keys()].sort((a, b) => Number(a) - Number(b)).at(-1) : null;
if (maxPrefix && byPrefix.get(maxPrefix).length > 1) {
  problems.push(
    `Two migrations share the highest number ${maxPrefix}:\n`
    + byPrefix.get(maxPrefix).map((f) => `  ${f}`).join('\n')
    + '\nThe next migration\'s number has to be unambiguous, and a file added at\n'
    + 'the current maximum is exactly the case that applies in a different\n'
    + 'position on a fresh database than in production.');
}

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, duplicates.join('\n') + '\n');
  console.log(`wrote ${duplicates.length} duplicated migration numbers`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
} catch {
  problems.push(`Missing baseline ${BASELINE}. Run with --write to create it.`);
}

const added = duplicates.filter((n) => !baseline.includes(n));
if (added.length > 0) {
  problems.push(
    `New duplicated migration numbers: ${added.join(', ')}\n`
    + 'A new migration must take a number no file already uses, and higher than\n'
    + `every existing one (currently ${maxPrefix}). Reusing a number means this\n`
    + 'migration applies in one position on a fresh database and another in\n'
    + 'production, and no test in this repository can see the difference.');
}

if (problems.length > 0) {
  console.error('\n' + problems.join('\n\n') + '\n');
  process.exit(1);
}

const resolved = baseline.filter((n) => !duplicates.includes(n));
if (resolved.length > 0) {
  console.error(
    `These duplicate numbers were resolved — remove them from the baseline so\n`
    + `they cannot come back: ${resolved.join(', ')}\n`);
  process.exit(1);
}

console.log(
  `✓ ${numbered.length} migrations apply in one order everywhere `
  + `(highest ${maxPrefix}, ${duplicates.length} historical duplicate numbers)`);
