#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a decision the owner cannot classify is not a decision
//
// On 10 September the owner pressed nine buttons in one hundred and thirty-seven
// seconds. Every one of them read "Go ahead — nothing" or "Go ahead — $100.00".
// Eight were internal tests. The ninth was an experiment whose text begins
// "Write once to each approved Massachusetts millwork business as Thomas
// Norton". Nothing reached anybody, because the outbound path requires an
// authorised act and none was created — the boundary held. The interface did
// not.
//
// The repair is not nicer copy on that one card. It is that a consequential
// control can only be rendered from a computed consequence, so a page CANNOT be
// written that omits where the act lands. This gate is what makes that true
// tomorrow, when somebody adds the next card in a hurry.
//
// FOUR RULES, all static, all cheap:
//
//   1. Only `decision-control.ts` may write a form that decides a whole test.
//      Everywhere else that is a hand-made control which answered no questions.
//   2. "Go ahead" is banned outright. It is the label that started this, and it
//      describes no act ever performed by any button.
//   3. Every `renderDecision` call passes a `consequence`. The type system says
//      so too; this says it in a way a cast cannot get around.
//   4. A route that decides an experiment must classify it first. Any file that
//      calls `decideExperiment` must also call `consequenceOfApproving`.
//
// WHAT THIS GATE DOES NOT DO: it cannot read a label and tell you whether the
// sentence is true. `labelFor` is what guarantees the class appears in the
// words, and a unit test holds it to that. This gate guarantees the label came
// from `labelFor` at all.
// =============================================================================
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

/** The tree to scan. A test points this at a planted defect; nothing else does. */
const ROUTES = process.argv[2] ?? 'src/routes';
/** The one file allowed to build a decision form, because it is the one that
 *  cannot build one without a consequence. */
const THE_CONTROL = join(ROUTES, 'dashboard', 'decision-control.ts');

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

const failures = [];
const files = walk(ROUTES);

for (const file of files) {
  const code = stripComments(readFileSync(file, 'utf8'));

  // ── 1 ── Whole-test decisions are built in one place ────────────────────
  //
  // Narrow on purpose: a form that decides an EXPERIMENT. The per-recipient
  // controls on the dedicated authorisation page are consequential too, and
  // they stay hand-written because that page states the consequence around them
  // and one facts block per business would bury the twenty-three it is there to
  // show. What is banned is the control that decides the whole test — the one
  // that on 10 September looked identical whichever test it decided.
  for (const form of code.matchAll(/<form[\s\S]{0,900}?<\/form>/g)) {
    if (file === THE_CONTROL) break;
    if (/name=["']experimentId["']/.test(form[0]) && /name=["']decision["']/.test(form[0])) {
      failures.push(`${file}: writes a whole-test decision form by hand. Render `
        + `it through renderDecision() so it cannot exist without saying where `
        + `the act lands.`);
    }
  }

  // ── 2 ── The label that started this ────────────────────────────────────
  if (/Go ahead/.test(code)) {
    failures.push(`${file}: contains the label "Go ahead". A button says what it `
      + `does; this one said what the owner was expected to feel about it.`);
  }

  // ── 3 ── No control without a consequence ───────────────────────────────
  for (const call of code.matchAll(/renderDecision\(\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
    if (!/consequence\s*:/.test(call[1])) {
      failures.push(`${file}: renderDecision() called without a consequence.`);
    }
  }

  // ── 4 ── Deciding without classifying ───────────────────────────────────
  if (/decideExperiment\(/.test(code) && !/consequenceOfApproving\(/.test(code)) {
    failures.push(`${file}: decides an experiment without classifying it first. `
      + `A route that cannot say what approval would do must not offer it.`);
  }
}

if (failures.length) {
  console.error('✗ decision legibility');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`✓ every consequential control says where the act lands `
  + `(${files.length} route files)`);
