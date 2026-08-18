// =============================================================================
// Tests: a permission model that nothing asked
//
// `team_members` has carried five permission columns since migration 010 —
// can_view_decisions, can_vote_decisions, can_view_financials, can_view_audit,
// can_trigger_actions — and the invite flow writes them. Nothing read any of
// them, anywhere. The only guard was `hasProductAccess`, which asks whether
// somebody is on the team at all.
//
// So an `investor_observer` — a role whose name says what they are for — could
// cast a vote on a company decision, and those votes feed `computeAlignmentScore`
// and the co-founder alignment signals the founder reads.
//
// The columns were not decoration. `can_trigger_actions` defaults to FALSE
// while the other four default TRUE, which is a considered position about what
// an advisor should be able to do, written down in the schema and then never
// asked.
//
// This is the same shape as the sender-of-record rule and the kill switch: a
// rule that exists, is believed, and has no edge between it and the thing it
// governs.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { memberMay, hasProductAccess } from '../../src/services/team/members.js';

const OWNER = 'mc_owner';
const COFOUNDER = 'mc_cofounder';
const OBSERVER = 'mc_observer';
const STRANGER = 'mc_stranger';
const P = 'mc_product';

beforeAll(async () => {
  await runMigrations();
  for (const f of [OWNER, COFOUNDER, OBSERVER, STRANGER]) {
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [f, `clerk_${f}`, `${f}@test.local`]);
  }
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?,'Team Co',?)`, [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM team_members WHERE product_id = ?', [P]);
  await query(
    `INSERT INTO team_members (id, product_id, founder_id, role, status,
       can_view_decisions, can_vote_decisions, can_view_financials, can_view_audit, can_trigger_actions)
     VALUES ('mc_tm_cf', ?, ?, 'co_founder', 'active', 1, 1, 1, 1, 1)`, [P, COFOUNDER]);
  await query(
    `INSERT INTO team_members (id, product_id, founder_id, role, status,
       can_view_decisions, can_vote_decisions, can_view_financials, can_view_audit, can_trigger_actions)
     VALUES ('mc_tm_ob', ?, ?, 'investor_observer', 'active', 1, 0, 0, 0, 0)`, [P, OBSERVER]);
});

describe('the flags are asked', () => {
  it('lets a co-founder vote', async () => {
    expect(await memberMay(P, COFOUNDER, 'can_vote_decisions')).toBe(true);
  });

  it('does not let an observer vote', async () => {
    expect(await memberMay(P, OBSERVER, 'can_vote_decisions'),
      'the whole defect: an observer’s vote fed the alignment score').toBe(false);
  });

  it('still lets the observer read decisions, which is what they are for', async () => {
    // A guard that refuses the legitimate principal is not extra secure.
    expect(await memberMay(P, OBSERVER, 'can_view_decisions')).toBe(true);
  });

  it('honours each flag independently', async () => {
    expect(await memberMay(P, OBSERVER, 'can_view_financials')).toBe(false);
    expect(await memberMay(P, OBSERVER, 'can_view_audit')).toBe(false);
    expect(await memberMay(P, OBSERVER, 'can_trigger_actions')).toBe(false);
    expect(await memberMay(P, COFOUNDER, 'can_trigger_actions')).toBe(true);
  });

  it('always allows the owner, who has no membership row', async () => {
    for (const cap of ['can_view_decisions', 'can_vote_decisions', 'can_view_financials',
      'can_view_audit', 'can_trigger_actions'] as const) {
      expect(await memberMay(P, OWNER, cap), `owner may ${cap}`).toBe(true);
    }
  });

  it('refuses somebody who is not on the team', async () => {
    expect(await memberMay(P, STRANGER, 'can_view_decisions')).toBe(false);
  });

  it('refuses a member whose access was withdrawn', async () => {
    await query(
      `UPDATE team_members SET status = 'removed' WHERE founder_id = ?`, [COFOUNDER]);
    expect(await memberMay(P, COFOUNDER, 'can_vote_decisions')).toBe(false);
  });

  it('refuses a member of another company', async () => {
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('mc_other','Other',?)`, [STRANGER]);
    expect(await memberMay('mc_other', COFOUNDER, 'can_vote_decisions'),
      'membership is of ONE company').toBe(false);
  });
});

describe('membership and permission stay different questions', () => {
  it('hasProductAccess still answers only whether they belong here', async () => {
    // Deliberately unchanged. It is the right answer to a different question,
    // and the defect was callers using it for this one.
    expect(await hasProductAccess(P, OBSERVER)).toBe(true);
    expect(await memberMay(P, OBSERVER, 'can_vote_decisions')).toBe(false);
  });

  it('every route that admits a team member names the capability it needs', () => {
    // The two reachable surfaces for a team member. A route added later that
    // reaches for `hasProductAccess` to decide whether somebody MAY do
    // something is the defect coming back.
    const routes = readFileSync(
      resolve(__dirname, '../../src/routes/dashboard/team.ts'), 'utf8');
    const vote = routes.slice(routes.indexOf("post('/api/decisions/:id/vote'"));
    expect(vote.slice(0, 1200)).toMatch(/memberMay\([^)]*'can_vote_decisions'/);
    const read = routes.slice(routes.indexOf("get('/api/decisions/:id/votes'"));
    expect(read.slice(0, 1200)).toMatch(/memberMay\([^)]*'can_view_decisions'/);
  });
});

// =============================================================================
// TWO ROLE SYSTEMS, NO EDGE BETWEEN THEM.
//
// `account_roles` holds the ladder `requireRole` reads — viewer / analyst /
// admin / owner — and `assignRole` is the only thing that writes it. Nothing
// calls `assignRole`. So no row is ever created, `getUserRole` always returns
// null, and `requireRole('admin')` reduces to the explicit owner check above
// it: in practice, requireOwner.
//
// `team_members` holds the other one — co_founder / advisor /
// investor_observer, with the capability flags this file is about — and the
// invite flow writes it. Nothing bridges the two.
//
// The consequence is not a security hole; it is the opposite, and §13 is
// explicit that this counts: a guard that refuses the legitimate principal is
// not extra secure, it is broken. A founder invites a co-founder, the
// invitation is accepted, and that person sees no companies at all
// (`getProductsByOwner` is owner-only), holds no role, and can reach exactly
// the two endpoints tested above.
//
// What a co-founder, an advisor and an investor observer should each be able
// to see and do is a product decision, and widening authorization is the
// direction where guessing is dangerous. These tests pin what is true now so
// the answer changes deliberately rather than by drift.
// =============================================================================

describe('what membership does not grant, today', () => {
  it('does not put the member on the role ladder', async () => {
    const { getUserRole } = await import('../../src/services/rbac/permissions.js');
    expect(await getUserRole(P, COFOUNDER),
      'nothing calls assignRole, so account_roles is never populated').toBeNull();
  });

  it('leaves requireRole answering only for the owner', async () => {
    const { getUserRole } = await import('../../src/services/rbac/permissions.js');
    expect(await getUserRole(P, OWNER),
      'even the owner holds no account_roles row — the owner check is separate')
      .toBeNull();
  });

  it('does not show the member the company', async () => {
    const { getProductsByOwner } = await import('../../src/db/client.js');
    const mine = await getProductsByOwner(COFOUNDER);
    expect(mine.rows.length,
      'the dashboard lists products by owner, so an invited member sees none')
      .toBe(0);
    expect((await getProductsByOwner(OWNER)).rows.length).toBe(1);
  });

  it('and membership is still real where it is asked', async () => {
    // The two facts must not be confused: the member exists and is trusted for
    // what their row says. They just cannot reach most of the product.
    expect(await hasProductAccess(P, COFOUNDER)).toBe(true);
    expect(await memberMay(P, COFOUNDER, 'can_vote_decisions')).toBe(true);
  });
});
