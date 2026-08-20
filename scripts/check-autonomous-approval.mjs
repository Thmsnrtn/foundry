#!/usr/bin/env node
// =============================================================================
// FOUNDRY — nothing approves an action for the founder without asking who said
//
// `approveAndExecute` is the door between "Foundry proposed this" and "Foundry
// did this." Three callers reach it, and for a long time only two of them
// asked whether they were allowed to:
//
//   routes/dashboard/agents-actions.ts   requireCompanyCapability('can_trigger_actions')
//   services/departments/success.ts      activeConsent(...)
//   services/scp/playbooks/…-engine.ts   nothing at all
//
// The third was a checkbox on a form labelled "no approval required", and it
// meant that literally: a standing order created an execution and approved it
// in the same breath, under the approver id `system:playbook`, reaching
// neither the trust ladder, nor the platform cap, nor the consent ledger whose
// own doc comment reads "the gate: no autonomous 'act' without this."
//
// The shape of that defect is not specific to playbooks. It is: A NEW CALLER
// OF THE APPROVAL DOOR THAT DOES NOT ASK. This gate names the small set of
// questions that count as asking, and fails when a caller asks none of them.
//
// It also watches the back door: approval is a status transition on
// `action_executions`, and a file that writes that status itself has stepped
// around every check the executor makes, not just this one.
//
// What it deliberately does not do: decide whether the RIGHT question was
// asked. `activeConsent` for a capability nobody granted and
// `requireCompanyCapability` for a permission nobody holds are different
// questions, and only the tests can tell whether the answer is bound to the
// consequence. This gate proves a question is asked at all — which is the part
// that was silently missing.
//
// Run: node scripts/check-autonomous-approval.mjs   (CI, beside lint:columns)
// =============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const EXECUTOR = 'src/services/scp/actions/executor.ts';

/** The questions that count as asking. Each is a real predicate with a real
 *  refusal behind it, not a classification or a comment. */
const AUTHORITY = [
  /\bautoExecuteVerdict\s*\(/,        // the standing-order gate: ladder + cap + consent
  /\bactiveConsent\s*\(/,             // the consent ledger, read directly
  /\bhasActConsent\s*\(/,
  /\brequireCompanyCapability\s*\(/,  // a human principal with a named capability
  // The same question without the middleware wrapper, for a door that must
  // ask it partway through rather than before the handler runs: the voice
  // path routes notes, questions and decisions too, and a member who may not
  // execute effects may still do all three.
  /\bmemberMay\s*\(/,
  /\bactiveResponsibilityAuthority\s*\(/,
];

function tsFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Comments describe defects; they are not defects. Blanked rather than
 *  removed so reported line numbers still point at the real line. */
function strip(src) {
  return stripComments(src, { lineComments: false })
    .split('\n').map((l) => l.replace(/^(\s*)\/\/.*$/, '$1')).join('\n');
}

const unasked = [];
const backDoor = [];

for (const file of tsFiles(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file);
  const src = strip(readFileSync(file, 'utf8'));

  // A type-only import is not a call. Drop those lines before looking.
  const code = src.split('\n')
    .filter((l) => !/^\s*import\s+type\b/.test(l))
    .join('\n');

  if (rel !== EXECUTOR && /\bapproveAndExecute\s*\(/.test(code)) {
    if (!AUTHORITY.some((re) => re.test(code))) {
      const line = code.split('\n').findIndex((l) => /\bapproveAndExecute\s*\(/.test(l)) + 1;
      unasked.push(`${rel}:${line}`);
    }
  }

  if (rel !== EXECUTOR) {
    for (const m of code.matchAll(
      /UPDATE\s+action_executions\s+SET\s+status\s*=\s*'(approved|executing|completed)'/gi)) {
      backDoor.push(`${rel}:${code.slice(0, m.index).split('\n').length} → sets status='${m[1]}' directly`);
    }
  }
}

let failed = false;

if (unasked.length) {
  failed = true;
  console.error('An action is approved and executed without asking who authorized it.\n');
  for (const u of unasked) console.error('  ' + u);
  console.error('\nApproving an action on the founder\'s behalf is an autonomous act. Ask one of:');
  console.error('  autoExecuteVerdict()  — the ladder, the platform cap and the consent ledger');
  console.error('  activeConsent() / hasActConsent()  — the consent ledger directly');
  console.error('  requireCompanyCapability()  — a human principal holding a named capability');
}

if (backDoor.length) {
  failed = true;
  console.error('\nAn execution status is advanced outside the executor, skipping every check it makes:\n');
  for (const b of backDoor) console.error('  ' + b);
}

if (failed) process.exit(1);
console.log('✓ every caller of the approval door asks who authorized it');
