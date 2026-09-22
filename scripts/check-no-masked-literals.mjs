#!/usr/bin/env node
// =============================================================================
// MASKING A VALUE YOU HAVE ALREADY WRITTEN DOWN IS NOT REDACTION.
//
// 22 September 2026. A test fixture for the Etsy application key read:
//
//   const GOOD = { keystring: '<the owner's real keystring>'.replace(/./g, 'x') };
//
// At runtime that is twenty-four x's, which is all the test needed. In the
// FILE, and in every clone of the repository's history, it is the real value.
// The `.replace` made it look deliberate — as though the secret had been
// handled — while doing nothing whatsoever about the only place it mattered.
//
// The owner believed the repository was private. It is public. Neither fact
// changes what this gate is for: a credential does not belong in source
// either way, and AGENTS.md says so without reference to who can read it.
//
// WHAT THIS REFUSES. A string literal with a whole-string masking call applied
// directly to it — `.replace(/./g, …)`, `.replace(/./gu, …)` and the same with
// a character class that matches everything. There is no legitimate reason to
// write a literal and immediately destroy every character of it: if the value
// does not matter, write the masked form; if it does, it is not a literal.
//
// WHAT IT DELIBERATELY DOES NOT DO. It cannot detect a secret pasted in
// plainly — nothing pattern-based can, and a gate that claims to would be
// worse than none. It catches exactly one mistake: the one that looks careful.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'tests', 'scripts'];
const EXT = /\.(ts|tsx|mjs|js)$/;
const SELF = 'scripts/check-no-masked-literals.mjs';

/**
 * A quoted literal, on ONE line, with a whole-string masking call applied
 * straight to it. The regex that does the masking has to match every
 * character — `.` , `[^]`, `[\s\S]` or `[\S\s]` — and carry the global flag.
 *
 * Narrow on purpose. `\`${tool}\`.replace(/[_-]/g, ' ')` in the reserved-powers
 * reader is not this mistake: `[_-]` matches two characters, the subject is
 * built at runtime, and normalising a tool name is the whole point. A gate
 * that flagged it would be a gate somebody turns off.
 */
const ALL = String.raw`(?:\.|\[\^\]|\[\\s\\S\]|\[\\S\\s\])`;
const MASKED = new RegExp(
  String.raw`(['"\x60])(?:\\.|(?!\1)[^\\\n])*\1\s*\.replace\(\s*/${ALL}/[a-z]*g[a-z]*\s*,`,
  'g',
);

/**
 * Comments are stripped before scanning, because this file and the record of
 * the mistake both have to be able to describe the pattern in prose without
 * the gate firing on the description.
 */
function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

const found = [];
for (const root of ROOTS) {
  let files;
  try { files = walk(root, []); } catch { continue; }
  for (const file of files) {
    const rel = relative('.', file);
    if (rel === SELF) continue;
    const src = withoutComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(MASKED)) {
      const line = src.slice(0, m.index).split('\n').length;
      found.push({ rel, line });
    }
  }
}

if (found.length) {
  console.error('\nA literal is written out and then masked character by character.');
  console.error('The masked form is what the code uses; the real one is what the file');
  console.error('and its history keep. Write the masked form directly.\n');
  for (const f of found) console.error(`  ${f.rel}:${f.line}`);
  console.error('');
  process.exit(1);
}

console.log('✓ no literal is written out and then masked away (3 roots)');
