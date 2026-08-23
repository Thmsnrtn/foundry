process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query, getProductByOwner, getVisibleProducts } from '../../src/db/client.js';

// =============================================================================
// A SECOND DOOR ONTO ANOTHER COMPANY'S NUMBERS.
//
// `POST /api/voice/session/start` took `product_id` from the request body and
// passed it straight to `startVoiceSession` with no ownership check. It sat
// BETWEEN two routes that both check and both cite the ticket that made them —
// `/api/voice/memo` (RT02-03) above it and `/api/voice/session/:id/end`
// (RT02-02) below it. The audit that raised all three recorded this one as
// RT02-04, with the remediation written out, and it was the one not applied.
//
// IT WAS NOT ONLY A WRITE. `startVoiceSession` calls `startSession`, which
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
// The route-level guard is what closes it, so the guard is what these test.
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

describe('the route itself', () => {
  // COMMENTS STRIPPED FIRST. The first version of this asserted against the raw
  // file, and the explanatory comment above the guard NAMES `getProductByOwner`
  // and RT02-04 — so deleting the actual call left the assertions passing on the
  // prose describing it. Both mutations survived. That is the seventh time this
  // campaign that text about code has been read as code, and the first time it
  // was in a test I had just written to prove a security fix.
  const src = stripComments(readFileSync('src/routes/api/platform.ts', 'utf8'), { lineComments: true });

  it('checks ownership before starting a voice session', () => {
    const route = src.slice(src.indexOf("post('/api/voice/session/start'"));
    const body = route.slice(0, route.indexOf('});'));
    // The ticket reference stays in the comment above the guard, which is
    // documentation; what is asserted here is the call and its position. A
    // check that runs AFTER the thing it guards is decoration.
    expect(body).toContain('getProductByOwner');
    expect(body.indexOf('getProductByOwner')).toBeLessThan(body.indexOf('startVoiceSession('));
  });

  it('leaves all three voice routes guarded, not two of three', () => {
    for (const route of ['/api/voice/memo', '/api/voice/session/start', '/api/voice/session/:id/end']) {
      const at = src.indexOf(`'${route}'`);
      expect(at, `${route} is missing`).toBeGreaterThan(-1);
      const body = src.slice(at, at + 1400);
      expect(body, `${route} has no ownership check`).toMatch(/getProductByOwner|p\.owner_id = \?/);
    }
  });
});
