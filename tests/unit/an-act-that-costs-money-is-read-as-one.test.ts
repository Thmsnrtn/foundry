// =============================================================================
// LAW (Roadmap 2027 R41): AN ACT THAT COSTS THE OWNER'S MONEY IS READ AS ONE,
// WHATEVER RUNG IT STANDS ON.
//
// The allowance was consulted only on the financial rung. Listing on a
// marketplace stands on the public rung and also charges a listing fee and a
// cut of every sale (`draws_on_allowance` says so, on the capability), so the
// day a listing tool is bound it would have passed the consequence check with
// no allowance read and no cost stated. Now any act that draws on the
// allowance takes the financial test below the financial rung: it must say
// what it costs, and the allowance must cover it or the owner must have
// approved exactly this act. Legal and destructive acts keep their stricter
// rule; an act that costs nothing is unchanged.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['fee_owner', 'clerk_fee', 'fee@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('fee_co','Fee Co','fee_owner','active','real')", []);
  // A listing tool, bound the way a real one would be: a fee-bearing public act.
  await query(`INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
    VALUES ('cp_test_listing','list_on_marketplace','test_venue','api','test_listing_tool','$0.20 a listing and 6.5% of a sale','available',99)`, []);
});

describe('a fee-bearing act on the public rung', () => {
  it('stands on the public rung and draws on the allowance', async () => {
    const { rungOfTool } = await import('../../src/services/institution/consequence.js');
    const f = await rungOfTool('test_listing_tool');
    expect(f?.rung).toBe('public');
    expect(f?.drawsOnAllowance).toBe(true);
  });
  it('is refused when it does not say what it costs', async () => {
    const { consequenceAllows } = await import('../../src/services/institution/consequence.js');
    const v = await consequenceAllows({ productId: 'fee_co', tool: 'test_listing_tool', paramsFingerprint: null });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/nothing said what it would cost/);
  });
  it('is refused when it says, and nothing allows or approves it', async () => {
    const { consequenceAllows } = await import('../../src/services/institution/consequence.js');
    const v = await consequenceAllows({ productId: 'fee_co', tool: 'test_listing_tool', paramsFingerprint: null, estimatedCents: 20 });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/neither allowed money for this company nor approved this act/);
  });
});

describe('what costs nothing is unchanged', () => {
  it('a public act that draws on nothing still passes the consequence check', async () => {
    const { consequenceAllows } = await import('../../src/services/institution/consequence.js');
    const v = await consequenceAllows({ productId: 'fee_co', tool: 'publish_page_kv_put_does_not_exist', paramsFingerprint: null });
    // An unbound tool is refused as before; the bound, free one below passes.
    expect(v.allowed).toBe(false);
    const free = await consequenceAllows({ productId: 'fee_co', tool: 'cloudflare_kv_put', paramsFingerprint: null });
    expect(free.allowed).toBe(true);
  });
});
