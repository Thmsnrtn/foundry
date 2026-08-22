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
// WHAT IT CHECKS, exactly: a line that is part of a SQL comment (`--`) or an
// HTML comment and contains a backtick.
//
// IT USED TO ALSO REQUIRE "inside a template literal", AND THAT TRACKING WAS
// WRONG. The state was a boolean toggled on any line with an odd number of
// backticks — and template literals NEST. In `routes/dashboard/portfolio.ts`
// the line `${fleet.map(({ product, signal }) => html\`` opens a second
// template inside the first; one backtick, odd, so the flag flipped OFF. Every
// line inside that nested template — which is where the HTML actually is — was
// then invisible, and a backticked symbol in an HTML comment there sailed
// through while tsc reported a parse error. Found the sixth time this campaign
// put a symbol in backticks inside embedded markup.
//
// The condition is simply gone rather than repaired, because it was never
// load-bearing. In a TypeScript or .mjs file, a line whose trimmed text opens
// with a SQL comment marker, or sits inside an HTML comment, is only ever SQL
// or HTML written inside a template literal — TypeScript's own comments start
// with a double slash or a slash-star. Tracking template state to confirm what
// the comment syntax already proves added a second thing that could be wrong,
// and it was.
//
// A TYPESCRIPT COMMENT LINE IS SKIPPED OUTRIGHT, and that is not a hole. The
// first version of this simplification flagged its own header, because these
// very paragraphs name HTML comment syntax while explaining it — prose that
// quotes markup read as markup, which is the same mistake one level up. A line
// that is TypeScript prose cannot be embedded markup, so it is neither tested
// nor allowed to change the HTML-comment state.
//
// CONTINUATION LINES COUNT, and that was a real miss. The first version tested
// only whether a line BEGAN a comment, so a multi-line HTML comment hid the
// defect on every line after the first — which is exactly where a long
// explanation puts the symbol it is naming. It caught nothing while a parse
// error sat in the tree. An HTML comment now stays open until its terminator.
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
    let inHtmlComment = false;
    source.split('\n').forEach((line, index) => {
      const trimmed = line.trim();
      // TypeScript prose. Not markup, and not allowed to open an HTML comment
      // by talking about one.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      const wasInHtmlComment = inHtmlComment;
      if (trimmed.includes('<!--')) inHtmlComment = true;
      // A SQL comment ends at the newline; an HTML one runs until its
      // terminator, so a continuation line is still inside it.
      const embeddedComment = trimmed.startsWith('--') || wasInHtmlComment || trimmed.includes('<!--');
      if (line.includes('-->')) inHtmlComment = false;
      if (embeddedComment && line.includes('`')) {
        offences.push(`${relative(ROOT, file)}:${index + 1}  ${trimmed.slice(0, 78)}`);
      }
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
