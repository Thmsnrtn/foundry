// =============================================================================
// THE TEMPLATE IS THE SCHEMA.
//
// Every test file used to replay all the migrations into its own database.
// Now the first dumps a template and the rest restore it. This is the proof
// that a restored database is the migrated one: the same objects with the
// same SQL, the same rows in every table, the same guards refusing the same
// writes with the same words — and that the template is keyed to the
// migration files, so an edited migration is never served a stale copy.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_MIGRATION_TEMPLATE = 'off'; // the honest way, to compare against

import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations } from '../../src/db/migrate.js';
import { getDb } from '../../src/db/client.js';
import { dumpTemplate, restoreTemplate, templateKey } from '../../src/test/template-db.js';

let migrated: Client;
let restored: Client;

const objects = async (db: Client) => (await db.execute(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)).rows
  .map((r) => `${String(r.type)}|${String(r.name)}|${String(r.tbl_name)}|${String(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);
const tableRows = async (db: Client, table: string) => {
  const rs = await db.execute(`SELECT * FROM "${table.replace(/"/g, '""')}"`);
  return rs.rows.map((row) => rs.columns.map((c, i) => `${c}=${String(row[i] ?? 'NULL')}`).join(',')).sort();
};
const failure = async (db: Client, sql: string): Promise<string> => {
  try { await db.execute(sql); return 'accepted'; } catch (err) { return (err as Error).message.replace(/^.*?:\s*/, ''); }
};

beforeAll(async () => {
  await runMigrations();
  migrated = getDb();
  restored = createClient({ url: 'file::memory:' });
  await restored.execute('PRAGMA foreign_keys = ON');
  await restoreTemplate(restored, await dumpTemplate(migrated));
}, 120_000);

describe('a restored database is the migrated one', () => {
  it('has the same objects with the same SQL: tables, indexes, triggers, views', async () => {
    const a = await objects(migrated); const b = await objects(restored);
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(1000);
    expect(a.filter((o) => o.startsWith('trigger|')).length).toBeGreaterThan(400);
  });

  it('has the same rows in every table, including the migration markers and every seeded vocabulary', async () => {
    const tables = (await migrated.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r) => String(r.name));
    let seeded = 0;
    for (const t of tables) {
      const a = await tableRows(migrated, t); const b = await tableRows(restored, t);
      expect(b, t).toEqual(a);
      if (a.length > 0) seeded += 1;
    }
    expect(seeded).toBeGreaterThan(30);
    expect((await tableRows(restored, 'schema_migrations')).length).toBe((await tableRows(migrated, 'schema_migrations')).length);
  });

  it('refuses the same writes with the same words: the constitutional guards are live', async () => {
    const writes = [
      `INSERT INTO venture_guidance (id, mandate_id, founder_id, statement, kind) VALUES ('g_t','m_t','f_t','','avoid')`,
      `INSERT INTO probe_exchanges (exchange, what_it_is, reveals, confounds, available, sort_order) VALUES ('barter','x','y','z',1,99)`,
      `DELETE FROM business_outcome_event_kinds WHERE kind = 'payment'`,
      `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode, rerun_of) VALUES ('x_t','f','o','u','a','b','c',0,'real','nope')`,
    ];
    for (const w of writes) {
      const a = await failure(migrated, w); const b = await failure(restored, w);
      expect(a, w).not.toBe('accepted');
      expect(b, w).toBe(a);
    }
    expect(Number((await restored.execute('PRAGMA foreign_keys')).rows[0]![0])).toBe(1);
  });

  it('is keyed to the migration files, so an edited migration is a different template', () => {
    const dir = resolve(process.cwd(), 'src', 'db', 'migrations');
    const key = templateKey(dir);
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(templateKey(dir)).toBe(key);
  });
});
