process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { autonomyAcross } from '../../src/services/founder/autonomy-map.js';

// =============================================================================
// WHAT I MAY DO WITHOUT YOU.
//
// Controls is titled "What I'm allowed to do" and its Permissions section
// rendered ONLY when there were none: `s.permissions.length === 0 ? ... : ''`.
// The moment the owner granted something the section disappeared, so the one
// screen whose job is to answer that question went silent in exactly the state
// where the answer matters.
//
// The reading that replaced it holds three claims:
//
//   1. AN ESTATE'S AUTONOMY IS ITS LOOSEST POINT, not an average. One company
//      set to carry with money left is the answer to "what can it do without
//      me", whatever the others say — so the widest comes first and the
//      sentence leads with it.
//   2. A SYNTHETIC COMPANY IS NOT A PERMISSION. Reference companies exist to
//      rehearse against; reporting that the institution may act on its own
//      somewhere, on the strength of one, is the worst answer this page could
//      give.
//   3. IT GRANTS NOTHING. Reading it must never widen anything, and every act
//      that would goes through the company's own page, one sentence at a time.
// =============================================================================

let OWNER = '';

async function company(name: string, reality: 'real' | 'reference' = 'real'): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,?,?,'active',?)`,
    [id, name, OWNER, reality]);
  return id;
}

/** Money it may spend here without asking. */
async function allow(productId: string, cents: number, statement: string): Promise<void> {
  await query(
    `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents, until)
     VALUES (?,?,?,?,?,datetime('now','+30 days'))`,
    [nanoid(), productId, 'testing this idea', statement, cents]);
}

/** A door the owner shut here. */
async function shut(productId: string, subject: string, statement: string): Promise<void> {
  await query(
    `INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
     VALUES (?,?,?,?,'never')`, [nanoid(), productId, subject, statement]);
}

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  OWNER = `auto_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [OWNER, `clerk_${OWNER}`, `${OWNER}@example.com`]);
});

describe('the estate answers for itself', () => {
  it('says so plainly when it can do nothing without him', async () => {
    await company('Foundry');
    const map = await autonomyAcross(OWNER);
    expect(map.nothingWithoutHim).toBe(true);
    expect(map.sentence).toMatch(/cannot act or spend/i);
  });

  it('answers even before there is anything to act on', async () => {
    const map = await autonomyAcross(OWNER);
    expect(map.companies).toEqual([]);
    expect(map.sentence).toMatch(/nothing here for me to act on/i);
  });

  it('leads with the loosest point rather than averaging', async () => {
    const quiet = await company('A quiet one');
    const loose = await company('The loose one');
    await allow(loose, 25000, 'up to $250 for the test');
    await shut(quiet, 'spend_money', 'Never spend money for A quiet one.');
    const map = await autonomyAcross(OWNER);
    expect(map.companies[0].name).toBe('The loose one');
    expect(map.nothingWithoutHim).toBe(false);
    expect(map.sentence).toMatch(/\$250\.00/);
  });

  it('counts money left rather than money granted', async () => {
    const p = await company('Spender');
    await allow(p, 10000, 'up to $100');
    await query(
      `INSERT INTO asset_money_spent (id, product_id, tool, amount_cents, source)
       VALUES (?,?,?,?,'settled')`, [nanoid(), p, 'anthropic', 4000]);
    const map = await autonomyAcross(OWNER);
    expect(map.companies[0].allowance?.amountCents).toBe(10000);
    expect(map.companies[0].allowance?.remainingCents).toBe(6000);
    expect(map.sentence).toMatch(/\$60\.00/);
  });

  it('never reports a permission over a company that does not exist', async () => {
    const invented = await company('An invented company', 'reference');
    await allow(invented, 100000, 'up to $1,000 in the rehearsal');
    const map = await autonomyAcross(OWNER);
    expect(map.companies).toEqual([]);
    expect(map.nothingWithoutHim).toBe(true);
    expect(map.sentence).not.toMatch(/1,000|100000|\$1000/);
  });

  it('shows the doors he shut, in his own words', async () => {
    const p = await company('Guarded');
    await shut(p, 'spend_money', 'Never spend money for Guarded.');
    const map = await autonomyAcross(OWNER);
    expect(map.companies[0].shut.length).toBeGreaterThan(0);
    expect(map.companies[0].shut.some((d) => d.mode === 'never')).toBe(true);
  });

  it('changes nothing by being read', async () => {
    const p = await company('Untouched');
    await allow(p, 5000, 'up to $50');
    const before = await query('SELECT id, amount_cents, withdrawn_at FROM owner_allowances', []);
    await autonomyAcross(OWNER);
    await autonomyAcross(OWNER);
    const after = await query('SELECT id, amount_cents, withdrawn_at FROM owner_allowances', []);
    expect(after.rows).toEqual(before.rows);
    const boundaries = await query('SELECT COUNT(*) AS n FROM owner_boundaries WHERE product_id = ?', [p]);
    expect(Number((boundaries.rows[0] as Record<string, unknown>).n)).toBe(0);
  });
});
