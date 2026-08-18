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
  // SQLite's own catalog tables, and its table-valued functions. They always
  // exist, they are not Foundry tables, and no migration creates them — so the
  // snapshot cannot describe them and their absence from it is not drift.
  //
  // `json_each` is deliberately here rather than in ALLOWLIST below: that list
  // means "a Foundry table created somewhere other than a migration", and
  // filing a built-in under it would quietly widen what the exception means.
  const tables = new Set<string>([
    'sqlite_sequence', 'sqlite_master', 'json_each', 'json_tree',
    // Also a table-valued function, not a Foundry table: the erasure path uses
    // it to derive which tables carry a product_id, rather than trusting a list
    // written by hand against a schema that has grown by two hundred tables.
    'pragma_table_info',
    // Same reason: the erasure path reads the declared foreign keys to find the
    // tables that carry company data without carrying a `product_id` — the
    // chat messages hanging off a chat session, the OKR results hanging off an
    // OKR. A hand-written list of those would be the thing that goes stale.
    'pragma_foreign_key_list']);
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
      // WHOLE FILE, not line by line.
      //
      // This scan used to run per line and required a quote character on the
      // same line, so it saw nothing inside a multi-line SQL template — which
      // is how most non-trivial queries in this codebase are written. A public
      // API route querying `customer_timeline_events`, a table that exists in
      // no migration and no snapshot, sat behind that blind spot: `FROM` ended
      // one line and the table name began the next.
      //
      // Comments are stripped first, and only where they open a line, because a
      // naive block-comment regex also fires on `/*` inside a string literal.
      const source = readFileSync(file, 'utf8')
        .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
        .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
      let m: RegExpExecArray | null;
      ref.lastIndex = 0;
      while ((m = ref.exec(source)) !== null) {
        const name = m[1].toLowerCase();
        if (tables.has(name) || ALLOWLIST.has(name) || name.includes('${')) continue;
        const line = source.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line} → ${name}`);
      }
    }

    expect(
      offenders,
      `Referenced tables not in docs/db/schema.snapshot.sql (add a migration, fix the name, ` +
        `or allowlist if runtime-created/guarded):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
