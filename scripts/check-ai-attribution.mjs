#!/usr/bin/env node
// =============================================================================
// FOUNDRY — every model call is charged to a company
//
// `callClaude` reserves spend against three ceilings before it dispatches:
// global, per-product and per-founder. The per-product one only applies when
// the caller passed a productId — and productId is the FOURTH, OPTIONAL
// argument of `callOpus`/`callSonnet`/`callHaiku`, after two prompts and a
// token budget. Omitting it is invisible at the call site and silently drops
// the call out of per-product accounting.
//
// Fifty-five of a hundred and four call sites omitted it. Half of Foundry's
// model spend was bounded only by the GLOBAL ceiling, which means one company's
// runaway loop could exhaust the budget for every other company, and no
// per-product limit could ever have caught it. The entitlement work makes this
// worse rather than better: a rule that reaches spend through productId cannot
// reach spend that has no productId.
//
// The check is exact rather than textual — it uses the TypeScript parser, so a
// call split across lines or nested in a ternary is read the same as any other.
//
// AND WHO PAYS IS NOT WHAT FOR. Once every call named a company, the ledger
// could say that $14.88 had gone through 1,099 calls and that $10.45 of it was
// Sonnet, on 878 calls that named no purpose. "What is Foundry thinking about,
// and is it worth it" is the question the cognition-economics discipline exists
// to answer, and the ledger could answer it for fourteen per cent of the calls.
//
// So the subject also carries `work`, from the closed vocabulary in
// `src/services/ai/what-it-is-for.ts`. The type system enforces its presence;
// this gate enforces that the name is one the vocabulary actually defines, so a
// typo becomes a failed build rather than a category of one in the ledger.
//
// Run: node scripts/check-ai-attribution.mjs   (CI, beside lint:columns)
// =============================================================================
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const HELPERS = new Set(['callOpus', 'callSonnet', 'callHaiku']);
const PRODUCT_ARG_INDEX = 3;

// `callClaude` takes its subject as a named property rather than positionally.
// It was invisible to this gate until the type system made the subject
// required: one caller reached a model with no company to charge, and the gate
// that claimed to cover model spend had never looked at it.
const CONFIG_CALLERS = new Set(['callClaude']);

// There is no exemption list any more, and that is the point. A call with no
// company to charge now says so in the source — `institutionSpend('<reason>')`
// in the subject position — so the declaration lives next to the call instead
// of in a file somebody has to remember to keep true. What this gate checks is
// that the declaration exists and carries a reason worth reading.
const MIN_REASON = 20;

/** The vocabulary, read from the file that defines it rather than restated. */
const VOCABULARY = (() => {
  const src = readFileSync(join(ROOT, 'src/services/ai/what-it-is-for.ts'), 'utf8');
  const body = src.slice(src.indexOf('WORK_THE_MODEL_DOES = {'), src.indexOf('} as const;'));
  return new Set([...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
})();

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const offenders = [];
let total = 0;
let institutional = 0;
const used = new Set();

for (const file of walk(join(ROOT, 'src'))) {
  if (file.endsWith('/ai/client.ts')) continue;          // where the helpers live
  const rel = relative(ROOT, file);
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && CONFIG_CALLERS.has(node.expression.text)) {
      total++;
      const arg = node.arguments[0];
      const named = arg && ts.isObjectLiteralExpression(arg)
        && arg.properties.some((prop) => prop.name?.getText(sf) === 'subject');
      if (!named) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        offenders.push(`${rel}:${line + 1} → callClaude with no subject`);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && HELPERS.has(node.expression.text)) {
      total++;
      if (node.arguments.length <= PRODUCT_ARG_INDEX) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        offenders.push(`${rel}:${line + 1} → ${node.expression.text} with no spend subject`);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === 'institutionSpend') {
      institutional++;
      const arg = node.arguments[0];
      const literal = arg && ts.isStringLiteral(arg) ? arg.text : '';
      if (literal.length < MIN_REASON) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        offenders.push(
          `${rel}:${line + 1} → institutionSpend needs a written reason, not a label`);
      }
    }
    // WHAT THE MONEY WAS FOR, from the vocabulary rather than invented here.
    // The type system already refuses an unknown name; this catches the case
    // it cannot see — a name spelled correctly in the union and never used, or
    // a call built somewhere the compiler widens to `string`.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && (node.expression.text === 'companySpend'
          || node.expression.text === 'institutionSpend')) {
      const work = node.arguments[1];
      const name = work && ts.isStringLiteral(work) ? work.text : null;
      if (name !== null) {
        used.add(name);
        if (!VOCABULARY.has(name)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          offenders.push(`${rel}:${line + 1} → "${name}" is not work this institution declares`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (offenders.length) {
  console.error(
    'Model calls with no declared subject:\n' + offenders.sort().join('\n')
    + '\n\nPass the company id as the fourth argument. Only the GLOBAL ceiling '
    + 'applies to a call without one, so one company can exhaust the budget for '
    + 'all of them. If the call genuinely belongs to no company, say so: '
    + "institutionSpend('why this has no company to charge').");
  process.exit(1);
}

// Indirect callers are the gate's remaining blind spot, and the type system is
// what closes it: `const fn = x ? callOpus : callSonnet; await fn(a, b, c)` is
// invisible to any AST match on the callee's name. Five such calls existed and
// were found only when `SpendSubject` became a required parameter. This gate is
// defence in depth; the required argument is the enforcement.
// A NAME NOTHING CLAIMS IS A CATEGORY THAT WILL NEVER APPEAR IN THE LEDGER,
// which is how a vocabulary rots into a list of things somebody once meant to
// do. Retiring work means deleting its entry, and this says which are unclaimed
// rather than failing: a name may legitimately outlive its only call site for
// one commit, and the list makes that visible instead of silent.
const unclaimed = [...VOCABULARY].filter((w) => !used.has(w));

console.log(
  `✓ every model call declares its subject and what it is for `
  + `(${total} direct call sites, ${institutional} declared institutional, `
  + `${VOCABULARY.size} kinds of work, ${used.size} claimed)`);
if (unclaimed.length) {
  console.log(`  no call site claims: ${unclaimed.join(', ')}`);
}
