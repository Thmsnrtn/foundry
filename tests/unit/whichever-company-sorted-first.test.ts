process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { selectedProductId } from '../../src/routes/dashboard/_shared.js';
import { getFleetOverview } from '../../src/services/fleet/observatory.js';

// =============================================================================
// WHICHEVER COMPANY SORTED FIRST.
//
// Five places resolved "the founder's company" with
// `SELECT ... FROM products WHERE owner_id = ? LIMIT 1` — no ORDER BY, so the
// row SQLite happened to return first — and then did something real with it:
// rotated an ingest token, generated a public share link, wrote the week's
// plan, described the founder to every other founder in the network, and set
// the tone of every AI answer from one company's sector.
//
// The pause/resume routes already did it correctly, from the cookie the company
// switcher sets. That rule now has one home, and it refuses rather than guesses.
//
// And the Fleet Observatory — "every agent's status across all of a founder's
// products" — read `owner_id` alone, so an invited co-founder saw nothing while
// every other page showed them the company they had been accepted into.
// =============================================================================

const OWNER = 'f_own';
const MEMBER = 'f_mem';

function ctx(cookie?: string) {
  // Only `getCookie(c, 'foundry_product')` is exercised.
  return { req: { raw: { headers: new Headers(cookie ? { cookie: `foundry_product=${cookie}` } : {}) } } } as never;
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?, 'c_own','own@example.com')", [OWNER]);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?, 'c_mem','mem@example.com')", [MEMBER]);
});

beforeEach(async () => {
  await query('DELETE FROM team_members');
  await query('DELETE FROM agent_instances');
  await query('DELETE FROM products');
});

async function product(id: string, name: string, owner = OWNER, status = 'active') {
  await query('INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,?)', [id, name, owner, status]);
}

describe('the company a founder is acting on', () => {
  it('is the one they selected', async () => {
    await product('p_a', 'Alpha');
    await product('p_b', 'Beta');
    expect(await selectedProductId(ctx('p_b'), OWNER)).toBe('p_b');
  });

  it('is refused when two companies exist and none is selected', async () => {
    await product('p_a', 'Alpha');
    await product('p_b', 'Beta');
    // The caller then does nothing, instead of acting on whichever sorted first.
    expect(await selectedProductId(ctx(), OWNER)).toBeNull();
  });

  it('is the only company when there is only one', async () => {
    await product('p_a', 'Alpha');
    expect(await selectedProductId(ctx(), OWNER)).toBe('p_a');
  });

  it('ignores a selection that is not this founder’s', async () => {
    await product('p_a', 'Alpha');
    await product('p_b', 'Beta');
    await product('p_x', 'Someone else', MEMBER);
    // Naming another founder's company selects nothing, and with two of their
    // own to choose between there is nothing to fall back to.
    expect(await selectedProductId(ctx('p_x'), OWNER)).toBeNull();
  });

  it('ignores a stale cookie and falls back to the single company', async () => {
    await product('p_a', 'Alpha');
    expect(await selectedProductId(ctx('p_deleted'), OWNER)).toBe('p_a');
  });
});

describe('the fleet observatory', () => {
  it('shows a company the founder was accepted into', async () => {
    await product('p_a', 'Alpha');
    await query(
      `INSERT INTO team_members (id, product_id, founder_id, role, status)
       VALUES ('tm_1', 'p_a', ?, 'co_founder', 'active')`, [MEMBER]);

    const fleet = await getFleetOverview(MEMBER);
    expect(fleet.products.map((p) => p.productId)).toEqual(['p_a']);
  });

  it('does not show a company they have no membership in', async () => {
    await product('p_a', 'Alpha');
    const fleet = await getFleetOverview(MEMBER);
    expect(fleet.products).toHaveLength(0);
    expect(fleet.totals.products).toBe(0);
  });

  it('still shows an owner their own companies, sorted by name', async () => {
    await product('p_z', 'Zebra');
    await product('p_a', 'Alpha');
    const fleet = await getFleetOverview(OWNER);
    expect(fleet.products.map((p) => p.productName)).toEqual(['Alpha', 'Zebra']);
  });

  it('leaves out an archived company', async () => {
    await product('p_a', 'Alpha');
    await product('p_old', 'Old', OWNER, 'archived');
    const fleet = await getFleetOverview(OWNER);
    expect(fleet.products.map((p) => p.productId)).toEqual(['p_a']);
  });
});

describe('what the network is told about a founder', () => {
  it('carries a sector only when their companies agree', async () => {
    const { upsertNetworkProfile } = await import('../../src/services/network/matchmaking.js');
    await query("UPDATE products SET sector_profile='education' WHERE id='none'");
    await product('p_a', 'Alpha');
    await product('p_b', 'Beta');
    await query("UPDATE products SET sector_profile='education', growth_stage='seed' WHERE id='p_a'");
    await query("UPDATE products SET sector_profile='developer_tools', growth_stage='seed' WHERE id='p_b'");

    await upsertNetworkProfile(OWNER, { display_name: 'Owner' });
    const row = (await query('SELECT sector, growth_stage FROM network_profiles WHERE founder_id=?', [OWNER]))
      .rows[0] as unknown as Record<string, unknown>;
    expect(row.sector, 'two sectors is not one sector').toBeNull();
    // They agree on the stage, so that one is carried.
    expect(row.growth_stage).toBe('seed');
  });
});
