#!/usr/bin/env node
// =============================================================================
// FOUNDRY — Kernel boundary check (Trust Plane phase 4 / platformization seed)
//
// The autonomy kernel is the domain-agnostic decision loop — the part that
// could power ANY vertical (AcreOS's DomainPack seam proved the pattern; its
// docs call a deliberately-foreign second pack the platformization milestone,
// and Foundry-the-SaaS-pack is that second pack in waiting).
//
// Invariant: KERNEL modules may not import from PACK dirs (SaaS-specific
// intelligence). One-directional: packs may use the kernel; never the reverse.
// Baseline 0 — this gate can never accumulate offenders.
// =============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const KERNEL_DIRS = [
  'src/services/memory', 'src/services/redteam', 'src/services/ghost',
  'src/services/trust', 'src/services/letter', 'src/services/autopilot',
  'src/services/truth', 'src/services/wellbeing', 'src/services/chat',
  'src/db/schema',
];
// SaaS-pack dirs: vertical-specific agents, code audit, metric adapters.
const PACK_PATTERN = /from\s+['"][^'"]*\/(scp|audit|integrations)\//;

function walk(d) {
  let out = [];
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (e.endsWith('.ts')) out.push(p);
  }
  return out;
}

const offenders = [];
for (const dir of KERNEL_DIRS) {
  let files = [];
  try { files = walk(dir); } catch { continue; }
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (PACK_PATTERN.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
}
if (offenders.length > 0) {
  console.error('✗ Kernel imports pack code (the kernel must stay domain-agnostic):');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log(`✓ kernel boundary holds (${KERNEL_DIRS.length} kernel dirs, 0 pack imports)`);
