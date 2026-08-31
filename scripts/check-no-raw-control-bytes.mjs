#!/usr/bin/env node
// =============================================================================
// A RAW CONTROL BYTE MAKES A SOURCE FILE UNREVIEWABLE.
//
// git decides whether a file is text by looking for a NUL in its first 8000
// bytes. One raw NUL there and every diff of that file, forever, prints
//
//     Binary files a/path and b/path differ
//
// instead of the change. Not a warning -- the change simply is not shown, in
// git diff, in git show, in git log -p, or in a pull request review. grep skips
// the file for the same reason and says only "binary file matches", so an audit
// that greps the tree reads straight past it.
//
// Two files here had one, and neither was corruption. Both were deliberate and
// both were right in intent: a NUL delimiter around a cache sentinel, and a NUL
// joining fields before hashing so no field's content can forge a boundary. The
// value wanted was correct. Only the ENCODING was wrong -- a raw byte where an
// escape says exactly the same thing to the compiler.
//
// One of the two was services/institution/development-observation.ts, the
// single writer of development observations, whose identity is content-derived
// and inserted with INSERT OR IGNORE. Change that separator and every
// observation re-records under a new id, inflating the very evidence the
// maturity ratchets read. That file, of all files, must be diffable.
//
// WHAT IT CHECKS: any C0 control byte other than tab and newline, plus DEL,
// anywhere in a source file under src, tests or scripts. Carriage return is
// included; a stray CR is a line-ending accident, not an intention.
//
// WHAT IT DOES NOT CHECK: docs and generated snapshots. Those are not compiled
// and a control byte in them costs a diff, not a behaviour.
//
// THE FIX IS ALWAYS THE SAME and never changes behaviour: write the escape.
// A backslash-u-0-0-0-0 escape compiles to the identical string as a raw NUL,
// and the file stays text. There is no case where the raw byte is required.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ROOTS = ['src', 'tests', 'scripts'].map((d) => join(ROOT, d));
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.sql', '.json'];

// Tab (0x09) and newline (0x0A) are ordinary text. Everything else below 0x20,
// plus DEL, is not something a source file has a reason to carry raw.
function offending(byte) {
  return (byte < 0x20 && byte !== 0x09 && byte !== 0x0a) || byte === 0x7f;
}

const NAMES = {
  0x00: 'NUL', 0x07: 'BEL', 0x08: 'BS', 0x0b: 'VT',
  0x0c: 'FF', 0x0d: 'CR', 0x1b: 'ESC', 0x7f: 'DEL',
};

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else if (EXTENSIONS.some((e) => path.endsWith(e))) out.push(path);
  }
  return out;
}

const offences = [];
let scanned = 0;
for (const root of ROOTS) {
  for (const file of files(root)) {
    scanned += 1;
    const bytes = readFileSync(file);
    for (let i = 0; i < bytes.length; i += 1) {
      if (!offending(bytes[i])) continue;
      // Count newlines before the offence so the report names a real line.
      let line = 1;
      for (let j = 0; j < i; j += 1) if (bytes[j] === 0x0a) line += 1;
      const name = NAMES[bytes[i]] ?? `0x${bytes[i].toString(16).padStart(2, '0')}`;
      const unreviewable = bytes[i] === 0x00 && i < 8000;
      offences.push(
        `${relative(ROOT, file)}:${line}  raw ${name}`
        + (unreviewable ? '  -- git will diff this whole file as binary' : ''));
      break; // One report per file is enough to send someone to the file.
    }
  }
}

if (offences.length) {
  console.error(
    '\nRaw control byte in source:\n\n'
    + offences.map((o) => `  ${o}`).join('\n')
    + '\n\nWrite it as an escape instead. A backslash-u-0-0-0-0 escape compiles to\n'
    + 'the same string as a raw NUL, and the file stays diffable and greppable.\n');
  process.exit(1);
}
console.log(`✓ no raw control bytes in source (${scanned} files)`);
