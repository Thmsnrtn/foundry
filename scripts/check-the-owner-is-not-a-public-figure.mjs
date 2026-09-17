#!/usr/bin/env node
// =============================================================================
// FOUNDRY — the owner is not a public figure
//
// He said it plainly: he is not hiding, but the assets and products speak for
// themselves and the Workshop is the public voice. His name belongs on exactly
// one public surface — the terms page, where the law wants to know who is
// behind a trading name — and on the listing's privacy policy, which is the
// same disclosure in a marketplace's clothes. Nowhere else: not the sender
// line, not a footer, not a tagline, not a listing, not a community post.
//
// A rule like that decays one template at a time, and a reviewer cannot see a
// name in a string. So this reads the public renderers, the outbound
// templates and the embedded listing copy, and fails on any of:
//
//   1. `operatorName` interpolated into a string anywhere under the public
//      Workshop, the venture hands or the outbound door — except the record
//      that holds it (settings.ts), the projection that hands it to the terms
//      page as `legalOperator`, and the sealed design text of Experiment 001,
//      which is history and is not rewritten.
//   2. `legalOperator` used outside `renderTerms` in the public site.
//   3. The owner's literal name (read from the Workshop record, never typed
//      here) in the public site or the listing copy, outside the privacy
//      policy constant.
//
// Run: node scripts/check-the-owner-is-not-a-public-figure.mjs   (in lint:columns)
// =============================================================================
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const rel = (p) => relative(ROOT, p);

function tsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const failures = [];

// 1. No `operatorName` reaching a string on a public path.
const PUBLIC_DIRS = ['src/services/public-workshop', 'src/services/venture', 'src/services/outbound'];
const HOLDS_THE_RECORD = new Set([
  'src/services/public-workshop/settings.ts',
  'src/services/public-workshop/projection.ts',
  // Experiment 001's sealed design text names him; it is a record, not a surface.
  'src/services/venture/proof-1.ts',
]);
for (const dir of PUBLIC_DIRS) {
  for (const f of tsFiles(resolve(ROOT, dir))) {
    const r = rel(f);
    if (HOLDS_THE_RECORD.has(r)) continue;
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\$\{[^}]*operatorName[^}]*\}/.test(line) || /operator_name/.test(line)) {
        failures.push(`${r}:${i + 1}: the owner's name reaches a string on a public path`);
      }
    });
  }
}

// 2. `legalOperator` only inside renderTerms.
const SITE = resolve(ROOT, 'src/services/public-workshop/site.ts');
if (existsSync(SITE)) {
  const src = readFileSync(SITE, 'utf8');
  const start = src.indexOf('export function renderTerms');
  const end = start < 0 ? -1 : src.indexOf('\nexport function', start + 1);
  src.split('\n').forEach((line, i) => {
    if (!/legalOperator/.test(line)) return;
    const at = src.split('\n').slice(0, i).join('\n').length;
    if (start < 0 || at < start || (end >= 0 && at > end)) {
      failures.push(`${rel(SITE)}:${i + 1}: legalOperator rendered outside renderTerms`);
    }
  });
}

// 3. The literal name, read from the record, on no public surface but the two disclosures.
const SETTINGS = resolve(ROOT, 'src/services/public-workshop/settings.ts');
const name = existsSync(SETTINGS)
  ? (/operatorName:\s*'([^']+)'/.exec(readFileSync(SETTINGS, 'utf8')) ?? [])[1] ?? null
  : null;
if (name) {
  const surfaces = [
    'src/services/public-workshop/site.ts',
    'src/services/public-workshop/correspondence.ts',
    'src/services/venture/hand.ts',
    ...tsFiles(resolve(ROOT, 'src/services/venture/products')).map(rel),
    ...tsFiles(resolve(ROOT, 'src/services/venture/channels')).map(rel),
  ];
  for (const s of surfaces) {
    const p = resolve(ROOT, s);
    if (!existsSync(p)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (line.includes(name) && !/^\s*(\/\/|\*)/.test(line)) failures.push(`${s}:${i + 1}: the owner's name, typed on a public surface`);
    });
  }
  const LISTING = resolve(ROOT, 'src/services/venture/proof-2-content.ts');
  if (existsSync(LISTING)) {
    const src = readFileSync(LISTING, 'utf8');
    // Every exported constant but the privacy policy is copy the public reads.
    const consts = [...src.matchAll(/export const (\w+) = (`[\s\S]*?`|'[^']*'|"[^"]*"|[^;]*);/g)];
    for (const m of consts) {
      if (m[1] === 'PRIVACY_POLICY_MD' || m[1] === 'OWNER_ACTS_MD') continue;
      if (m[2].includes(name)) failures.push(`${rel(LISTING)}: ${m[1]} carries the owner's name into a listing`);
    }
  }
}

if (failures.length) {
  console.error('the owner is not a public figure — his name reaches a public surface:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('the owner is not a public figure: the Workshop is the only public voice');
