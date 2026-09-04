process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  proposeAct, setBoundary, whatIsBeingAskedOf,
} from '../../src/services/institution/standing-intent.js';

// =============================================================================
// HIS OWN COMPANY OUTRANKS MY HOUSEKEEPING.
//
// The first screen ranked what needs him by KIND — a hardcoded if-chain over
// seven types, with a question about one of his actual businesses last, behind
// Foundry looking after itself. And it never read `proposed_acts` at all: they
// were rendered in exactly one place, inside a company's own page. So on the
// day an asset asked him for $400, the home screen would have shown him a
// schema-snapshot permission instead.
//
// Ranking is by CONSEQUENCE: the rung first, because what an act commits him to
// matters more than what it costs, then the money, then what expires soonest so
// a question does not lapse because a cheaper one was asked first.
// =============================================================================

const OWNER = 'ask_owner';
const OTHER = 'ask_other';

beforeAll(async () => {
  await runMigrations();
  for (const [id, clerk, email] of [
    [OWNER, 'clerk_ask', 'owner@example.com'],
    [OTHER, 'clerk_other', 'other@example.com'],
  ]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [id, clerk, email, 'Somebody']);
  }
  await query(
    `INSERT INTO products (id, name, owner_id, status, reality)
     VALUES ('c_real','Ashford',?,'active','real')`, [OWNER]);
  await query(
    `INSERT INTO products (id, name, owner_id, status, reality)
     VALUES ('c_rehearsal','Rehearsal',?,'active','reference')`, [OWNER]);
  await query(
    `INSERT INTO products (id, name, owner_id, status, reality)
     VALUES ('c_theirs','Not his',?,'active','real')`, [OTHER]);

  // A PROPOSAL WITHOUT A STANDING ASK-FIRST IS NOISE — the database refuses to
  // let Foundry manufacture a question he never asked to be consulted about.
  for (const [subject, product] of [
    ['commit_on_my_behalf', 'c_real'], ['spend_money', 'c_real'], ['publish', 'c_real'],
    ['commit_on_my_behalf', 'c_rehearsal'], ['commit_on_my_behalf', 'c_theirs'],
  ]) {
    await setBoundary({ productId: product, subject,
      statement: `ask me first before you ${subject}`, mode: 'ask_first' });
  }

  const base = {
    actionType: 'do_a_thing', params: { a: 1 }, expectedEffect: 'something', risk: 'some',
    consequence: 'medium' as const, proposedBy: 'institution',
  };
  // Cheap, but commits him to something that cannot be undone.
  await proposeAct({ ...base, productId: 'c_real', subject: 'commit_on_my_behalf',
    summary: 'Accept the marketplace terms', why: 'to list the app',
    rung: 'legal', costCents: 0 });
  // Expensive, and merely money.
  await proposeAct({ ...base, productId: 'c_real', subject: 'spend_money',
    summary: 'Renew the domain for three years', why: 'it lapses',
    rung: 'financial', costCents: 9000 });
  await proposeAct({ ...base, productId: 'c_real', subject: 'publish',
    summary: 'Publish the changed pricing page', why: 'the price changed',
    rung: 'public', costCents: 0 });
  // A rehearsal may not ask him for anything, and neither may somebody else's.
  await proposeAct({ ...base, productId: 'c_rehearsal', subject: 'commit_on_my_behalf',
    summary: 'A rehearsed ask', why: 'rehearsal', rung: 'legal', costCents: 500000 });
  await proposeAct({ ...base, productId: 'c_theirs', subject: 'commit_on_my_behalf',
    summary: 'Somebody else\'s ask', why: 'theirs', rung: 'legal', costCents: 500000 });
});

describe('what the portfolio is asking of him', () => {
  it('reads his companies at all, which the first screen never did', async () => {
    const asked = await whatIsBeingAskedOf(OWNER);
    expect(asked.length).toBe(3);
    expect(asked.every((a) => a.companyName === 'Ashford')).toBe(true);
  });

  it('ranks by what it commits him to, not by what it costs', async () => {
    const asked = await whatIsBeingAskedOf(OWNER);
    // $0 and irreversible comes before $90 and merely money.
    expect(asked[0]?.summary).toBe('Accept the marketplace terms');
    expect(asked[0]?.rung).toBe('legal');
    expect(asked[0]?.absorbable).toBe(false);
    expect(asked[1]?.rung).toBe('financial');
    expect(asked[2]?.rung).toBe('public');
  });

  it('carries what it would take to put it back', async () => {
    const asked = await whatIsBeingAskedOf(OWNER);
    expect(asked[0]?.puttingItBack).toBeTruthy();
    expect(asked[0]?.rungMeans).toBeTruthy();
  });

  it('refuses to let a rehearsal ask him for anything', async () => {
    const asked = await whatIsBeingAskedOf(OWNER);
    expect(asked.map((a) => a.summary)).not.toContain('A rehearsed ask');
  });

  it('never shows him somebody else\'s company', async () => {
    const asked = await whatIsBeingAskedOf(OWNER);
    expect(asked.map((a) => a.productId)).not.toContain('c_theirs');
    expect((await whatIsBeingAskedOf(OTHER)).map((a) => a.productId)).toEqual(['c_theirs']);
  });
});
