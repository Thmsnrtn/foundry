process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { selectedProductId } from '../../src/routes/dashboard/_shared.js';

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
// The rule now has one home — `selectedProductId` in the dashboard's shared
// module — and it refuses rather than guesses. Several of the five callers were
// Commercial Foundry pages and are gone; the resolver is what any new one has to
// go through, so the resolver is what is exercised here.
//
// TWO OF THE READERS ARE NOW GONE TOO. The Fleet Observatory — "every agent's
// status across all of a founder's products" — read `owner_id` alone, so an
// invited co-founder saw nothing while every other page showed them the company
// they had been accepted into; and `network/matchmaking.ts` described a founder
// to every other founder from whichever of their companies sorted first. Both
// modules were reachable from no entry point and have been deleted, and the
// five cases that held them to a membership check and to "two sectors is not
// one sector" went with them. The resolver below is the rule that survives.
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
