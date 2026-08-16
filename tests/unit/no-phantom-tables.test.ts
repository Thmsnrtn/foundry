// =============================================================================
// Tests: no phantom table references (code-vs-schema guard)
//
// Repeatedly this session, handlers queried tables that no migration created —
// they pass typecheck and unit tests and only throw "no such table" on a real
// DB (agent_decisions 500'd the whole inbox; scp_instances broke the cancel
// path). This test scans every SQL string in src for FROM/INTO/UPDATE/JOIN
// <table> and asserts the table exists in the committed schema snapshot, so a
// new phantom reference (or a typo'd/renamed table) fails CI instead of prod.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '../..');

// Tables created at runtime by application code (CREATE TABLE IF NOT EXISTS at
// service boot), or referenced only inside a try/catch that intentionally
// tolerates their absence. Each is a deliberate exception, not a bug.
const ALLOWLIST = new Set([
  'audio_brief_scripts', // created in src/services/scp/briefing/audio.ts
  'email_digests',       // created in src/services/scp/briefing/email-digest.ts
  'company_memory',      // voice-reply.ts: try/catch with fallback to decisions
  'daily_briefings',     // debate/orchestrator.ts: guarded synthesis-append (unbuilt)
]);

function schemaTables(): Set<string> {
  const snap = readFileSync(resolve(ROOT, 'docs/db/schema.snapshot.sql'), 'utf8');
  // SQLite's own catalog tables. They always exist, they are not Foundry
  // tables, and no migration creates them — so the snapshot cannot describe
  // them and their absence from it is not drift.
  const tables = new Set<string>(['sqlite_sequence', 'sqlite_master']);
  const re = /CREATE\s+(?:TABLE|VIEW)\s+(?:IF NOT EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snap)) !== null) tables.add(m[1].toLowerCase());
  return tables;
}

function tsFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(tsFiles(p));
    else if (e.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('no phantom table references', () => {
  it('every FROM/INTO/UPDATE/JOIN <snake_case_table> in src exists in the schema', () => {
    const tables = schemaTables();
    // snake_case only (real table names) to avoid matching aliases/prose.
    const ref = /\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z][a-z0-9]*_[a-z0-9_]*)/gi;
    const offenders: string[] = [];

    for (const file of tsFiles(resolve(ROOT, 'src'))) {
      const rel = file.slice(ROOT.length + 1);
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) return; // skip comments
        if (!/['"`]/.test(line)) return;                      // must be in a string
        let m: RegExpExecArray | null;
        ref.lastIndex = 0;
        while ((m = ref.exec(line)) !== null) {
          const name = m[1].toLowerCase();
          if (tables.has(name) || ALLOWLIST.has(name) || name.includes('${')) continue;
          offenders.push(`${rel}:${i + 1} → ${name}`);
        }
      });
    }

    expect(
      offenders,
      `Referenced tables not in docs/db/schema.snapshot.sql (add a migration, fix the name, ` +
        `or allowlist if runtime-created/guarded):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
