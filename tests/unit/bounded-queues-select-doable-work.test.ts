// =============================================================================
// Tests: a bounded queue that selects work it cannot do stops being a queue.
//
// `redTeamSweep` takes the five OLDEST uncontested gate-3 decisions and runs a
// pre-mortem on each. The pre-mortem spends money, so the AI client refuses it
// for a company that is paused, unpaid or being erased — and the
// `red_team_reviews` row that marks a decision as handled is written only
// AFTER that call returns. The refusal therefore left no trace at all: the
// decision stayed uncontested, the NOT EXISTS stayed true, and `ORDER BY
// created_at ASC LIMIT 5` picked the same five rows on the next run.
//
// Five old decisions belonging to companies Foundry may not act for were
// enough to occupy the whole window forever. No operating company's decision
// would ever be red-teamed again, and nothing would have said so: each run
// logged five per-decision errors and reported itself complete, while the
// promise the sweep exists to keep — "no gate-3+ decision sits uncontested" —
// was false for every company at once.
//
// This is the cheap local precondition that belongs BEFORE the paid call, not
// after it. Same shape in `scenarioAccuracy`, fixed the same way.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { pendingRedTeamWork } from '../../src/jobs/index.js';

const OWNER = 'bq_owner';
const LIVE = 'bq_live';

/** A company Foundry cannot spend for, one per axis that stops it. */
const STOPPED: Array<{ id: string; set: string }> = [
  { id: 'bq_paused', set: "scp_status = 'paused'" },
  { id: 'bq_unpaid', set: "entitlement_paused_at = datetime('now')" },
  { id: 'bq_erasing', set: "erasure_scheduled_at = datetime('now')" },
  { id: 'bq_archived', set: "status = 'archived'" },
];

async function addDecision(
  id: string, productId: string, createdAt: string,
): Promise<void> {
  await query(
    `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status, created_at)
     VALUES (?, ?, 'A weighty thing', 'Now', 'strategic', 3, 'pending', ?)`,
    [id, productId, createdAt]);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_bq', 'bq@test.local']);
});

beforeEach(async () => {
  await query(`DELETE FROM red_team_reviews`);
  await query(`DELETE FROM decisions`);
  await query(`DELETE FROM products WHERE owner_id = ?`, [OWNER]);
  for (const id of [LIVE, ...STOPPED.map((s) => s.id)]) {
    await query(
      `INSERT INTO products (id, name, owner_id, status, scp_status)
       VALUES (?, 'Co', ?, 'active', 'active')`, [id, OWNER]);
  }
});

describe('the red team sweep picks work it can actually do', () => {
  it('is not starved by older decisions belonging to companies it may not spend for', async () => {
    // Five stopped decisions, all older than the live one — exactly the shape
    // that filled the window. Five is the whole bound.
    let n = 0;
    for (const s of STOPPED) {
      await query(`UPDATE products SET ${s.set} WHERE id = ?`, [s.id]);
      await addDecision(`bq_old_${n}`, s.id, `2020-01-0${++n} 00:00:00`);
    }
    await addDecision('bq_old_5', STOPPED[0].id, '2020-01-05 00:00:00');
    // And the one decision that can actually be reviewed, newest of all.
    await addDecision('bq_live_decision', LIVE, '2024-06-01 00:00:00');

    const work = await pendingRedTeamWork();

    expect(work.map((w) => w.id),
      'the five oldest belong to companies the pre-mortem cannot be run for, and they never clear')
      .toEqual(['bq_live_decision']);
  });

  it('excludes a company on every axis that stops Foundry spending', async () => {
    // Not just "paused". A pre-mortem is refused for an archived company, an
    // unpaid one and one being erased too, and each of those left the same
    // permanent row behind.
    let n = 0;
    for (const s of STOPPED) {
      await query(`UPDATE products SET ${s.set} WHERE id = ?`, [s.id]);
      await addDecision(`bq_d_${n++}`, s.id, '2021-01-01 00:00:00');
    }
    expect(await pendingRedTeamWork()).toEqual([]);
  });

  it('still reviews an operating company\'s oldest decision first', async () => {
    // The fix must not change what the sweep is FOR: oldest uncontested first,
    // among the work it can do.
    await addDecision('bq_newer', LIVE, '2024-06-02 00:00:00');
    await addDecision('bq_older', LIVE, '2024-06-01 00:00:00');
    expect((await pendingRedTeamWork()).map((w) => w.id)).toEqual(['bq_older', 'bq_newer']);
  });

  it('stops selecting a decision once it has been contested', async () => {
    await addDecision('bq_done', LIVE, '2024-06-01 00:00:00');
    expect(await pendingRedTeamWork()).toHaveLength(1);
    await query(
      `INSERT INTO red_team_reviews (id, product_id, decision_id, verdict, strongest_objection, objections_json, confidence)
       VALUES ('bq_rev', ?, 'bq_done', 'proceed', 'none', '[]', 0.8)`, [LIVE]);
    expect(await pendingRedTeamWork(),
      'the review row is what marks a decision handled; without it nothing does')
      .toEqual([]);
  });

  it('never returns more than the cost bound', async () => {
    for (let i = 0; i < 9; i++) await addDecision(`bq_many_${i}`, LIVE, `2024-06-0${i + 1} 00:00:00`);
    expect((await pendingRedTeamWork()).length).toBe(5);
  });
});
