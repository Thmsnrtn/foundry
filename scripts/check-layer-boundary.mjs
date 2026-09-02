#!/usr/bin/env node
// =============================================================================
// FOUNDRY — three things that share one repository, kept apart
//
// `src/lib/repository-layers.ts` says what each part of this repository IS:
// the substrate, the shared institutional kernel, the private owner product,
// the dormant commercial surface, or the wiring that assembles a deployment.
//
// This enforces the direction of dependency, and one rule carries the weight:
//
//   NOTHING MAY DEPEND ON `private`.
//
// The shared kernel cannot import the owner's experience, and neither can the
// commercial surface. So whatever a future Commercial Foundry consumes, it
// structurally cannot be "whatever Private Foundry happens to look like" — it
// can only be the kernel, deliberately. That is the owner's requirement, and a
// convention could not have kept it: the next import would have broken it and
// nothing would have said so.
//
// The table is READ from the TypeScript module rather than restated here, so
// there is one definition and the runtime and the gate cannot disagree about
// what this repository contains.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const BASELINE = 'docs/db/layer-boundary-baseline.txt';
const WRITE = process.argv.includes('--write');

const MODULE = 'src/lib/repository-layers.ts';
const source = readFileSync(MODULE, 'utf8');

function tableBetween(startMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${MODULE} no longer declares ${startMarker}`);
  const body = source.slice(start, source.indexOf('};', start));
  return body;
}

/** `'src/services/billing': 'commercial',` → one entry. */
const LAYER_OF = new Map();
for (const [, path, layer] of
  tableBetween('export const LAYER_OF').matchAll(/'([^']+)':\s*'([a-z]+)'/g)) {
  LAYER_OF.set(path, layer);
}

/** `kernel: ['substrate', 'kernel'],` → one row of the permission table. */
const MAY_IMPORT = new Map();
for (const [, layer, allowed] of
  tableBetween('export const MAY_IMPORT').matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
  MAY_IMPORT.set(layer, [...allowed.matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
}

if (LAYER_OF.size < 5 || MAY_IMPORT.size < 5) {
  console.error(`✗ could not read the layer tables from ${MODULE}. `
    + `They are the single definition; if their shape changed, this gate must be `
    + `taught the new shape rather than left reading half of it.`);
  process.exit(1);
}

function layerOf(path) {
  const normalised = path.replace(/\\/g, '/');
  let best = null;
  for (const [prefix, layer] of LAYER_OF) {
    if (!normalised.startsWith(prefix)) continue;
    if (!best || prefix.length > best.prefix.length) best = { prefix, layer };
  }
  return best ? best.layer : null;
}

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk('src');
const unclassified = files.filter((f) => layerOf(f) === null);
const offenders = [];

for (const file of files) {
  const from = layerOf(file);
  if (!from) continue;
  const permitted = MAY_IMPORT.get(from) ?? [];
  const text = readFileSync(file, 'utf8');

  // Static imports and dynamic ones. The dynamic form is how most of this
  // codebase reaches across services, so a gate that read only `import ... from`
  // would be measuring the smaller half of the dependency graph.
  for (const [, spec] of text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
    const target = relative(process.cwd(), resolve(dirname(file), spec))
      .replace(/\.js$/, '.ts');
    const to = layerOf(target);
    if (!to || permitted.includes(to)) continue;
    offenders.push({ file, from, target, to });
  }
}

if (unclassified.length) {
  console.error('\nSource files that belong to no layer:\n');
  for (const f of unclassified.slice(0, 20)) console.error(`  ${f}`);
  console.error(`
Every file has to BE something. An unclassified one defaults into nothing,
which in practice means it drifts into the kernel and quietly becomes part
of what a future Commercial Foundry would inherit.

Add it to LAYER_OF in ${MODULE}.
`);
  process.exit(1);
}

// TWO RULES, AND ONLY ONE OF THEM IS NEGOTIABLE.
//
// A dependency ON `private` is refused outright and can never be baselined. It
// is the single thing the owner asked for: if nothing may depend on his
// experience, then whatever a future Commercial Foundry consumes cannot be
// "whatever Private Foundry happens to look like". A baseline here would be a
// list of ways that guarantee is already broken, which is not a guarantee.
//
// Everything else — the shared institution still importing commercial billing
// in four places, a service reaching back into the job registry — is real,
// inherited, and worth measuring rather than pretending away. It is a ratchet:
// the count may only shrink, so the entanglement is visible, named, and cannot
// grow while nobody is looking.
const onPrivate = offenders.filter((o) => o.to === 'private');
const others = offenders.filter((o) => o.to !== 'private');

if (onPrivate.length) {
  console.error('\nSomething depends on the owner\'s own experience:\n');
  for (const o of onPrivate) {
    console.error(`  ${o.from.padEnd(11)} ${o.file}`);
    console.error(`  ${'→ private'.padEnd(11)} ${o.target}\n`);
  }
  console.error(`This one is never baselined.

Private Foundry's owner experience is his. The moment something else is built
on it, it has become part of the specification for whatever that something else
turns into — which is exactly how a private product silently becomes a
commercial one nobody decided to build.

Either move what is shared into the kernel, or the thing depending on it is
part of the private product too. ${MODULE} is where you say which.
`);
  process.exit(1);
}

const found = others.map((o) => `${o.file} -> ${o.target}`).sort();
const baseline = existsSync(BASELINE)
  ? readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  : [];

if (WRITE) {
  writeFileSync(BASELINE, found.join('\n') + '\n');
  console.log(`wrote ${found.length} inherited crossings`);
  process.exit(0);
}

const known = new Set(baseline);
const isNew = found.filter((f) => !known.has(f));
if (isNew.length) {
  console.error('\nNew dependencies that cross a layer boundary the wrong way:\n');
  for (const o of isNew) console.error(`  ${o}`);
  console.error(`
A dependency from \`kernel\` onto \`commercial\` means the shared institution has
started assuming there is something to sell. That assumption is what
\`instance-posture\` exists to undo at runtime, and adding more of it makes the
undoing weaker.

Either the dependency is wrong, or the classification is — and deciding which
is the point. ${MODULE} is where you say so.
`);
  process.exit(1);
}

const counts = {};
for (const f of files) counts[layerOf(f)] = (counts[layerOf(f)] ?? 0) + 1;
console.log(`✓ layer boundary holds — ${files.length} files: `
  + Object.entries(counts).sort().map(([l, n]) => `${n} ${l}`).join(', ')
  + `; 0 depend on private, ${found.length} inherited crossings `
  + `(baseline ${baseline.length})`);
