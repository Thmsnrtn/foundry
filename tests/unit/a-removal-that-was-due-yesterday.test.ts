process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { pendingDeletion } from '../../src/services/privacy/consent.js';

// =============================================================================
// A REMOVAL THAT WAS DUE YESTERDAY.
//
// The Letter says "<Company> and everything in it will be removed on <date>" and
// the privacy page says the same. Neither compared that date to today — so when
// `data_deletion_processor` stops, the sentence goes on promising a removal in
// the future about a day that has passed.
//
// That job is one of thirty-nine, and the "part of me has stopped" card watches
// two. Its own handler already logs a failed erasure, which is a log; the
// founder is told nothing. An erasure has a clock running on it, and the person
// who asked for it is the one who needs to know it did not happen.
//
// A FACT, NOT A DIAGNOSIS. Nothing here knows WHY: the job may have stopped, or
// failed on this company, or be minutes from its next run. What is knowable is
// that the day has passed and no completion is recorded.
// =============================================================================

const P = 'rem_product';
const OWNER = 'rem_owner';

/** Schedule a deletion the way `scheduleDeletion` records one. */
async function scheduleAt(scheduledAt: string, days: number): Promise<void> {
  await query(
    `INSERT INTO agent_audit_log
       (id,product_id,event_type,target_id,actor_id,actor_type,description,metadata_json,created_at)
     VALUES (?,?,'data_deletion_scheduled',?,?,'founder','scheduled',?,?)`,
    ['rem_evt', P, P, OWNER, JSON.stringify({ scheduled_at: scheduledAt, delete_after_days: days }), scheduledAt]);
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)', [OWNER, 'rem_c', 'o@test.local']);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [P, 'Leaving Co', OWNER]);
});

beforeEach(async () => {
  await query("DELETE FROM agent_audit_log WHERE target_id = ?", [P]);
});

describe('a deletion whose day has not come', () => {
  it('is not overdue', async () => {
    await scheduleAt(new Date().toISOString(), 30);
    const pending = await pendingDeletion(P);
    expect(pending).toBeTruthy();
    expect(pending!.overdue).toBe(false);
  });
});

describe('a deletion whose day has passed', () => {
  it('says so, rather than promising it in the future', async () => {
    // Scheduled 40 days ago with a 30-day window: due 10 days ago.
    await scheduleAt(new Date(Date.now() - 40 * 86_400_000).toISOString(), 30);
    const pending = await pendingDeletion(P);
    expect(pending!.overdue).toBe(true);
  });

  it('stops saying so the moment the erasure is recorded', async () => {
    await scheduleAt(new Date(Date.now() - 40 * 86_400_000).toISOString(), 30);
    await query(
      `INSERT INTO agent_audit_log
         (id,product_id,event_type,target_id,actor_id,actor_type,description,metadata_json)
       VALUES ('rem_done',?,'data_deletion_completed',?,?,'system','completed','{}')`, [P, P, OWNER]);
    // Completed erasures return null entirely — there is nothing pending to be
    // overdue about.
    expect(await pendingDeletion(P)).toBeNull();
  });

  it('is judged against a clock the caller can supply, not only the wall', async () => {
    await scheduleAt('2026-01-01T00:00:00.000Z', 30);
    expect((await pendingDeletion(P, new Date('2026-01-15T00:00:00.000Z')))!.overdue).toBe(false);
    expect((await pendingDeletion(P, new Date('2026-03-01T00:00:00.000Z')))!.overdue).toBe(true);
  });
});
