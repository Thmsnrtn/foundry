#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a parameterised statement must have as many arguments as it has
//           placeholders
//
// `generateScenariosForProduct` wrote `forecast_scenarios` with SEVEN
// placeholders and SIX arguments. `generated_by` bound to nothing, the column
// is NOT NULL, and the insert raised — every time, since it was written. Both
// callers swallow errors, so the nightly job logged "Generated scenarios for 0
// products" and the page simply never showed a scenario. Nobody found out.
//
// This is invisible to every other gate here: the SQL is valid, the columns all
// exist, the types check. It is only wrong in the relationship between two
// pieces of one call, and it fails at runtime in a path somebody catches.
//
// WHAT IS CHECKED, deliberately a subset: a call whose SQL argument is a single
// literal with no interpolation, and whose second argument is an array literal
// with no spreads. Anything less certain is skipped rather than guessed at — a
// gate that cries wolf gets baselined into uselessness.
// =============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * `?` placeholders, not counting any inside a SQL string literal or comment.
 *
 * COMMENTS ARE SKIPPED BEFORE QUOTES ARE READ, and that ordering is the whole
 * correctness of this function. The first version toggled string state on every
 * apostrophe, so a comment reading "Migration 178's trigger" opened a string
 * that never closed and every placeholder after it went uncounted. It reported
 * five false positives against real, correct code — which is the failure mode
 * that makes a gate worth less than nothing, since the fix for noise is a
 * baseline and a baseline is where a gate goes to stop working.
 */
function countPlaceholders(sql) {
  let count = 0, inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (!inString) {
      if (ch === '-' && sql[i + 1] === '-') {
        const nl = sql.indexOf('\n', i);
        if (nl === -1) break;
        i = nl;
        continue;
      }
      if (ch === '/' && sql[i + 1] === '*') {
        const close = sql.indexOf('*/', i + 2);
        if (close === -1) break;
        i = close + 1;
        continue;
      }
    }
    if (ch === "'") {
      // Doubled '' is an escaped quote inside a SQL string.
      if (inString && sql[i + 1] === "'") { i++; continue; }
      inString = !inString;
    } else if (ch === '?' && !inString) count++;
  }
  return count;
}

/** Split a bracketed argument list at depth-zero commas. Returns null if the
 *  text is not a balanced literal we can read with confidence. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0, current = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { current += ch + (text[i + 1] ?? ''); i++; continue; }
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; current += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (depth < 0) return null;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (depth !== 0 || quote) return null;
  if (current.trim() !== '') parts.push(current);
  return parts;
}

/** From `open` (index of the char after `[`), find the matching `]`. */
function matchBracket(src, open, closeChar, openChar) {
  let depth = 1, quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const CALLERS = /\b(?:query|safeQuery|dbQuery|db)\s*\(\s*(`|')/g;
const findings = [];
let checked = 0;

for (const file of walk('src')) {
  // TYPESCRIPT COMMENTS GO FIRST, for the same reason SQL comments do inside
  // the counter: a `//` note reading "the record said 'system'" opens a quote
  // the splitter carries into the next argument, and the count comes out one
  // high. `strip-comments.mjs` preserves whitespace, so reported lines are the
  // real ones.
  const src = stripComments(readFileSync(file, 'utf8'), { lineComments: true });
  let m;
  CALLERS.lastIndex = 0;
  while ((m = CALLERS.exec(src)) !== null) {
    const quote = m[1];
    const sqlStart = m.index + m[0].length;
    // Find the end of the SQL literal.
    let i = sqlStart, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === quote) { end = i; break; }
    }
    if (end === -1) continue;
    const sql = src.slice(sqlStart, end);

    // Interpolation can carry placeholders of its own — skip rather than guess.
    if (quote === '`' && sql.includes('${')) continue;
    if (!/\?/.test(sql)) continue;

    // The argument array must follow immediately: `, [ … ]`.
    const after = src.slice(end + 1);
    const arrayMatch = /^\s*,\s*\[/.exec(after);
    if (!arrayMatch) continue;
    const arrayOpen = end + 1 + arrayMatch[0].length;
    const arrayClose = matchBracket(src, arrayOpen, ']', '[');
    if (arrayClose === -1) continue;

    const inner = src.slice(arrayOpen, arrayClose);
    if (inner.includes('...')) continue;      // spread: unknowable statically
    const parts = splitTopLevel(inner);
    if (parts === null) continue;

    const args = parts.filter((p) => p.trim() !== '').length;
    const placeholders = countPlaceholders(sql);
    checked++;
    if (args !== placeholders) {
      const line = src.slice(0, m.index).split('\n').length;
      findings.push(
        `${file}:${line}  ${placeholders} placeholder(s), ${args} argument(s)`);
    }
  }
}

if (findings.length > 0) {
  console.error('✗ parameterised statements whose argument count does not match:');
  for (const f of findings) console.error(`  ${f}`);
  console.error('\nA missing argument binds NULL, or the driver refuses the statement.');
  console.error('Either way it fails at runtime, in a path something may be catching.');
  process.exit(1);
}
console.log(`✓ query arity: ${checked} literal parameterised statements match their arguments`);
