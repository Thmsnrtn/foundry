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
//      which is history and is not rewritten (its PAGE is clause 6's).
//   2. `legalOperator` used outside `renderTerms` in the public site.
//   3. The owner's literal name (read from the Workshop record, never typed
//      here) in the public site or the listing copy, outside the privacy
//      policy constant.
//   4. The postal address reaching a public surface WITHOUT his name taken off
//      it. This one is here because the rule had a hole exactly the shape of a
//      value a person types: he wrote his own name as the first line of the
//      address, which is the ordinary way to write one, and it then went out
//      on the footer of every public page and every commercial email. Source
//      text is not where that lived, so the three clauses above could not see
//      it. The projection must build the public address through
//      `publicPostalLines`, and the hand's email footer must not reach for the
//      raw lines.
//   5. His literal name in any file on a public path outside the sealed
//      records, which are listed by name and reported.
//   6. THE PAGE A SEALED RECORD BECOMES (PENDING 19, decided 8 October 2026).
//      A sealed record may keep his name; the page the public reads from it
//      may not. Experiment 001's page was EXEMPTED here until that decision;
//      it is now COVERED, two ways: (a) the projection must read every public
//      copy column through `said()` (which is `withoutTheOwner`), so no column
//      can reach a page around it; and (b) every named copy constant handed to
//      `givePublicIdentity` or `updatePublicCopy` is put through the real
//      `withoutTheOwner`, and must come out with no name in it.
//
// Run: node scripts/check-the-owner-is-not-a-public-figure.mjs   (in lint:columns)
// =============================================================================
import { spawnSync } from 'child_process';
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

// 4. The address the public reads has his name taken off it.
//
// `site.ts` is deliberately NOT asked to do this. It reads the projection, and
// the projection is where the name comes off — so the footer and the contact
// page are safe by construction rather than by a rule each of them has to
// remember. What is checked is the two places that can reintroduce it: the
// projection itself, and the hand, which reads the record directly.
const PROJECTION = resolve(ROOT, 'src/services/public-workshop/projection.ts');
if (existsSync(PROJECTION)) {
  const src = readFileSync(PROJECTION, 'utf8');
  if (!/postalAddress:\s*publicPostalLines\(/.test(src)) {
    failures.push(`${rel(PROJECTION)}: the public postalAddress must be built by publicPostalLines(), or the owner's name rides it onto every page`);
  }
}
// And nothing on a public path reaches for the raw lines. Two files may:
// `settings.ts`, which defines both readings, and `site.ts`, which renders the
// projection — by the time the address reaches a template there, the name is
// already off it, so the footer and the contact page are safe by construction
// rather than by a rule each of them has to remember.
const READS_THE_RAW_ADDRESS = new Set([
  'src/services/public-workshop/settings.ts',
  'src/services/public-workshop/site.ts',
]);
for (const dir of PUBLIC_DIRS) {
  for (const f of tsFiles(resolve(ROOT, dir))) {
    const r = rel(f);
    if (READS_THE_RAW_ADDRESS.has(r)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/\bpostalLines\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
        failures.push(`${r}:${i + 1}: a public surface must use publicPostalLines(), not the raw address lines the owner typed`);
      }
    });
  }
}

// 5. THE PUBLIC COPY OF EVERY EXPERIMENT, not only the interpolation sites.
//
// A sealed page can name him legitimately — Experiment 001's does, and the
// rule that a sealed record is not rewritten stands beside the rule that his
// name is on no public surface (OWNER_DECISIONS_PENDING.md, PENDING 19). What
// must not happen is a SECOND such page appearing silently. So every file on
// a public path is read for the literal name outside comments; the sealed
// records are listed by id and REPORTED, and anything else FAILS.
if (name) {
  const SEALED = new Map([
    ['src/services/venture/proof-1.ts', 'Experiment 001\'s sealed record (PROOF1_PUBLIC, "Who I am"); its PAGE is clause 6\'s, and carries no name — PENDING 19, decided 2026-10-08'],
    ['src/services/venture/proof-1-content.ts', 'Experiment 001\'s outreach as sent (OUTREACH_TEMPLATE_MD sign-off) — a record of what went out'],
    ['src/services/venture/proof-2-content.ts', 'the Etsy privacy policy (PRIVACY_POLICY_MD) — the marketplace\'s disclosure'],
    ['src/services/public-workshop/settings.ts', 'the Workshop record that holds the operator\'s name'],
  ]);
  const carried = [];
  for (const dir of PUBLIC_DIRS) {
    for (const f of tsFiles(resolve(ROOT, dir))) {
      const r = rel(f);
      const lines = readFileSync(f, 'utf8').split('\n');
      const hits = lines.map((line, i) => (line.includes(name) && !/^\s*(\/\/|\*)/.test(line) ? i + 1 : 0)).filter(Boolean);
      if (!hits.length) continue;
      if (SEALED.has(r)) carried.push(`${r}:${hits.join(',')} — ${SEALED.get(r)}`);
      else failures.push(`${r}:${hits[0]}: the owner's name in public copy outside the sealed records; a second sealed page cannot appear silently`);
    }
  }
  for (const c of carried) console.log(`  carried by a sealed record: ${c}`);
}

// 6a. Every public copy column the projection reads is said through `said()`.
//
// The projection is the one boundary between a sealed row and a page. A
// column read raw — `String(r.public_note)` — would carry the sealed text,
// name and all, straight onto the page; so every read of a copy column must be
// `said(r.public_x)`, `blank(r.public_x)`, or a null test. Comment lines are
// not read (the rule's own explanation names the shape it forbids).
if (existsSync(PROJECTION)) {
  const src = readFileSync(PROJECTION, 'utf8').split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line)).join('\n');
  if (!/const said = \(v: unknown\): string => withoutTheOwner\(/.test(src)) {
    failures.push(`${rel(PROJECTION)}: \`said\` must be withoutTheOwner — the one place the owner's name comes off the page`);
  }
  let reads = 0;
  for (const m of src.matchAll(/r\.public_([a-z_]+)/g)) {
    if (m[1].endsWith('_at')) continue;
    reads++;
    const before = src.slice(Math.max(0, m.index - 6), m.index);
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 10);
    if (/said\($|blank\($/.test(before) || /^\s*[!=]=\s*null/.test(after)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    failures.push(`${rel(PROJECTION)}:${line}: r.public_${m[1]} reaches the page without said(); the owner's name would ride a sealed record onto it`);
  }
  // Vacuity: a projection that stopped naming the columns this way reads as clean.
  if (reads < 10) failures.push(`${rel(PROJECTION)}: only ${String(reads)} public copy columns found; the rule is reading the wrong file or the wrong shape`);
}

// 6b. Every named copy constant, through the real projection function.
if (name) {
  const publicName = (/publicName:\s*'([^']+)'/.exec(readFileSync(SETTINGS, 'utf8')) ?? [])[1] ?? null;
  const all = tsFiles(resolve(ROOT, 'src'));
  const copies = new Map();
  for (const f of all) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/givePublicIdentity\(\{[\s\S]*?\bcopy:\s*([A-Z][A-Z0-9_]*)\b/g)) copies.set(m[1], null);
    for (const m of src.matchAll(/updatePublicCopy\(\s*[\w.]+\s*,\s*([A-Z][A-Z0-9_]*)\s*\)/g)) copies.set(m[1], null);
  }
  for (const c of copies.keys()) {
    const home = all.find((f) => new RegExp(`^export const ${c}\\b`, 'm').test(readFileSync(f, 'utf8')));
    if (!home) failures.push(`${c}: a public copy constant whose export could not be found, so it was not read`);
    else copies.set(c, home);
  }
  if (!copies.has('PROOF1_PUBLIC')) failures.push('PROOF1_PUBLIC is not among the public copies found; the population is wrong');
  const probe = `
    const { withoutTheOwner } = await import(${JSON.stringify(resolve(ROOT, 'src/services/public-workshop/projection.ts'))});
    const w = ${JSON.stringify({ operatorName: name, publicName })};
    const out = [];
    for (const [c, file] of ${JSON.stringify([...copies].filter(([, f]) => f))}) {
      const obj = (await import(file))[c];
      const fields = Object.entries(obj ?? {}).filter(([, v]) => typeof v === 'string');
      if (!fields.length) { out.push(c + ': no text fields were read'); continue; }
      for (const [k, v] of fields) if (withoutTheOwner(v, w).toLowerCase().includes(w.operatorName.toLowerCase())) out.push(c + '.' + k + ': still names the owner on the page');
    }
    console.log(JSON.stringify(out));`;
  const env = { ...process.env, TURSO_DATABASE_URL: 'file::memory:' };
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', probe], { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  const last = (r.stdout ?? '').trim().split('\n').pop() ?? '';
  let found = null;
  try { found = JSON.parse(last); } catch { found = null; }
  if (r.status !== 0 || !Array.isArray(found)) {
    failures.push(`the page probe could not run, so no page was read (exit ${String(r.status)}): ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`);
  } else {
    for (const f of found) failures.push(`the page a sealed record becomes: ${f}`);
    console.log(`  pages read through the projection: ${[...copies.keys()].join(', ')}`);
  }
}

if (failures.length) {
  console.error('the owner is not a public figure — his name reaches a public surface:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('the owner is not a public figure: the Workshop is the only public voice');
