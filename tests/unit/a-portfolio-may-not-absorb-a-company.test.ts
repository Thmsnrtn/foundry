process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { addToPortfolio, getPortfolioOverview } from '../../src/services/portfolio/manager.js';

// =============================================================================
// OWNING A PORTFOLIO IS NOT OWNING A COMPANY.
//
// The route checked that the caller owns the PORTFOLIO and then took
// `product_id` straight from the request body. Anyone with a portfolio could
// absorb any company by id — and membership is not decorative: it puts that
// company's name, MRR, risk state, churn and activation on somebody else's
// dashboard, and its metrics into a percentile against its peers.
//
// The owner's own use case is the whole point of the allowance rather than an
// exception to it: a portfolio of your own companies needs nobody's permission
// but yours. A company belonging to somebody else needs that person to have
// agreed, and there is nowhere to record such an agreement yet — so it is
// refused rather than assumed.
// =============================================================================

async function founder(id: string, email: string): Promise<void> {
  await query(`INSERT OR IGNORE INTO founders (id,clerk_user_id,email) VALUES (?,?,?)`,
    [id, `clerk_${id}`, email]);
}
async function product(id: string, ownerId: string): Promise<void> {
  await query(`INSERT OR IGNORE INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')`,
    [id, `Co ${id}`, ownerId]);
}

beforeAll(async () => {
  await runMigrations();
  await founder('pf_owner', 'owner@example.com');
  await founder('pf_stranger', 'stranger@example.com');
  await product('pf_mine', 'pf_owner');
  await product('pf_theirs', 'pf_stranger');
  await query(
    `INSERT OR IGNORE INTO portfolios (id,name,owner_email,organization_type)
     VALUES ('pf_book','My companies','owner@example.com','operator')`);
});

describe('adding a company to a portfolio', () => {
  it('accepts a company the portfolio owner owns', async () => {
    expect(await addToPortfolio('pf_book', 'pf_mine', 'pf_owner')).toBeNull();
    const overview = await getPortfolioOverview('pf_book');
    expect(JSON.stringify(overview)).toContain('pf_mine');
  });

  it('refuses a company belonging to somebody else', async () => {
    expect(await addToPortfolio('pf_book', 'pf_theirs', 'pf_stranger'))
      .toEqual({ refused: 'company_not_yours' });
    const rows = await query(
      'SELECT COUNT(*) n FROM portfolio_memberships WHERE product_id=?', ['pf_theirs']);
    expect(rows.rows[0]).toMatchObject({ n: 0 });
  });

  it('refuses a company id that names nothing', async () => {
    expect(await addToPortfolio('pf_book', 'pf_nothing', 'pf_owner'))
      .toEqual({ refused: 'company_unknown' });
  });

  it('is refused in the service, so the route cannot forget it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const route = readFileSync(
      resolve(__dirname, '../../src/routes/api/platform.ts'), 'utf8');
    // The route must consume the answer rather than discard it.
    expect(route).toContain('if (refusal) return c.json');
  });
});
