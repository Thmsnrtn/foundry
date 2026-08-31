process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A SECOND MECHANISM IS NOT A SECOND PROTECTION.
//
// `customer_intelligence.do_not_contact_until` was created by migration 022
// under the comment `-- Rate limiting`, and in all of `src/` the only
// occurrence of the name was the CREATE TABLE that made it. Nothing could put a
// date in it and nothing would have looked.
//
// An unused column is usually not worth a migration. This one was, because of
// what it is NAMED: a steward looking for where "do not contact" is enforced
// would find a column that says the thing and does nothing. Four separate
// controls in this campaign have named a protection and governed nothing; what
// is different here is that a real one now exists beside it, and two
// mechanisms for one rule is a place for them to disagree.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

const files = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});

describe('do not contact', () => {
  it('is named in one place in the schema, and that place is the mechanism', async () => {
    // The invariant is about where the PROTECTION is named. `outreach_suppressions`
    // says it in its table name and its columns are ordinary (`email`, `reason`);
    // what must not exist is another table carrying a column that says it, because
    // that is a second answer to a question with one.
    const offenders: string[] = [];
    const tables = (await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )).rows as unknown as Array<Record<string, unknown>>;

    for (const t of tables) {
      const table = String(t.name);
      if (table === 'outreach_suppressions') continue;
      const cols = (await query(`SELECT name FROM pragma_table_info('${table}')`))
        .rows as unknown as Array<Record<string, unknown>>;
      for (const col of cols) {
        if (/do_not_contact|unsubscrib/i.test(String(col.name))) {
          offenders.push(`${table}.${col.name}`);
        }
      }
    }
    expect(offenders,
      'a second column naming this protection is a place for the two to disagree')
      .toEqual([]);
  });

  it('still has the mechanism it was retired in favour of', async () => {
    const cols = (await query(`SELECT name FROM pragma_table_info('outreach_suppressions')`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(cols.map((c) => String(c.name)), 'the real one is a recorded fact per person')
      .toEqual(expect.arrayContaining(['product_id', 'email', 'reason']));
  });

  it('is not a name any code still reaches for', () => {
    const offenders = files('src')
      .filter((f) => !f.endsWith('.sql'))
      .filter((f) => {
        // The migration explains the retirement and names the column on purpose.
        const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
        return /do_not_contact_until/.test(src);
      });
    expect(offenders).toEqual([]);
  });

  it('leaves the real one working', async () => {
    const { contactIsRefused, recordContactConstraint } = await import(
      '../../src/services/institution/contact-constraint.js');
    await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('odc_f','odc_c','o@example.com')`);
    await query(`INSERT INTO products (id,name,owner_id,status) VALUES ('odc_p','Co','odc_f','active')`);

    expect(await recordContactConstraint({
      productId: 'odc_p', founderId: 'odc_f', email: 'quiet@example.com', reason: 'they_asked',
    })).toEqual({ recorded: true });
    expect(await contactIsRefused('odc_p', 'quiet@example.com'))
      .toMatchObject({ refused: true });
  });
});
