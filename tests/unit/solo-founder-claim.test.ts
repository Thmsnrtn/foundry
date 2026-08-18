// =============================================================================
// Tests: every founder read as solo, and was told so
//
// `detectIsolationDrift` decides whether a founder is building alone before it
// says anything, and it decided by counting `cofounder_profiles` — a table
// nothing anywhere writes. No INSERT in the codebase, no trigger, no migration
// seed. The count was always zero, so EVERY founder read as solo, including one
// running a company with three co-founders.
//
// This is not a dead feature. It is a live one giving a wrong answer, and the
// wrong answer is a sentence addressed to the founder about their own company:
// "As a solo founder, your engagement has been declining." Delivered, by
// design, at the moment they are least able to shrug it off.
//
// The real record of who is in a company is `team_members` — the canonical
// membership model, the one the invite flow writes and every permission check
// reads. `co_founder` is the role label the invite form offers for a second
// founder. Advisors and investor observers are deliberately NOT counted: the
// thing being detected is building ALONE, not having nobody to talk to.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { detectIsolationDrift } from '../../src/services/intelligence/psychology.js';

const OWNER = 'sf_owner';
const P = 'sf_product';

async function member(role: string, status = 'active'): Promise<string> {
  const id = nanoid();
  const founderId = `sf_m_${id}`;
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`]);
  await query(
    `INSERT INTO team_members (id, product_id, founder_id, role, status, can_view_decisions)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [id, P, founderId, role, status]);
  return id;
}

/** The founder is disengaged, so the insight fires — if they are solo. */
async function disengaged(): Promise<void> {
  await query(`DELETE FROM founder_health WHERE founder_id = ?`, [OWNER]);
  await query(
    `INSERT INTO founder_health (id, founder_id, engagement_trend, motivation_score)
     VALUES (?, ?, 'declining', 20)`, [nanoid(), OWNER]);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_sf', 'sf@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Solo Co', ?, 'active')`,
    [P, OWNER]);
});

beforeEach(async () => {
  await query(`DELETE FROM team_members WHERE product_id = ?`, [P]);
  await disengaged();
});

describe('the solo claim is checked against who is actually here', () => {
  it('says it to a founder who really is alone', async () => {
    const insight = await detectIsolationDrift(OWNER, P);
    expect(insight).not.toBeNull();
    expect(insight!.description).toContain('solo founder');
  });

  it('does not say it to a founder with a co-founder', async () => {
    await member('co_founder');
    expect(await detectIsolationDrift(OWNER, P),
      'telling someone with a co-founder they are building alone is a false '
      + 'statement about their own company').toBeNull();
  });

  it('still says it when the only other member is an advisor', async () => {
    // Building alone is not the same as having nobody to talk to. An advisor
    // and an investor observer are not co-founders, and counting them would
    // silence the insight for exactly the founders it exists for.
    await member('advisor');
    await member('investor_observer');
    expect(await detectIsolationDrift(OWNER, P)).not.toBeNull();
  });

  it('does not count a co-founder who has left', async () => {
    // `team_members.status` is active / inactive / removed. Membership that is
    // not active is not a person in the room, which is the same rule every
    // permission check applies.
    await member('co_founder', 'removed');
    await member('co_founder', 'inactive');
    expect(await detectIsolationDrift(OWNER, P)).not.toBeNull();
  });

  it('does not read a table nothing writes', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL('../../src/services/intelligence/psychology.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(src).not.toMatch(/FROM cofounder_profiles/);
  });
});
