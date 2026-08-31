// =============================================================================
// Tests: account deletion via the identity provider has never worked
//
// The Clerk `user.deleted` webhook did this:
//
//   for each product of the founder:
//     DELETE FROM products WHERE id = ?
//   DELETE FROM founders WHERE id = ?
//
// Two things were wrong with it, and the first meant the second never got a
// chance.
//
// IT RAISES. Seven foreign keys into products' descendants are ON DELETE NO
// ACTION and this database runs with foreign_keys=ON, so deleting a company
// that has ever had a chat message fails outright. Account deletion has never
// completed for a real company, and left no record of having been attempted —
// the same defect the erasure path itself had, in a second door that nobody
// had looked at.
//
// AND IT BYPASSED EVERYTHING ERASURE KNOWS. No ordering, no retention
// dispositions, no completion record. Had it succeeded it would have deleted
// the evidence that the erasure happened, the financial records that must
// survive it, and the idempotency keys that stop a retry re-sending a real
// message to a real customer.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { eraseFounderAccount } from '../../src/services/privacy/consent.js';

const F = 'fae_founder';
const OTHER = 'fae_other';
const P1 = 'fae_p1';
const P2 = 'fae_p2';
const THEIRS = 'fae_theirs';

async function seed(): Promise<void> {
  await query('DELETE FROM chat_messages');
  await query('DELETE FROM chat_sessions');
  await query('DELETE FROM agent_audit_log');
  for (const [f, clerk] of [[F, 'ck_fae'], [OTHER, 'ck_other']]) {
    await query(
      `INSERT OR REPLACE INTO founders (id, clerk_user_id, email, name)
       VALUES (?, ?, ?, 'Ada')`, [f, clerk, `${f}@test.local`]);
  }
  for (const [p, owner] of [[P1, F], [P2, F], [THEIRS, OTHER]]) {
    await query(
      `INSERT OR REPLACE INTO products (id, name, owner_id, status, scp_status)
       VALUES (?, ?, ?, 'active', 'active')`, [p, `Co ${p}`, owner]);
  }
  // The exact shape that made the hand-written delete raise: one chat session
  // with one message, whose foreign key does not cascade.
  for (const p of [P1, THEIRS]) {
    const session = nanoid();
    await query(`INSERT INTO chat_sessions (id, product_id, founder_id) VALUES (?,?,?)`,
      [session, p, p === THEIRS ? OTHER : F]);
    await query(
      `INSERT INTO chat_messages (id, session_id, role, content)
       VALUES (?, ?, 'founder', 'our churn is up')`, [nanoid(), session]);
  }
}

beforeAll(async () => { await runMigrations(); });
beforeEach(seed);

describe('the hand-written delete could not have worked', () => {
  it('raises on a company that has ever had a chat message', async () => {
    // Kept as the reason this exists. The children do not cascade.
    await expect(query('DELETE FROM products WHERE id = ?', [P1])).rejects.toThrow();
  });
});

describe('erasing the account', () => {
  it('erases every company the founder owns', async () => {
    const outcome = await eraseFounderAccount(F);
    expect(outcome.failed).toEqual([]);
    expect(outcome.productsErased.sort()).toEqual([P1, P2]);

    for (const p of [P1, P2]) {
      const row = (await query('SELECT name, status FROM products WHERE id = ?', [p]))
        .rows[0] as Record<string, unknown>;
      expect(row.status, 'archived, not deleted — the id must not be reissued')
        .toBe('archived');
      expect(row.name).toBe('[erased]');
    }
    const left = await query('SELECT COUNT(*) AS n FROM chat_messages');
    expect(Number((left.rows[0] as Record<string, unknown>).n),
      'the founder’s own words go with the company').toBe(1);   // the other founder's
  });

  it('leaves the evidence that it happened', async () => {
    await eraseFounderAccount(F);
    const done = await query(
      `SELECT COUNT(*) AS n FROM agent_audit_log WHERE event_type = 'data_deletion_completed'`);
    expect(Number((done.rows[0] as Record<string, unknown>).n),
      'a compliance path that leaves no evidence of having run is worse than one that fails')
      .toBe(2);
  });

  it('removes the person, and keeps the shell that foreign keys resolve to', async () => {
    await eraseFounderAccount(F);
    const row = (await query(
      'SELECT email, name, clerk_user_id, stripe_customer_id FROM founders WHERE id = ?', [F]))
      .rows[0] as Record<string, unknown>;
    expect(row, 'the row survives so retained financial records stay resolvable')
      .toBeDefined();
    expect(String(row.email)).not.toContain('test.local');
    expect(row.name).toBeNull();
    expect(String(row.clerk_user_id),
      'the identity-provider handle is how this person could be recognised again')
      .not.toBe('ck_fae');
  });

  it('touches nobody else', async () => {
    await eraseFounderAccount(F);
    const other = (await query('SELECT email, name FROM founders WHERE id = ?', [OTHER]))
      .rows[0] as Record<string, unknown>;
    expect(String(other.email)).toContain('test.local');
    expect(other.name).toBe('Ada');
    const theirs = (await query('SELECT name, status FROM products WHERE id = ?', [THEIRS]))
      .rows[0] as Record<string, unknown>;
    expect(theirs.name).toBe(`Co ${THEIRS}`);
    expect(theirs.status).toBe('active');
  });

  it('does not clear the person while a company of theirs is still standing', async () => {
    // A founder row cleared while a company still names them is a company with
    // no reachable owner.
    await query(`
      CREATE TRIGGER fae_refuse BEFORE DELETE ON customer_intelligence
      BEGIN SELECT RAISE(ABORT, 'test:refuses'); END`);
    await query(
      `INSERT INTO customer_intelligence (id, product_id, external_customer_id)
       VALUES (?, ?, 'someone')`, [nanoid(), P1]);
    try {
      const outcome = await eraseFounderAccount(F);
      expect(outcome.failed.map((f) => f.productId)).toEqual([P1]);
      expect(outcome.founderRedacted).toBe(false);

      const row = (await query('SELECT email FROM founders WHERE id = ?', [F]))
        .rows[0] as Record<string, unknown>;
      expect(String(row.email)).toContain('test.local');
    } finally {
      await query('DROP TRIGGER fae_refuse');
    }
  });

  it('converges when run again', async () => {
    await eraseFounderAccount(F);
    const second = await eraseFounderAccount(F);
    expect(second.failed).toEqual([]);
    expect(second.founderRedacted).toBe(true);
  });
});
