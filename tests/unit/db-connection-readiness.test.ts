process.env.TURSO_DATABASE_URL = 'file::memory:';

import { describe, expect, it } from 'vitest';
import { executeRaw, query } from '../../src/db/client.js';

// =============================================================================
// Foreign key enforcement is real, and applying it is not left to scheduling.
//
// `getDb()` used to fire `PRAGMA foreign_keys = ON` without awaiting it and
// swallow any failure, while its own comment said — correctly — that without
// that PRAGMA "all REFERENCES clauses are decorative".
//
// HONEST SCOPE OF THIS TEST. Reverting the client to the old fire-and-forget
// form does NOT fail these tests: on this driver the PRAGMA reliably wins the
// race, so the defect was latent rather than observed. The change was kept
// because ordering should not depend on that, and because a failed PRAGMA must
// be visible rather than swallowed — but it fixed no measured fault, and it is
// not the explanation for any recorded test nondeterminism.
//
// What these tests do earn independently: nothing else in the suite asserts
// that REFERENCES clauses are actually enforced. If the PRAGMA is ever lost —
// by a driver change, a connection option, or a hosted configuration that
// silently declines it — integrity would degrade quietly everywhere. That
// fails here instead.
// =============================================================================

describe('database connection readiness', () => {
  it('has foreign keys actually enabled on the very first statement', async () => {
    // No `ready()` call and no warm-up: this is the first query the process
    // issues, which is exactly the window the old code left open.
    const pragma = await query('PRAGMA foreign_keys');
    expect(Number((pragma.rows[0] as Record<string, unknown>).foreign_keys)).toBe(1);
  });

  it('enforces REFERENCES, so the PRAGMA is doing real work', async () => {
    // A test asserting only the PRAGMA value would pass against a build where
    // the setting is reported but not enforced. This asserts the consequence.
    await executeRaw(
      'CREATE TABLE fk_parent (id TEXT PRIMARY KEY);\n'
      + 'CREATE TABLE fk_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES fk_parent(id));',
    );
    await expect(
      query("INSERT INTO fk_child (id,parent_id) VALUES ('c1','nonexistent')"),
    ).rejects.toThrow(/FOREIGN KEY/i);

    await query("INSERT INTO fk_parent (id) VALUES ('p1')");
    await query("INSERT INTO fk_child (id,parent_id) VALUES ('c1','p1')");
    expect((await query('SELECT COUNT(*) n FROM fk_child')).rows[0]).toMatchObject({ n: 1 });
  });

  it('applies the setting once, not per statement', async () => {
    // Readiness is awaited by every entry point, so it must be a settled
    // promise rather than work repeated on each call.
    for (let i = 0; i < 5; i++) {
      const pragma = await query('PRAGMA foreign_keys');
      expect(Number((pragma.rows[0] as Record<string, unknown>).foreign_keys)).toBe(1);
    }
    await executeRaw('SELECT 1;');
  });
});
