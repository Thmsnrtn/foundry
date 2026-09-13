// =============================================================================
// Tests: one writer per investor document.
//
// `board_packets` had two writers with disjoint columns, and so did
// `investor_updates`. Both routes were mounted, both listed the same table, and
// each rendered the other's rows as a document with a title, a quarter, and
// every section empty. Nothing raised: each half worked perfectly on its own
// rows and reported the other's as a quiet quarter.
//
// `investor_updates` has since been dropped outright — both of its writers are
// gone, the canonical one last — so what remains here is the board packet and
// the rule it is still held to.
//
// The SCP surface is canonical because the navigation points at it — "Investor
// Board" in the sidebar, "Investor Hub" in the tab bar — and at `/investors`
// from nowhere. One is the product; the other is the projection left behind.
//
// These are structural assertions on purpose. The defect was never in a code
// path a test could walk — both paths worked. It was in there being two.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { runMigrations, splitSqlStatements } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

/** Every source file, so "who writes this table" is answered over all of them
 *  rather than over the two somebody remembered. */
function sourceFiles(dir = 'src', out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function writersOf(table: string): string[] {
  const pattern = new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, 'i');
  return sourceFiles().filter((f) => {
    if (f.includes('/db/seed.ts')) return false;      // fixtures, not a surface
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    return pattern.test(src);
  });
}

beforeAll(async () => {
  await runMigrations();
});

describe('an investor document has exactly one source', () => {
  // `investor_updates` was the second table checked here, on the same rule.
  // Both of its writers are gone: the `/investors` projection went with the
  // Commercial Foundry surface, and `scp/investor/investor-update.ts` — the
  // canonical one this test chose — had no caller left afterwards, so the
  // module and the table were removed. "Exactly one writer" is not a statement
  // that can be made about a table that no longer exists, and the rule is
  // unchanged for the document that does.
  for (const table of ['board_packets']) {
    it(`${table} is written in one place`, () => {
      const writers = writersOf(table);
      expect(writers, `${table} has ${writers.length} writers: ${writers.join(', ')}`)
        .toHaveLength(1);
      expect(writers[0], `${table} must be written by the surface the navigation points at`)
        .toContain('services/scp/investor/');
    });
  }

  it('and the navigation still points at the surface that writes them', () => {
    // The whole basis for choosing which of the two survives. If the nav ever
    // stops pointing at /board, this choice needs remaking rather than
    // inheriting.
    const layout = readFileSync('src/views/layout.ts', 'utf8');
    expect(layout).toContain("href:'/board'");
    expect(layout).toContain("href: '/board'");
  });
});

describe('the rows the retired writers left behind are readable', () => {
  it('carries a legacy board packet into the canonical shape', async () => {
    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES ('ow_f','clerk_ow','ow@test.local')`);
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES ('ow_p','Co','ow_f','active')`);
    await query(
      `INSERT INTO board_packets (id, product_id, quarter, period_start, period_end,
          executive_summary, signal_narrative, mrr_narrative, status)
       VALUES ('ow_legacy','ow_p','2024-Q1','2024-01-01','2024-03-31',
          'We grew.','Signal held.','MRR up 12%.','draft')`);
    // Re-run the backfill exactly as the migration states it, split by the
    // same function the migrator uses — a test that hand-rolls its own SQL
    // splitter is testing its own splitter.
    //
    // The migration's other two statements carried `investor_updates` forward
    // and are skipped by name, because that table was dropped by migration 309
    // and replaying them here raises `no such table` before the packet is ever
    // checked. The board-packet statement is replayed verbatim, which is the
    // part this case is about.
    const migration = readFileSync(
      'src/db/migrations/164_one_writer_per_investor_document.sql', 'utf8');
    const packetStatements = splitSqlStatements(migration)
      .filter((stmt) => /\bboard_packets\b/.test(stmt));
    expect(packetStatements, 'the board-packet backfill is no longer in this migration')
      .toHaveLength(1);
    for (const stmt of packetStatements) await query(stmt);

    const row = (await query(`SELECT narrative_json FROM board_packets WHERE id='ow_legacy'`))
      .rows[0] as Record<string, unknown>;
    expect(row.narrative_json, 'a legacy packet stayed unreadable by the canonical reader')
      .not.toBeNull();
    const parsed = JSON.parse(String(row.narrative_json)) as Record<string, unknown>;
    expect(String(parsed.executive_summary)).toContain('We grew.');
    // The prose columns are CARRIED, not scattered into arrays they were never
    // written as. Losing them silently would be the same defect again.
    expect(String(parsed.executive_summary)).toContain('Signal held.');
    expect(String(parsed.executive_summary)).toContain('MRR up 12%.');
    expect(parsed.wins, 'prose must not be invented into structured wins').toEqual([]);
  });

  // The investor-update half of the same backfill — giving an API-created row
  // the `month` every reader keys on — went with `investor_updates` itself in
  // migration 309. The legacy rows it carried forward are gone with the table,
  // and the board packet above is the whole of what is left to carry.
});
