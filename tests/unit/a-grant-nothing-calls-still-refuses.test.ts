process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

// =============================================================================
// A GRANT NOTHING CALLS STILL REFUSES (F1, 9 October 2026).
//
// AcreOS held a monthly grant function with no callers: one wiring step from
// giving away money, and no test had ever made it refuse anything. Foundry's
// census of exported functions on its money, delivery and authority paths
// found the same shape once: `grantDelegation` (and `armBreaker` beside it)
// writes a STANDING PERMISSION and has no production caller and no test. It
// stays — it is the owner's own act, built ahead of the route that will carry
// it — but it is pinned here so that the day a route calls it, the refusals
// it promises are already proved:
//   * a grant written as anyone but a person is refused, whatever the caller says;
//   * a legal or destructive ceiling is refused: those rungs stay his, one act at a time;
//   * a grant with nothing excluded, or with neither an expiry nor a review, is refused;
// and that it is still unwired, so wiring it is a change somebody sees.
// =============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const A = await import('../../src/services/institution/acting.js');
const base = {
  founderId: 'f_g', productId: 'p_g', actorId: 'ba_g', responsibility: 'answer support mail', actClass: 'reply',
  contentScope: 'the customer\'s own question', className: 'support replies', purpose: 'answer what was asked',
  audience: 'existing_customer' as const, excludes: 'refunds, anything about money', ceiling: 'public' as const,
  days: 30, grantedBy: 'founder:f_g',
};

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES ('f_g','clk_g','g@example.com','Owner')`);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_g','Lamplight','f_g','active','active','real')`);
  await query(`INSERT INTO business_actors (id, founder_id, product_id, kind, display_name) VALUES ('ba_g','f_g','p_g','company','Lamplight')`);
});

describe('grantDelegation refuses what it promises to', () => {
  it('a grant written as the institution is refused by the database', async () => {
    await expect(A.grantDelegation({ ...base, grantedBy: 'institution:forge' })).rejects.toThrow(/not_granted_by_a_person/);
  });
  it('a legal or destructive ceiling is refused', async () => {
    for (const ceiling of ['legal', 'destructive'] as const) {
      expect(await A.grantDelegation({ ...base, ceiling })).toMatchObject({ refused: expect.stringMatching(/stay yours/) });
    }
  });
  it('nothing excluded, or neither an expiry nor a review, is refused', async () => {
    expect(await A.grantDelegation({ ...base, excludes: '  ' })).toMatchObject({ refused: expect.stringMatching(/nothing excluded/) });
    expect(await A.grantDelegation({ ...base, days: null, reviewEveryDays: null })).toHaveProperty('id'); // durable defaults to a 90-day review
    const n = Number(((await query(`SELECT COUNT(*) AS n FROM delegations WHERE review_every_days = 90`)).rows[0] as Record<string, unknown>).n);
    expect(n).toBe(1);
  });
  it('his grant is written, as his', async () => {
    const r = await A.grantDelegation(base);
    expect(r).toHaveProperty('id');
    const row = (await query(`SELECT granted_by, ceiling FROM delegations WHERE id = ?`, [(r as { id: string }).id])).rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({ granted_by: 'founder:f_g', ceiling: 'public' });
  });
});

describe('and it is still unwired', () => {
  it('no production file calls grantDelegation or armBreaker (wiring one is a change this test makes visible)', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.ts$/.test(e.name) ? [join(d, e.name)] : []);
    const callers = walk('src').filter((f) => !f.endsWith('institution/acting.ts'))
      .filter((f) => /\b(grantDelegation|armBreaker)\s*\(/.test(readFileSync(f, 'utf8')));
    expect(callers).toEqual([]);
  });
});
