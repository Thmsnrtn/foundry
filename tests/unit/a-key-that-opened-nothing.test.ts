process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { createPortfolio } from '../../src/services/portfolio/manager.js';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A KEY THAT OPENED NOTHING, KEPT IN THE CLEAR.
//
// `createPortfolio` minted `pfk_<32 chars>`, stored it in `portfolios.api_key`
// as plaintext, and RETURNED it to the portfolio owner. The red-team audit
// raised that as RT02-10: any database leak, backup or replica hands over every
// portfolio's live API key in cleartext with no cracking step, while the main
// API keys are SHA-256 hashed before storage.
//
// Reading it again found what the ticket did not. The only reader,
// `authenticatePortfolioKey`, HAD NO CALLER — imported by the routes file and
// never invoked. The key authenticated nothing, anywhere.
//
// Hashing it would have reduced the blast radius of a leak and left the worse
// half standing: AN API KEY HANDED TO A CUSTOMER SAYS A DOOR EXISTS. There was
// no door.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => { await query('DELETE FROM portfolios'); });

describe('creating a portfolio', () => {
  it('does not hand back a credential', async () => {
    const created = await createPortfolio('Fund One', 'vc', 'gp@example.com');

    expect(created.id).toBeTruthy();
    expect(Object.keys(created)).toEqual(['id']);
    expect((created as Record<string, unknown>).api_key).toBeUndefined();
  });

  it('stores no secret on the row', async () => {
    const created = await createPortfolio('Fund Two', 'vc', 'gp@example.com');

    const row = (await query('SELECT api_key FROM portfolios WHERE id = ?', [created.id]))
      .rows[0] as unknown as { api_key: string | null };
    expect(row.api_key).toBeNull();
  });

  it('mints nothing that looks like a key anywhere in the source', () => {
    // Comments stripped: the paragraphs above and in the migration explain the
    // prefix, and prose about a secret is not a secret.
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk('src');
    const minting = files.filter((f) =>
      /`pfk_\$\{|'pfk_'\s*\+|"pfk_"\s*\+/.test(stripComments(readFileSync(f, 'utf8'), { lineComments: true })));
    expect(minting).toEqual([]);
  });

  it('leaves no reader for the column either', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk('src');
    // A guard on a value nothing writes is how the first version got here.
    const readers = files.filter((f) =>
      /authenticatePortfolioKey/.test(stripComments(readFileSync(f, 'utf8'), { lineComments: true })));
    expect(readers).toEqual([]);
  });
});

describe('the rows written before', () => {
  it('carry no plaintext secret after every migration applies', async () => {
    const rows = await query('SELECT COUNT(*) AS n FROM portfolios WHERE api_key IS NOT NULL');
    expect((rows.rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it('is cleared by the migration, not only by the code change', async () => {
    // A code change stops new secrets; only this statement removes the ones
    // already written, which is the half a code change cannot do.
    await query(
      `INSERT INTO portfolios (id, name, organization_type, owner_email, api_key)
       VALUES ('pf_legacy', 'Legacy', 'vc', 'old@example.com', 'pfk_leftover')`);

    const migration = readFileSync('src/db/migrations/200_a_key_that_opened_nothing.sql', 'utf8');
    const statement = migration.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').trim();
    await query(statement.replace(/;\s*$/, ''));

    const row = (await query("SELECT api_key FROM portfolios WHERE id = 'pf_legacy'"))
      .rows[0] as unknown as { api_key: string | null };
    expect(row.api_key).toBeNull();
  });
});
