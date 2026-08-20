#!/usr/bin/env node
// =============================================================================
// A BACKTICK INSIDE AN EMBEDDED COMMENT ENDS THE TEMPLATE LITERAL AROUND IT.
//
// SQL and HTML written in TypeScript live inside template literals, and the
// comments inside that SQL and HTML are written in the same prose style as the
// comments outside it — where naming a symbol in backticks is the house style.
// Inside a template literal a backtick is not punctuation, it is the closing
// delimiter, and the parse error surfaces tens of lines away from the cause.
//
// This has happened three times in one campaign, each time to somebody who had
// already written the lesson down. A rule that keeps being broken by the person
// who wrote it is not a rule, it is a wish. This is the mechanical version.
//
// WHAT IT CHECKS, exactly: a line inside a template literal that begins a SQL
// comment (`--`) or an HTML comment and also contains a backtick. Nothing else.
//
// WHAT IT DOES NOT CHECK, and why it does not try:
//   • Backticks elsewhere inside a template literal. Nested template literals
//     are ordinary and correct, so the general form needs a real parser.
//   • Whether the SQL or HTML is valid. Other gates own that.
//
// A narrow check that never lies beats a broad one that cries wolf.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ROOTS = ['src', 'tests', 'scripts'].map((d) => join(ROOT, d));

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else if (path.endsWith('.ts') || path.endsWith('.mjs')) out.push(path);
  }
  return out;
}

const offences = [];
for (const root of ROOTS) {
  for (const file of files(root)) {
    const source = readFileSync(file, 'utf8');
    let inTemplate = false;
    source.split('\n').forEach((line, index) => {
      // A line's own comment status is decided BEFORE counting its backticks,
      // so the offending line is reported rather than the one after it.
      const wasInTemplate = inTemplate;
      const trimmed = line.trim();
      const embeddedComment = trimmed.startsWith('--') || trimmed.startsWith('<!--');
      if (wasInTemplate && embeddedComment && line.includes('`')) {
        offences.push(`${relative(ROOT, file)}:${index + 1}  ${trimmed.slice(0, 78)}`);
      }
      // Backticks toggle template state. Escaped ones do not.
      const ticks = (line.match(/(?<!\\)`/g) ?? []).length;
      if (ticks % 2 === 1) inTemplate = !inTemplate;
    });
  }
}

if (offences.length) {
  console.error(
    '\nBacktick inside an embedded comment, within a template literal:\n\n'
    + offences.map((o) => `  ${o}`).join('\n')
    + '\n\nThe backtick closes the template literal. The parse error will point\n'
    + 'somewhere else entirely. Write the symbol name without backticks.\n');
  process.exit(1);
}
console.log(`✓ no backticks in embedded SQL/HTML comments (${ROOTS.length} roots)`);
