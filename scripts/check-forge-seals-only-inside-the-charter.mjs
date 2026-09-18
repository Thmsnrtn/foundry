#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a design is sealed only inside the charter
//
// Sealing a design is the moment a test stops being editable and starts being
// the record the owner or the charter decides on. Two hands seal today: the
// owner's own allow (hand.ts), and the hand-written second experiment the
// owner decided himself (proof-2.ts). The forge is the third, and it is the
// one that acts with nobody watching — so the rule it must obey is held here:
// any file that seals a design and is not one of the owner's two hands must
// ask the charter first, in the same file, before the seal.
//
// Textual on purpose. A dynamic import of `chartered` that appears after the
// seal, or in a comment, does not count.
//
// Run: node scripts/check-forge-seals-only-inside-the-charter.mjs   (in lint:columns)
// =============================================================================
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = resolve(ROOT, 'src');

/** The owner's own hands, which seal at his decision. */
const THE_OWNERS_HANDS = new Set([
  'src/services/venture/probe-design.ts',
  'src/services/venture/hand.ts',
  'src/services/venture/proof-2.ts',
]);

function tsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const failures = [];
for (const f of tsFiles(SRC)) {
  const rel = relative(ROOT, f);
  if (THE_OWNERS_HANDS.has(rel)) continue;
  const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
  const seal = src.search(/\bsealDesign\s*\(/);
  if (seal < 0) continue;
  const asked = src.search(/\bchartered\s*\(/);
  if (asked < 0) failures.push(`${rel}: seals a design and never asks the charter`);
  else if (asked > seal) failures.push(`${rel}: seals a design before asking the charter`);
}

if (failures.length) {
  console.error('a design may be sealed only inside the charter:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('every seal outside the owner\'s hands asks the charter first');
