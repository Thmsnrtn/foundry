process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whatTheNumbersSay } from '../../src/services/founder/what-the-numbers-say.js';

// =============================================================================
// A NUMBER IS ONLY AS GOOD AS THE READING BEHIND IT.
//
// Three ways the numbers on his screens described something that had not
// happened, all found by a review against senior standards.
//
// "Monthly cash flow" summed each company's last-ever reading with no lower
// bound, so a business that stopped reporting eight months ago kept
// contributing its final figure to today's total, forever.
//
// "on a month ago" compared against the newest reading at least thirty days
// old — with nothing stopping it being five hundred days old. A company that
// reported twice, last week and two years ago, had every number described as
// having moved "on a month ago".
//
// And a percentage of almost nothing is not a percentage: one signup becoming
// three rendered as "up about 200%", which makes a business look like it is
// tripling.
// =============================================================================

const CO = 'numbers_co';
beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    ['n_owner', 'clerk_n', 'owner@example.com', 'Owner']);
  await query('INSERT INTO products (id, owner_id, name, status) VALUES (?,?,?,?)',
    [CO, 'n_owner', 'Tidewater', 'active']);
});

async function snapshot(date: string, fields: Record<string, number>): Promise<void> {
  const cols = Object.keys(fields);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${cols.join(', ')})
     VALUES (?,?,?,${cols.map(() => '?').join(',')})`,
    [`s_${date}_${String(Math.random()).slice(2, 8)}`, CO, date, ...cols.map((c) => fields[c] ?? 0)]);
}

describe('what a comparison is allowed to compare against', () => {
  it('refuses to call a two-year-old reading "a month ago"', async () => {
    await snapshot('2024-01-01', { mrr_cents: 100_000, signups_7d: 40 });
    await snapshot(new Date().toISOString().slice(0, 10),
      { mrr_cents: 140_000, signups_7d: 60 });
    const read = await whatTheNumbersSay(CO);
    const revenue = read.numbers.find((n) => n.label.includes('revenue'));
    expect(revenue?.direction, 'no comparison is possible').toBeNull();
    expect(revenue?.sentence).toContain('nothing from a month ago');
  });

  it('states the absolute move when the base is too small for a percentage', async () => {
    const monthAgo = new Date(Date.now() - 32 * 864e5).toISOString().slice(0, 10);
    await query('DELETE FROM metric_snapshots WHERE product_id = ?', [CO]);
    await snapshot(monthAgo, { signups_7d: 1, mrr_cents: 500_000 });
    await snapshot(new Date().toISOString().slice(0, 10),
      { signups_7d: 3, mrr_cents: 600_000 });
    const read = await whatTheNumbersSay(CO);
    const signups = read.numbers.find((n) => n.label.includes('signup'));
    expect(signups?.movement, 'one to three is not two hundred per cent')
      .toContain('too few to put a percentage on');
    expect(signups?.movement).toContain('1 to 3');
    // And a real base still gets a percentage.
    const revenue = read.numbers.find((n) => n.label === 'monthly revenue');
    expect(revenue?.movement).toContain('%');
  });
});
