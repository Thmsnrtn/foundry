process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { acceptInvitation, inviteTeamMember, memberMay } from '../../src/services/team/members.js';

// =============================================================================
// A COLUMN A MIGRATION BACKFILLED AND THE INVITE NEVER LEARNED ABOUT.
//
// Migration 151 added `can_manage_company` with DEFAULT FALSE and backfilled it
// from the role label, saying plainly what it was for: "Those routes are not
// owner-only work. They are ordinary company management: issue an API key,
// connect a sending address, rotate an ingest credential, toggle the wisdom
// network, invite a colleague. A co-founder should be able to do them; an
// advisor or an investor observer should not."
//
// `acceptInvitation` was never updated. Every member who joined after that
// migration ran got the default, so an invited co-founder was permanently
// denied the ~25 routes it gates — including `assisting-admission`, the door
// where a company grants Foundry permission to help at all.
//
// It stayed invisible because `memberMay` short-circuits true for the owner,
// and the owner is who tries things.
// =============================================================================

const OWNER = 'inv_owner';
const P = 'inv_product';

async function joins(founderId: string, role: 'co_founder' | 'advisor' | 'investor_observer'): Promise<void> {
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`]);
  const inv = await inviteTeamMember(P, OWNER, `${founderId}@test.local`, role);
  await acceptInvitation(inv.token, founderId);
}

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  await query('DELETE FROM team_members WHERE product_id=?', [P]);
  await query('DELETE FROM team_invitations WHERE product_id=?', [P]);
  await query('DELETE FROM products WHERE id=?', [P]);
  await query("DELETE FROM founders WHERE id LIKE 'inv_%'");
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'clerk_inv_owner', 'owner@test.local']);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [P, 'Invited Co', OWNER]);
});

describe('a co-founder who accepted an invitation', () => {
  it('may manage the company, which is what they were invited to do', async () => {
    await joins('inv_cofounder', 'co_founder');
    expect(await memberMay(P, 'inv_cofounder', 'can_manage_company')).toBe(true);
    // The capability beside it, which the accept path already derived correctly.
    expect(await memberMay(P, 'inv_cofounder', 'can_trigger_actions')).toBe(true);
  });

  it('can reach the door where a company grants Foundry permission to help', async () => {
    await joins('inv_grant', 'co_founder');
    // `assisting-admission` asks this exact capability before recording a grant
    // and before revoking one. Denying it left an invited co-founder unable to
    // let Foundry help at all, with no message saying why.
    expect(await memberMay(P, 'inv_grant', 'can_manage_company')).toBe(true);
  });
});

describe('the people migration 151 said should not', () => {
  it('does not let an advisor or an investor observer manage the company', async () => {
    await joins('inv_advisor', 'advisor');
    await joins('inv_observer', 'investor_observer');
    expect(await memberMay(P, 'inv_advisor', 'can_manage_company')).toBe(false);
    expect(await memberMay(P, 'inv_observer', 'can_manage_company')).toBe(false);
  });

  it('still lets them see what they were invited to see', async () => {
    await joins('inv_advisor2', 'advisor');
    expect(await memberMay(P, 'inv_advisor2', 'can_view_decisions')).toBe(true);
  });
});

describe('the rule is written in two places', () => {
  it('and the accept path derives it the same way the migration backfilled it', () => {
    // One rule in two places is a defect unless something compares them. The
    // migration is the record of intent; this is the only thing that checks the
    // code still agrees with it.
    const migration = readFileSync(
      resolve(__dirname, '../../src/db/migrations/151_member_manage_capability.sql'), 'utf8');
    expect(migration).toContain("UPDATE team_members SET can_manage_company = 1 WHERE role = 'co_founder'");

    const accept = readFileSync(
      resolve(__dirname, '../../src/services/team/members.ts'), 'utf8');
    const insert = accept.slice(accept.indexOf('export async function acceptInvitation'));
    expect(insert).toContain("const isCoFounder = inv.role === 'co_founder'");
    expect(insert.slice(0, insert.indexOf('return {'))).toContain('can_manage_company');
  });

  it('gives an accepted co-founder the row the backfill would have given them', async () => {
    await joins('inv_shape', 'co_founder');
    const row = (await query(
      'SELECT role, can_manage_company FROM team_members WHERE product_id=? AND founder_id=?',
      [P, 'inv_shape'])).rows[0] as Record<string, unknown>;
    expect(row.role).toBe('co_founder');
    expect(Number(row.can_manage_company)).toBe(1);
  });
});
