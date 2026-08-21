#!/usr/bin/env node
// =============================================================================
// A ROUTE THAT TAKES A COMPANY'S ID MUST SAY WHOSE COMPANY IT IS.
//
// `middleware/tenant.ts` states the rule once — validate ownership, return 404
// rather than 403 so nothing leaks — and is mounted nowhere. Every route that
// needs it re-implements it inline, and SIX idioms are in use:
//
//   getProductByOwner(id, founder.id)     hasProductAccess(id, founder.id)
//   requireOwner()                        verifyPortfolioOwnership(id, email)
//   requireCompanyCapability(...)         a WHERE on products.owner_id
//                                         or on ctx.product.id
//
// A rule with six implementations has no floor: the seventh route has nothing.
// `GET /packet/:id` was that route — it loaded any company's board packet by id
// with the founder in hand and unused.
//
// This is the floor. Every handler whose path takes `:id` or `:productId` must
// show one of the recognised idioms, or be listed in the baseline with a reason
// written beside it in the route itself.
//
// FALSE POSITIVES ARE EXPECTED AND ARE THE SAFE DIRECTION. Many `:id` params
// are not company ids at all — a notification, a thread, a message. Those are
// baselined, not excused by pattern: a human decided each one, and the baseline
// can only shrink.
// =============================================================================
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/strip-comments.mjs';

const BASELINE = 'docs/db/tenant-scope-baseline.txt';

const IDIOMS = [
  'getProductByOwner', 'hasProductAccess', 'requireOwner', 'requireCompanyCapability',
  'verifyPortfolioOwnership', 'authenticatePortfolioKey', 'tenantMiddleware',
  'owner_id = ?', 'owner_id=?', 'p.owner_id', 'products.owner_id',
  'ctx.product.id', 'ctx.productId', 'founder.id', 'founderId',
];

function sources(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const ROUTE = /(\w+)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*:(?:id|productId)[^'"`]*)['"`]/g;

const found = [];
for (const file of sources('src/routes')) {
  const src = stripComments(readFileSync(file, 'utf8'), { lineComments: true });
  ROUTE.lastIndex = 0;
  const marks = [...src.matchAll(ROUTE)];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const body = src.slice(m.index + m[0].length,
      i + 1 < marks.length ? marks[i + 1].index : src.length).slice(0, 8000);
    if (IDIOMS.some((idiom) => body.includes(idiom))) continue;
    found.push(`${m[2].toUpperCase()} ${m[3]}`);
  }
}
found.sort();

const write = process.argv.includes('--write');
if (write) {
  writeFileSync(BASELINE, found.length ? `${found.join('\n')}\n` : '');
  console.log(`tenant-scope baseline written: ${found.length}`);
  process.exit(0);
}

let baseline = [];
try { baseline = readFileSync(BASELINE, 'utf8').split('\n').filter(Boolean); } catch { /* first run */ }

const added = found.filter((f) => !baseline.includes(f));
const gone = baseline.filter((f) => !found.includes(f));

if (added.length) {
  console.error('Product-scoped routes that never say whose company it is:\n');
  for (const a of added) console.error(`  ${a}`);
  console.error(`
Scope the handler to the founder — the idioms this recognises are listed in
this script's header — or, if the parameter is not a company id at all, add the
line to the baseline with --write and say so in a comment on the route.

A 404 rather than a 403 for someone else's company: that decision is already
made and written down in src/middleware/tenant.ts.`);
  process.exit(1);
}

if (gone.length) {
  console.log(`✓ ${gone.length} route(s) now scope themselves. Remove them from`);
  console.log('  the baseline with --write so they cannot come back:\n');
  for (const g of gone) console.log(`  ${g}`);
  process.exit(1);
}

console.log(`✓ tenant scope: ${found.length} unscoped product-shaped routes (baseline ${baseline.length})`);
