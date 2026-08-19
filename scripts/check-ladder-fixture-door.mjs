#!/usr/bin/env node
// =============================================================================
// FOUNDRY — test fixtures that enter the ladder through a door production
//           does not have
//
// `emitSignalEvent` is the only function that runs responsibility discovery,
// and it has exactly one caller: the founder-and-company report path.
// `discovery.ts` ALSO maps four SaaS event types straight onto
// responsibilities — `payment_failed`, `churn_detected`, `support_spike`,
// `activation_failure` — and nothing in production emits any of them through
// the dispatcher. Three appear nowhere else in the repository at all.
//
// That map is dead in production and alive in the tests: when this gate was
// built, twenty test files — including the shared ladder fixture every other
// one depends on — constructed their state through it. So a substantial part of
// the institution's own suite entered through a door the running system does
// not have, and proved rather less about the system than it appeared to.
//
// This is a RATCHET on that number, not a wall. Deleting the map outright
// turned twenty-five tests red across seven files at once, which is not how a
// suite gets moved onto a real door — it is how tests get weakened under
// pressure. Each file leaves this list when its fixture is rewritten to report
// an obligation the way a company actually does, using
// `reportedObligation()` from `tests/fixtures/responsibility-state.ts`.
//
// The number may fall and never rise. When it reaches zero the map can be
// deleted and this gate with it.
//
// Run: node scripts/check-ladder-fixture-door.mjs [--write]
// =============================================================================
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const TESTS = join(ROOT, 'tests');
const BASELINE = join(ROOT, 'docs/db/ladder-fixture-door-baseline.txt');

const SAAS_EVENTS = /payment_failed|churn_detected|support_spike|activation_failure/;

/**
 * COMMENTS ARE NOT CODE, and a gate that cannot tell them apart punishes the
 * one thing it should reward: a fixture whose comment explains which door it
 * moved off and why. The first version of this gate did exactly that — the
 * files migrated onto the real intake stayed on the list because their
 * migration notes named the events they had stopped using.
 *
 * Stripping is deliberately conservative. String literals are preserved, so an
 * event type inside quotes is still found, and `//` inside a string is not
 * mistaken for the start of a comment. Template literals are treated as
 * strings, which is what matters here: SQL fixtures are written in backticks.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') { out += source[i]; i++; }
        if (i < source.length) { out += source[i]; i++; }
      }
      out += quote; i++;
      continue;
    }
    out += c; i++;
  }
  return out;
}

// Files whose SUBJECT is this defect rather than an instance of it. Both assert
// against the dead map in code — proving it is unreachable, and proving what
// discovery does with the event types that reach it — so stripping comments
// does not and should not clear them.
const ABOUT_THE_DEFECT = [
  'tests/unit/discovery-is-not-reachable-from-integrations.test.ts',
  'tests/unit/responsibility-discovery.test.ts',
  // Asserts the map's exact contents — that generalising the intake did not
  // quietly change what integration evidence means. It reads the four names; it
  // does not build a fixture through them.
  'tests/unit/founder-reported-obligations.test.ts',
];

// A DIFFERENT VOCABULARY THAT SHARES A WORD. `NOTICE_KINDS` is the closed set
// of account notices an erased or paused account may still receive — billing
// and access, nothing to do with responsibility discovery. It contains the
// string `payment` + `_failed` because a failed payment is a thing a person
// must be told about, not because anything emits a discovery signal.
//
// Kept separate from ABOUT_THE_DEFECT on purpose: that list is files whose
// subject IS this defect, and conflating the two would turn an honest
// name-collision exemption into a place to hide instances.
const DIFFERENT_VOCABULARY = [
  'tests/unit/account-notice-exemption.test.ts',
];

function testFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? testFiles(path)
      : path.endsWith('.ts') ? [path] : [];
  });
}

const offenders = testFiles(TESTS)
  .filter((f) => SAAS_EVENTS.test(stripComments(readFileSync(f, 'utf8'))))
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !ABOUT_THE_DEFECT.includes(f) && !DIFFERENT_VOCABULARY.includes(f))
  .sort();

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, offenders.join('\n') + '\n');
  console.log(`wrote ${offenders.length} files entering through the SaaS door`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
} catch {
  console.error(`Missing baseline ${BASELINE}. Run with --write to create it.`);
  process.exit(1);
}

const added = offenders.filter((f) => !baseline.includes(f));
if (added.length > 0) {
  console.error(
    '\nNew test fixtures entering the ladder through an event type nothing in\n'
    + 'production emits:\n\n'
    + added.map((f) => `  ${f}`).join('\n')
    + '\n\nUse `reportedObligation()` from tests/fixtures/responsibility-state.ts.\n'
    + 'It goes through the one door discovery actually has — a company saying\n'
    + 'what it owes — so the state the test asserts against is state the running\n'
    + 'system can reach.\n');
  process.exit(1);
}

const resolved = baseline.filter((f) => !offenders.includes(f));
if (resolved.length > 0) {
  console.error(
    `\n${resolved.length} file(s) moved onto the real door. Remove them from the\n`
    + 'baseline with --write so they cannot come back:\n\n'
    + resolved.map((f) => `  ${f}`).join('\n') + '\n');
  process.exit(1);
}

console.log(
  `✓ ladder fixtures on the unreachable door: ${offenders.length} (baseline ${baseline.length})`);
