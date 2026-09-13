process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query, getProductByOwner, getVisibleProducts } from '../../src/db/client.js';

// =============================================================================
// A SECOND DOOR ONTO ANOTHER COMPANY'S NUMBERS.
//
// A voice-session route took `product_id` from the request body and passed it
// straight to `startVoiceSession` with no ownership check, sitting between two
// neighbours that both checked. That route has since been removed with the rest
// of Commercial Foundry, but `startVoiceSession` has not, and it still performs
// no check of its own — so what is worth keeping is not the guard, which is
// gone with its door, but the two facts that made the missing guard so
// expensive. They are asserted here rather than described, because the next
// caller of that function inherits both.
//
// IT IS NOT ONLY A WRITE. `startVoiceSession` calls `startSession`, which
// INSERTs a `chat_sessions` row carrying the CALLER as `founder_id` and the
// named product as `product_id`, and the route returns that chat session id.
// `sendMessage` then authorises on `(id, founder_id)` alone — which the
// caller's own planted row satisfies — and takes `productId` from that row to
// build the COO context: the product, its lifecycle state, its wisdom DNA, its
// MRR decomposition and its active stressors, none of them ownership-scoped,
// narrated back by a model told not to hedge.
//
// AND THE ID DID NOT HAVE TO BE GUESSED. `getVisibleProducts` hands every
// active team member the id of a product `getProductByOwner` will refuse them.
// That gap between "can see it exists" and "owns it" is the whole attack
// surface, and it is asserted below rather than described.
//
// The check that closes it is `getProductByOwner`, and whoever calls
// `startVoiceSession` next has to make it before the call, not after.
// =============================================================================

const OWNER = 'f_owner';
const OUTSIDER = 'f_outsider';
const TEAMMATE = 'f_mate';
const P = 'p_victim';

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'o@x.com'], [OUTSIDER, 'a@x.com'], [TEAMMATE, 'm@x.com']]) {
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)', [id, `c_${id}`, email]);
  }
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Victim Co',?,'active')", [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM chat_sessions');
  await query('DELETE FROM team_members');
});

describe('the check the route now performs', () => {
  it('refuses a product the caller does not own', async () => {
    const check = await getProductByOwner(P, OUTSIDER);
    expect(check.rows.length).toBe(0);
  });

  it('admits the owner', async () => {
    const check = await getProductByOwner(P, OWNER);
    expect(check.rows.length).toBe(1);
  });
});

describe('why the id was never the secret', () => {
  it('shows a team member an id that the ownership check refuses them', async () => {
    await query(
      `INSERT INTO team_members (id, product_id, founder_id, role, status)
       VALUES (?, ?, ?, 'co_founder', 'active')`, [nanoid(), P, TEAMMATE]);

    const visible = await getVisibleProducts(TEAMMATE);
    const owned = await getProductByOwner(P, TEAMMATE);

    // Both true at once, which is exactly the gap the missing guard opened.
    expect((visible.rows as unknown as Array<{ id: string }>).map((r) => r.id)).toContain(P);
    expect(owned.rows.length).toBe(0);
  });
});

describe('the shape of the chained read, held in place', () => {
  it('authorises a chat session on the caller alone, so the planted row would have passed', async () => {
    // This is the mechanism, asserted rather than described: a row the outsider
    // owns, pointing at a product they do not. `sendMessage` looks up
    // (id, founder_id) and then trusts the row's product_id.
    const sessionId = nanoid();
    await query(
      `INSERT INTO chat_sessions (id, founder_id, product_id, title)
       VALUES (?, ?, ?, 'Voice session')`, [sessionId, OUTSIDER, P]);

    const asOutsider = await query(
      'SELECT product_id FROM chat_sessions WHERE id = ? AND founder_id = ?', [sessionId, OUTSIDER]);

    expect(asOutsider.rows.length).toBe(1);
    expect((asOutsider.rows[0] as unknown as { product_id: string }).product_id).toBe(P);
    // Which is why the guard has to be at the door that creates the row: by the
    // time sendMessage sees it, the row is the outsider's own and looks correct.
  });
});
