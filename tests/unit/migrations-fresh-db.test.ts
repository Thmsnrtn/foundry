// =============================================================================
// Tests: Fresh-DB migration applies cleanly (Phase 2.4 / 3.2)
//
// A fresh Fly deploy runs the full migration chain against an empty database.
// This had accumulated schema drift that made it fail partway (blocking
// from-scratch deploys). This test applies every migration to an isolated
// in-memory DB and asserts zero unexpected failures, then exercises the
// integration status write against the real reconciled schema.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@libsql/client';
import { splitSqlStatements } from '../../src/db/migrate.js';

const MIGRATIONS_DIR = resolve(__dirname, '../../src/db/migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

async function applyAll(db: ReturnType<typeof createClient>): Promise<string[]> {
  const failures: string[] = [];
  for (const f of migrationFiles()) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf-8');
    for (const stmt of splitSqlStatements(sql)) {
      try {
        await db.execute({ sql: stmt, args: [] });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        // The runner intentionally swallows these (idempotency).
        if (msg.includes('duplicate column') || msg.includes('already exists')) continue;
        failures.push(`${f}: ${msg}`);
      }
    }
  }
  return failures;
}

describe('fresh-DB migration', () => {
  it('applies the full chain to an empty database with zero failures', async () => {
    const db = createClient({ url: 'file::memory:' });
    const failures = await applyAll(db);
    expect(failures, `unexpected migration failures:\n${failures.join('\n')}`).toEqual([]);
  });

  it("accepts an integration written with status 'active' (schema CHECK agrees)", async () => {
    const db = createClient({ url: 'file::memory:' });
    const failures = await applyAll(db);
    expect(failures).toEqual([]);

    await db.execute({ sql: "INSERT INTO founders (id, clerk_user_id, email) VALUES ('f1','c1','a@b.co')", args: [] });
    await db.execute({ sql: "INSERT INTO products (id, name, owner_id) VALUES ('p1','P','f1')", args: [] });
    // Must not throw a CHECK-constraint error.
    await db.execute({
      sql: "INSERT INTO integrations (id, product_id, type, status, name) VALUES ('i1','p1','stripe','active','stripe')",
      args: [],
    });
    const r = await db.execute({ sql: "SELECT status FROM integrations WHERE id='i1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).status).toBe('active');
  });
});
