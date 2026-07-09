#!/usr/bin/env node
// =============================================================================
// FOUNDRY — Architectural ratchet factory (Ascent A2, ported from AcreOS)
//
// A ratchet freezes the CURRENT count of an undesirable pattern as a baseline
// and enforces it BIDIRECTIONALLY, so a gate can land on a dirty tree today and
// still block all regression:
//   • count  >  baseline → FAIL  (new offender — fix it, don't bump the number)
//   • count  <  baseline → FAIL  ("good news, N removed — lock it in: lower the
//                                  baseline in this commit")
//   • count === baseline → PASS
// This makes cleanup self-locking: the number can only walk toward the goal.
//
// Configs live in scripts/ratchets/*.json:
//   { name, description, pattern, roots[], includePath?, excludePath?,
//     baseline, direction: "down" | "up" }
// "up" ratchets (adoption metrics) invert the comparison.
//
// Run: node scripts/ratchet.mjs   (add to the `check` chain)
// =============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const CONFIG_DIR = 'scripts/ratchets';

function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}

function countMatches(cfg) {
  const inc = cfg.includePath ? new RegExp(cfg.includePath) : null;
  const exc = cfg.excludePath ? new RegExp(cfg.excludePath) : null;
  const re = new RegExp(cfg.pattern, 'g');
  let count = 0;
  const hits = [];
  for (const root of cfg.roots) {
    for (const file of walk(root)) {
      if (inc && !inc.test(file)) continue;
      if (exc && exc.test(file)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) return; // skip comment lines
        re.lastIndex = 0;
        const m = line.match(re);
        if (m) { count += m.length; hits.push(`${file}:${i + 1}`); }
      });
    }
  }
  return { count, hits };
}

const configs = readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.json')).sort();
let failed = 0;

for (const f of configs) {
  const cfg = JSON.parse(readFileSync(join(CONFIG_DIR, f), 'utf8'));
  const { count, hits } = countMatches(cfg);
  const dir = cfg.direction ?? 'down';
  const base = cfg.baseline;
  let status = 'PASS';
  if (dir === 'down') {
    if (count > base) status = 'REGRESSION';
    else if (count < base) status = 'LOCK-IN';
  } else { // up (adoption)
    if (count < base) status = 'REGRESSION';
    else if (count > base) status = 'LOCK-IN';
  }

  if (status === 'PASS') {
    console.log(`✓ ${cfg.name}: ${count} (baseline ${base})`);
    continue;
  }
  failed++;
  if (status === 'REGRESSION') {
    console.error(`\n✗ ${cfg.name}: ${count} (baseline ${base}) — ${cfg.description}`);
    console.error(dir === 'down'
      ? `  New offender(s). Fix them; do NOT raise the baseline. Offending sites:`
      : `  Adoption dropped below baseline. Re-adopt; do NOT lower the baseline. Sites:`);
    for (const h of hits.slice(0, 20)) console.error(`    ${h}`);
    if (hits.length > 20) console.error(`    …and ${hits.length - 20} more`);
  } else { // LOCK-IN
    console.error(`\n✗ ${cfg.name}: ${count} (baseline ${base}) — improvement not locked in`);
    console.error(`  ${dir === 'down' ? 'Fewer' : 'More'} than baseline — good! Set "baseline": ${count} in ${CONFIG_DIR}/${f} in this commit.`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} ratchet(s) failed.\n`);
  process.exit(1);
}
console.log(`\nAll ${configs.length} ratchets hold.`);
