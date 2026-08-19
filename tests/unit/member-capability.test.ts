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

  it('fails closed on a capability it does not recognise, owner included', async () => {
    // THE UNION IS A TYPE, AND TYPES ARE ERASED. The capability is interpolated
    // into SQL as a column name, and it was protected only by every call site
    // happening to pass a literal — a property of the wiring, not of the
    // function, and the function is one call site away from being reachable
    // with a request-supplied string. `push.ts` carries the identical shape and
    // was given a runtime lookup for exactly this reason; this is the authority
    // check, so it is the last place that should rely on a type.
    for (const hostile of [
      'can_view_decisions, (SELECT 1)', '*', '1', 'rowid',
      "can_view_decisions' OR '1'='1", 'nonexistent_capability',
    ] as unknown as Parameters<typeof memberMay>[2][]) {
      expect(await memberMay(P, COFOUNDER, hostile), `${hostile} must be refused`).toBe(false);
      // Checked BEFORE the ownership shortcut, so an unknown capability cannot
      // be answered `true` just because the asker owns the company.
      expect(await memberMay(P, OWNER, hostile), `${hostile} must be refused for the owner too`)
        .toBe(false);
    }
    // And the real ones still work, so this is a narrowing and not a wall.
    expect(await memberMay(P, OWNER, 'can_manage_company')).toBe(true);
  });

  it('refuses a member whose access was withdrawn', async () => {
    await query(
      `UPDATE team_members SET status = 'removed' WHERE founder_id = ?`, [COFOUNDER]);
    expect(await memberMay(P, COFOUNDER, 'can_vote_decisions')).toBe(false);
  });

  it('refuses a member of another company', async () => {
    // Owned by nobody this file otherwise uses, so the "sees nothing" case
    // below stays about a person with no companies at all.
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES ('mc_third','ck_third','third@test.local')`);
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('mc_other','Other','mc_third')`);
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
// THERE WAS A SECOND AUTHORIZATION SYSTEM. THERE ISN'T NOW.
//
// `account_roles` held a viewer/analyst/admin/owner ladder that `requireRole`
// read, and `assignRole` — its only writer — had no callers anywhere. No row
// was ever created, so `getUserRole` always returned null and
// `requireRole('admin')` reduced to the owner check inside it: seventeen routes
// that read as "an admin may do this" were owner-only in practice, and an
// accepted co-founder could reach none of them. Meanwhile `team_members` — what
// the invite flow actually writes — carried the real permissions and nothing
// consulted them. Two models, and the guards were reading the empty one.
//
// Owner decision: company membership is canonical, ownership is a distinct and
// stronger property, and a role label grants nothing by itself. Migration 152
// drops both dead tables.
// =============================================================================

describe('membership is the company authorization model', () => {
  it('an accepted member can see the company', async () => {
    const { getVisibleProducts } = await import('../../src/db/client.js');
    const seen = (await getVisibleProducts(COFOUNDER)).rows
      .map((r) => (r as Record<string, unknown>).id);
    expect(seen, 'the dashboard listed by owner_id, so an invited member saw nothing')
      .toContain(P);
  });

  it('an observer can see the company too — visibility is not capability', async () => {
    const { getVisibleProducts } = await import('../../src/db/client.js');
    const seen = (await getVisibleProducts(OBSERVER)).rows
      .map((r) => (r as Record<string, unknown>).id);
    expect(seen).toContain(P);
    expect(await memberMay(P, OBSERVER, 'can_vote_decisions'),
      'seeing the company is where the question starts').toBe(false);
  });

  it('the owner still sees their own company', async () => {
    const { getVisibleProducts } = await import('../../src/db/client.js');
    expect((await getVisibleProducts(OWNER)).rows.map((r) => (r as Record<string, unknown>).id))
      .toContain(P);
  });

  it('an unrelated person sees nothing', async () => {
    const { getVisibleProducts } = await import('../../src/db/client.js');
    expect((await getVisibleProducts(STRANGER)).rows.length).toBe(0);
  });

  it('a member of one company does not gain another', async () => {
    // Owned by the OWNER, not the stranger — the stranger must stay a person
    // with no companies at all, which the test above depends on.
    await query(
      `INSERT OR IGNORE INTO products (id, name, owner_id) VALUES ('mc_b','Company B',?)`,
      [OWNER]);
    const { getVisibleProducts } = await import('../../src/db/client.js');
    const seen = (await getVisibleProducts(COFOUNDER)).rows
      .map((r) => (r as Record<string, unknown>).id);
    expect(seen).toContain(P);
    expect(seen, 'membership is of ONE company').not.toContain('mc_b');
  });

  it('a removed member stops seeing it', async () => {
    await query(`UPDATE team_members SET status = 'removed' WHERE founder_id = ?`, [COFOUNDER]);
    const { getVisibleProducts } = await import('../../src/db/client.js');
    expect((await getVisibleProducts(COFOUNDER)).rows.length).toBe(0);
  });

  it('an archived company disappears from everyone', async () => {
    await query(`UPDATE products SET status = 'archived' WHERE id = ?`, [P]);
    const { getVisibleProducts } = await import('../../src/db/client.js');
    const ids = async (f: string) => (await getVisibleProducts(f)).rows
      .map((r) => (r as Record<string, unknown>).id);
    expect(await ids(OWNER), 'archived is gone for the owner too').not.toContain(P);
    expect(await ids(COFOUNDER)).not.toContain(P);
    await query(`UPDATE products SET status = 'active' WHERE id = ?`, [P]);
  });
});

describe('ownership is not the top of the ladder', () => {
  it('is a separate question with its own answer', async () => {
    const { isCompanyOwner } = await import('../../src/services/team/members.js');
    expect(await isCompanyOwner(P, OWNER)).toBe(true);
    expect(await isCompanyOwner(P, COFOUNDER),
      'a co-founder who may manage the company still does not own it').toBe(false);
  });

  it('is not conferred by any capability, however many a member holds', async () => {
    const { isCompanyOwner } = await import('../../src/services/team/members.js');
    await query(
      `UPDATE team_members SET can_view_decisions=1, can_vote_decisions=1,
         can_view_financials=1, can_view_audit=1, can_trigger_actions=1,
         can_manage_company=1 WHERE founder_id = ?`, [COFOUNDER]);
    expect(await memberMay(P, COFOUNDER, 'can_manage_company')).toBe(true);
    expect(await isCompanyOwner(P, COFOUNDER)).toBe(false);
  });
});

describe('the duplicate model is gone', () => {
  it('has no table left to read', async () => {
    await expect(query('SELECT 1 FROM account_roles LIMIT 1')).rejects.toThrow();
    await expect(query('SELECT 1 FROM role_permissions LIMIT 1')).rejects.toThrow();
  });

  it('and no guard reads a role label', () => {
    // The label is product shorthand. If a guard starts branching on it, this
    // is two authorization models again.
    const rbac = readFileSync(
      resolve(__dirname, '../../src/middleware/rbac.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    for (const label of ['co_founder', 'advisor', 'investor_observer', 'analyst', 'viewer']) {
      expect(rbac, `a guard branching on '${label}' is a role granting authority`)
        .not.toContain(label);
    }
  });
});

// =============================================================================
// THE VOTES THAT WERE ALREADY CAST.
//
// Refusing new votes at the route stops the intake. It does not clean what the
// intake already accepted, and `computeAlignmentScore` reads thirty days back.
//
// The rows stay. What happened is evidence, and deleting it would fabricate a
// history in which it did not. What changes is that the CURRENT canonical
// alignment counts only votes whose caster is entitled to vote today — which
// is the same rule read forwards, and also handles a member since removed or
// since restricted.
// =============================================================================

describe('alignment counts only votes their caster may cast', () => {
  const DECISION = 'mc_decision';

  beforeEach(async () => {
    await query('DELETE FROM decision_votes');
    await query('DELETE FROM decisions');
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status)
       VALUES (?, ?, 'raise prices', 'now', 'strategic', 1, 'pending')`, [DECISION, P]);
  });

  async function vote(founderId: string, choice: 'approve' | 'reject'): Promise<void> {
    await query(
      `INSERT INTO decision_votes (id, decision_id, product_id, founder_id, vote, preferred_option)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`v_${founderId}`, DECISION, P, founderId, choice, choice]);
  }

  it('counts the owner and a member who may vote', async () => {
    const { computeAlignmentScore } = await import('../../src/services/team/members.js');
    await vote(OWNER, 'approve');
    await vote(COFOUNDER, 'approve');
    const snapshot = await computeAlignmentScore(P);
    expect(snapshot, 'two entitled voters agreeing is an alignment signal').not.toBeNull();
  });

  it('does not count a vote from a member who may not', async () => {
    // The historical defect, cast directly into the table the way it happened.
    const { computeAlignmentScore } = await import('../../src/services/team/members.js');
    await vote(OWNER, 'approve');
    await vote(OBSERVER, 'reject');

    const snapshot = await computeAlignmentScore(P);
    // One entitled vote is not a disagreement; the observer's 'b' must not
    // create one.
    expect(snapshot?.divergence_areas ?? [],
      'an observer’s vote must not read as the team disagreeing').toEqual([]);
  });

  it('stops counting a member since removed', async () => {
    const { computeAlignmentScore } = await import('../../src/services/team/members.js');
    await vote(OWNER, 'approve');
    await vote(COFOUNDER, 'reject');
    const before = await computeAlignmentScore(P);
    expect(before?.divergence_areas.length ?? 0).toBeGreaterThan(0);

    await query(`UPDATE team_members SET status = 'removed' WHERE founder_id = ?`, [COFOUNDER]);
    const after = await computeAlignmentScore(P);
    expect(after?.divergence_areas ?? [],
      'entitlement is read as of now, not as of the vote').toEqual([]);
  });

  it('leaves the row where it is', async () => {
    // Evidence of what happened. Excluding it from a derived score is not the
    // same as pretending it never occurred.
    await vote(OBSERVER, 'reject');
    const { computeAlignmentScore } = await import('../../src/services/team/members.js');
    await computeAlignmentScore(P);
    const rows = await query('SELECT COUNT(*) AS n FROM decision_votes WHERE founder_id = ?', [OBSERVER]);
    expect(Number((rows.rows[0] as Record<string, unknown>).n)).toBe(1);
  });
});
