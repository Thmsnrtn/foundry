// =============================================================================
// Tests: the weekly report told the founder nothing had lapsed
//
// `decisions.status` has permitted 'expired' since migration 001, the
// DecisionStatus type declares it, and the weekly outcome report tells the
// founder how many decisions expired unacted this week:
//
//   SELECT COUNT(*) FROM decisions WHERE status = 'expired' AND created_at >= ?
//
// Nothing has ever written that value. So the number was structurally zero —
// "you let nothing lapse" — however many decisions had sat past their deadline.
// And those decisions stayed `pending` in the queue forever, indistinguishable
// from ones still worth making.
//
// The `deadline` column is real and is set. This is the producing half that was
// never built, and its absence did not merely leave a feature missing: it made
// a report say something false about the founder's own week.
//
// ONLY DECISIONS THAT CARRY A DEADLINE EXPIRE. A decision with no deadline is
// not late, it is unscheduled, and sweeping those would silently clear the
// queue of everything the founder simply has not got to yet.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

const OWNER = 'de_owner';
const P = 'de_product';

async function decision(opts: {
  deadline?: string | null; status?: string; deleted?: boolean;
} = {}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status, deadline, deleted_at)
     VALUES (?, ?, 'Ship it', 'Now', 'strategic', 1, ?, ?, ?)`,
    [id, P, opts.status ?? 'pending', opts.deadline ?? null,
      opts.deleted ? new Date().toISOString() : null]);
  return id;
}

const statusOf = async (id: string): Promise<string> => String(((await query(
  'SELECT status FROM decisions WHERE id = ?', [id])).rows[0] as Record<string, unknown>).status);

const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_de', 'de@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Expiry Co', ?, 'active', 'active')`, [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM decisions WHERE product_id = ?', [P]);
});

async function sweep(): Promise<void> {
  await JOB_REGISTRY.scp_expire_overdue_decisions.fn();
}

describe('a decision past its deadline expires', () => {
  it('expires one that is overdue', async () => {
    const id = await decision({ deadline: yesterday });
    await sweep();
    expect(await statusOf(id)).toBe('expired');
  });

  it('leaves one whose deadline has not arrived', async () => {
    const id = await decision({ deadline: tomorrow });
    await sweep();
    expect(await statusOf(id)).toBe('pending');
  });

  it('leaves one with no deadline at all', async () => {
    // Unscheduled is not late. Sweeping these would clear the queue of
    // everything the founder simply has not got to yet.
    const id = await decision({ deadline: null });
    await sweep();
    expect(await statusOf(id)).toBe('pending');
  });

  it('does not touch a decision that was already decided', async () => {
    const id = await decision({ deadline: yesterday, status: 'approved' });
    await sweep();
    expect(await statusOf(id), 'expiry is for what was never answered').toBe('approved');
  });

  it('does not resurrect a deleted decision', async () => {
    const id = await decision({ deadline: yesterday, deleted: true });
    await sweep();
    expect(await statusOf(id)).toBe('pending');
  });
});

describe('and the weekly report can finally say so', () => {
  it('counts the lapse it used to report as zero', async () => {
    const { computeWeeklyOutcome } = await import(
      '../../src/services/intelligence/weekly-outcome.js');
    await decision({ deadline: yesterday });
    await decision({ deadline: yesterday });

    const before = await computeWeeklyOutcome(P);
    expect(before.expired_7d, 'structurally zero before anything wrote the value').toBe(0);

    await sweep();
    const after = await computeWeeklyOutcome(P);
    expect(after.expired_7d).toBe(2);
  });
});

describe('the sweep is scheduled', () => {
  it('is registered as a job, not merely defined', () => {
    // The GDPR erasure this campaign deleted was a function nobody called and
    // nothing scheduled. A sweep that is written and never run reports the same
    // zero it was built to fix.
    expect(JOB_REGISTRY.scp_expire_overdue_decisions).toBeTruthy();
    expect(JOB_REGISTRY.scp_expire_overdue_decisions.schedule).toMatch(/\S/);
  });
});
