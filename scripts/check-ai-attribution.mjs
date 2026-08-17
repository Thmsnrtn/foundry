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

// A call that genuinely has no company to charge, with the reason. An entry
// here is an argument, not a suppression: each one must be a call ABOUT more
// than one company, where naming a single product would be a lie about who
// incurred the cost.
const UNATTRIBUTABLE = {
  'src/services/wisdom/network.ts': 'aggregates opted-in patterns ACROSS products; there is no single company to charge',
};

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const offenders = [];
let total = 0;
const exemptSeen = new Set();

for (const file of walk(join(ROOT, 'src'))) {
  if (file.endsWith('/ai/client.ts')) continue;          // where the helpers live
  const rel = relative(ROOT, file);
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && HELPERS.has(node.expression.text)) {
      total++;
      if (node.arguments.length <= PRODUCT_ARG_INDEX) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        if (rel in UNATTRIBUTABLE) exemptSeen.add(rel);
        else offenders.push(`${rel}:${line + 1} → ${node.expression.text} with no productId`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (offenders.length) {
  console.error(
    'Model calls charged to nobody:\n' + offenders.sort().join('\n')
    + '\n\nPass the productId as the fourth argument. Only the GLOBAL ceiling '
    + 'applies to a call without one, so one company can exhaust the budget for '
    + 'all of them. If the call genuinely spans companies, record it in '
    + 'UNATTRIBUTABLE with the reason.');
  process.exit(1);
}

const stale = Object.keys(UNATTRIBUTABLE).filter((f) => !exemptSeen.has(f));
if (stale.length) {
  console.error(
    'These are recorded as unattributable but no longer have an unattributed '
    + 'call. Remove them, so the list keeps meaning what it says:\n' + stale.join('\n'));
  process.exit(1);
}

console.log(`✓ every model call is charged to a company (${total} call sites, ${exemptSeen.size} recorded exception)`);
