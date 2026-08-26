#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a property read off a `SELECT *` row that is not a column
//
// `check-select-columns.mjs` reads the columns a query NAMES and checks they
// exist. It cannot check `SELECT *`, and that is where this class of defect
// lives: the row comes back as `Record<string, unknown>`, a property that is
// not a column is `undefined`, and `as number` makes it a number as far as the
// compiler is concerned. Nothing throws, ever.
//
// SEVEN OF THESE WERE FOUND BY HAND IN ONE CYCLE, all in surfaces a founder
// takes to somebody else:
//
//   `metric_snapshots.mrr_growth_pct`   read by the fundraising readiness score
//                                       AND the monthly investor update, so
//                                       both reported growth as "N/A" for every
//                                       company that has ever run them.
//   `metric_snapshots.customer_count`   the same two, plus the M&A readiness
//                                       score, where it made customer
//                                       concentration a constant.
//   `metric_snapshots.d30_retention`    the real column is `day_30_retention`.
//   `product_dna.target_customer`,      four boolean flags in the fundraising
//   `.competitors`, `.positioning`,     assessment, false for everybody: six of
//   `.core_hypothesis`,                 the ten market points and two of the
//   `.hypothesis_validated`             narrative, withheld from every company.
//
// A NAMED-COLUMN SELECT WOULD HAVE RAISED ON THE FIRST CALL. This gate is the
// substitute for that, and it is a RATCHET on the count: an entry may be a
// false positive — a row variable narrowed to another shape, a property added
// to the object after the read — so the baseline records what is known and can
// only shrink.
//
// WHAT IT SEES, stated because a gate that overstates its coverage is the
// defect it exists to catch:
//   • Only `SELECT * FROM <table>` with no JOIN and no comma-separated second
//     table. A star over a join has no single column list to check.
//   • Only a row variable initialised DIRECTLY from that query's own result —
//     `const r = await query('SELECT * FROM t …'); const row = r.rows[0]` — and
//     only within the same function. A regex version of this over a 60-line
//     window produced 56 candidates of which three hand-checked were all
//     variable-name collisions; the TypeScript parser is what makes it usable.
//   • Property reads only. A write into the object, or a spread, is ignored.
//   • It does NOT follow a row through a function call or an array `.map`.
//
// Run: node scripts/check-star-select-columns.mjs [--write]   (CI, in lint:columns)
//
// A BASELINE ENTRY THAT NO LONGER NAMES A REAL OFFENDER IS A PERMANENT
// EXEMPTION, which is the ratchet failing in the exact direction it exists to
// prevent. Fix the offender, leave the line, and the day somebody reintroduces
// it at that same place the gate says nothing — it is "known". Every sibling
// gate here refuses to pass on an improvement that has not been written down;
// this one printed a suggestion, or nothing at all. Measured rather than
// assumed: a probe line appended to each of the eleven baselines showed three
// gates accepting an entry that matched no finding.
//
// =============================================================================
import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'src/db/migrations');
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'docs/db/star-select-baseline.txt');
const COLUMN_TYPE = /^(\w+)\s+(TEXT|INTEGER|REAL|DATETIME|BLOB|NUMERIC|BOOLEAN|DATE)\b/i;

/** Split a CREATE TABLE body on the commas between definitions, not the ones
 *  inside `CHECK (x IN ('a','b'))` or `REFERENCES t(id)`. */
function definitions(body) {
  const out = [];
  let depth = 0, current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((d) => d.trim()).filter(Boolean);
}

function schema() {
  const tables = new Map();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?(\w+)/gi)) tables.delete(m[1]);
    for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      if (!tables.has(m[1])) tables.set(m[1], new Set());
      for (const definition of definitions(m[2])) {
        const column = COLUMN_TYPE.exec(definition);
        if (column) tables.get(m[1]).add(column[1]);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi)) {
      if (tables.has(m[1])) tables.get(m[1]).add(m[2]);
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+DROP COLUMN\s+(\w+)/gi)) {
      if (tables.has(m[1])) tables.get(m[1]).delete(m[2]);
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+RENAME COLUMN\s+(\w+)\s+TO\s+(\w+)/gi)) {
      if (tables.has(m[1])) { tables.get(m[1]).delete(m[2]); tables.get(m[1]).add(m[3]); }
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+RENAME TO\s+(\w+)/gi)) {
      if (tables.has(m[1])) { tables.set(m[2], tables.get(m[1])); tables.delete(m[1]); }
    }
  }
  return tables;
}

function sourceFiles(dir = SRC, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** The literal SQL of a call's first argument, or null when it is built. */
function sqlOf(node) {
  const arg = node.arguments?.[0];
  if (!arg) return null;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isTemplateExpression(arg)) return arg.head.text;   // the part before any hole
  return null;
}

/** `SELECT * FROM <table>` with one table and no join. */
function starTable(sql) {
  const m = /SELECT\s+\*\s+FROM\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  if (!m) return null;
  const rest = sql.slice(m.index + m[0].length, m.index + m[0].length + 40);
  if (/^\s*,/.test(rest) || /\bJOIN\b/i.test(sql)) return null;
  return m[1];
}

const tables = schema();
const findings = [];

/** Property names that are not columns anywhere: reading one of these means the
 *  variable is a string or an array by the time it is used, not a row. */
const NOT_A_COLUMN = new Set([
  'length', 'endsWith', 'startsWith', 'includes', 'slice', 'split', 'trim',
  'toString', 'toFixed', 'map', 'filter', 'find', 'forEach', 'reduce', 'push',
  'join', 'sort', 'some', 'every', 'at', 'concat', 'indexOf', 'replace',
  'toLowerCase', 'toUpperCase', 'then', 'catch', 'rows', 'valueOf',
]);

/** Unwrap `as X`, parentheses and `!`. */
function unwrap(node) {
  let n = node;
  for (;;) {
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) {
      n = n.expression;
      continue;
    }
    return n;
  }
}

/**
 * ONE ORDERED WALK, CARRYING AN ENVIRONMENT.
 *
 * The first version of this collected every `const x = query('SELECT * …')` in
 * a scope into one map and then checked every property read in that scope. Two
 * things break that: a file where several commands each declare `const result`
 * (the last one wins, and the reads get attributed to the wrong table), and a
 * lambda parameter with the same name as a row variable — `allPaths.some((p) =>
 * p.endsWith('.ts'))` was reported as `audit_scores.endsWith`.
 *
 * So the walk is ordered and scoped: bindings are made as they are encountered,
 * and entering a function clones the environment and DELETES anything its
 * parameters shadow.
 */
function walk(node, sf, rel, resultTable, rowTable) {
  let results = resultTable;
  let rows = rowTable;

  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
    results = new Map(results);
    rows = new Map(rows);
    for (const param of node.parameters) {
      if (ts.isIdentifier(param.name)) { results.delete(param.name.text); rows.delete(param.name.text); }
    }
  }

  if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
    const name = node.name.text;
    let init = node.initializer;
    if (ts.isAwaitExpression(init)) init = init.expression;
    init = unwrap(init);

    // `const r = query('SELECT * FROM t …')`
    if (ts.isCallExpression(init)) {
      const sql = sqlOf(init);
      const table = sql ? starTable(sql) : null;
      if (table && tables.has(table)) results.set(name, table);
      else { results.delete(name); rows.delete(name); }
    } else if (ts.isElementAccessExpression(init)) {
      // `const row = r.rows[0]`
      const target = unwrap(init.expression);
      if (ts.isPropertyAccessExpression(target) && target.name.text === 'rows'
        && ts.isIdentifier(target.expression) && results.has(target.expression.text)) {
        rows.set(name, results.get(target.expression.text));
      } else { rows.delete(name); results.delete(name); }
    } else {
      // Any other initialiser rebinds the name away from a row.
      rows.delete(name); results.delete(name);
    }
  }

  // `let row = {}; …; row = r.rows[0] as Record<string, unknown>` — the shape
  // the investor update uses, and the reason the first version of this gate
  // reported nothing when that file's defect was planted back into it.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(node.left)) {
    const name = node.left.text;
    const rhs = unwrap(node.right);
    if (ts.isElementAccessExpression(rhs)) {
      const target = unwrap(rhs.expression);
      if (ts.isPropertyAccessExpression(target) && target.name.text === 'rows'
        && ts.isIdentifier(target.expression) && results.has(target.expression.text)) {
        rows.set(name, results.get(target.expression.text));
      } else { rows.delete(name); }
    } else if (ts.isCallExpression(rhs) || ts.isAwaitExpression(node.right)) {
      const call = ts.isAwaitExpression(node.right) ? unwrap(node.right.expression) : rhs;
      const sql = ts.isCallExpression(call) ? sqlOf(call) : null;
      const table = sql ? starTable(sql) : null;
      if (table && tables.has(table)) results.set(name, table);
      else { results.delete(name); rows.delete(name); }
    } else {
      rows.delete(name);
    }
  }

  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const table = rows.get(node.expression.text);
    const prop = node.name.text;
    if (table && !NOT_A_COLUMN.has(prop) && !tables.get(table).has(prop)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      findings.push(`${rel}:${line + 1} ${table}.${prop}`);
    }
  }

  ts.forEachChild(node, (child) => walk(child, sf, rel, results, rows));
}

for (const file of sourceFiles()) {
  const rel = relative(ROOT, file);
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  walk(sf, sf, rel, new Map(), new Map());
}

const found = [...new Set(findings)].sort();
const write = process.argv.includes('--write');
if (write) {
  writeFileSync(BASELINE, found.join('\n') + (found.length ? '\n' : ''));
  console.log(`wrote ${found.length} star-select column reads`);
  process.exit(0);
}

let baseline = [];
try { baseline = readFileSync(BASELINE, 'utf8').split('\n').filter(Boolean); } catch { /* none yet */ }
const known = new Set(baseline);
const added = found.filter((f) => !known.has(f));
const fixed = baseline.filter((b) => !found.includes(b));

if (added.length > 0) {
  console.error('\nProperty read off a `SELECT *` row that is not a column of that table:\n');
  for (const a of added) console.error(`  ${a}`);
  console.error('\nA column that is not there reads as `undefined` forever and never throws.');
  console.error('Name the columns in the SELECT, or read the column that exists.');
  console.error('If this is a false positive, add it to docs/db/star-select-baseline.txt with --write.\n');
  process.exit(1);
}
if (fixed.length > 0) {
  console.error(`\n✓ ${fixed.length} star-select read(s) are gone:\n`);
  for (const f of fixed) console.error(`  ${f}`);
  console.error(`\nRemove them from ${BASELINE} with --write so they cannot come back.`);
  process.exit(1);
}
console.log(`✓ star-select reads: ${found.length} (baseline ${baseline.length})`);
