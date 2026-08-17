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

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const offenders = [];
let total = 0;
let institutional = 0;

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
console.log(
  `✓ every model call declares its subject (${total} direct call sites, `
  + `${institutional} declared institutional)`);
