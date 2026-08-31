// =============================================================================
// Tests: there is one retention policy, and it is the one that runs.
//
// There were two. `src/services/retention.ts` ran a daily job over
// `agent_messages` and `audit_log` with one global window;
// `src/services/maintenance/retention.ts` ran its own daily job over five
// tables with per-table horizons. Both deleted, and they overlapped on
// `audit_log` — where the second said 365 days ("compliance-relevant; keep
// longer") and the first deleted at 180.
//
// The shorter one wins every time. So the audit log was kept for 180 days
// while the code stating the policy said 365, and nothing in the system
// behaved the way the policy read. Two implementations of one rule, silently
// disagreeing, with the documented intent losing to the cruder job — and the
// losing record is the one that answers "why didn't you show me X?".
//
// The crude implementation is deleted. `audit_log` deliberately STAYS at 180
// rather than being restored to the 365 written down: lengthening how long
// audit data is kept is the question already with counsel
// (`OWNER_DECISIONS_PENDING` §9), and removing a duplication must not quietly
// change what happens to anybody's data.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import {
  retentionCapDays, runRetentionPolicy,
} from '../../src/services/maintenance/retention.js';

const DAY = 86_400_000;

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
  await query(
    `INSERT OR IGNORE INTO founders (id, clerk_user_id, email) VALUES ('ret_f1','clerk_ret','ret@test.local')`);
  await query(
    `INSERT OR IGNORE INTO products (id, name, owner_id) VALUES ('ret_p1','Retention Co','ret_f1')`);
});

beforeEach(async () => {
  await executeRaw('DELETE FROM agent_messages');
  await executeRaw('DELETE FROM audit_log');
  delete process.env.DATA_RETENTION_DAYS;
});

async function insert(table: string, id: string, daysAgo: number): Promise<void> {
  const ts = new Date(Date.now() - daysAgo * DAY).toISOString();
  // The real `agent_messages` carries a company, a sender, a recipient and a
  // body — all NOT NULL. The stand-in had two columns, so the retention window
  // was proved against rows the product cannot produce.
  if (table === 'agent_messages') {
    await query(
      `INSERT INTO agent_messages (id, product_id, from_agent, to_agent, type, subject, body, created_at)
       VALUES (?, 'ret_p1', 'atlas', 'oracle', 'alert', 'subject', 'body', ?)`, [id, ts]);
    return;
  }
  await query(
    `INSERT INTO audit_log (id, product_id, action_type, gate, "trigger", reasoning, input_context, output, created_at)
     VALUES (?, 'ret_p1', 'test_action', 0, 'test', 'because', '{}', '{}', ?)`, [id, ts]);
}

const deletedFor = (results: Array<{ table: string; deleted: number }>, table: string): number =>
  results.find((r) => r.table === table)?.deleted ?? 0;

describe('one policy, per-table horizons', () => {
  it('deletes past each table\'s own horizon and keeps what is inside it', async () => {
    await insert('agent_messages', 'old', 200);
    await insert('agent_messages', 'edge', 179);
    await insert('agent_messages', 'new', 5);
    await insert('audit_log', 'old-audit', 200);
    await insert('audit_log', 'new-audit', 10);

    const results = await runRetentionPolicy();
    expect(deletedFor(results, 'agent_messages')).toBe(1);
    expect(deletedFor(results, 'audit_log')).toBe(1);

    expect((await query('SELECT id FROM agent_messages ORDER BY id', [])).rows
      .map((r) => (r as Record<string, string>).id)).toEqual(['edge', 'new']);
    expect((await query('SELECT id FROM audit_log', [])).rows
      .map((r) => (r as Record<string, string>).id)).toEqual(['new-audit']);
  });

  it('keeps the audit log exactly as long as it always has', async () => {
    // The regression this guards: "tidying up" the duplication by restoring the
    // 365 written in a comment would have LENGTHENED retention of records that
    // may name people, without counsel, as a side effect of a refactor.
    await insert('audit_log', 'inside', 179);
    await insert('audit_log', 'outside', 181);
    await runRetentionPolicy();
    expect((await query('SELECT id FROM audit_log', [])).rows
      .map((r) => (r as Record<string, string>).id)).toEqual(['inside']);
  });

  it('treats DATA_RETENTION_DAYS as a ceiling, never an extension', async () => {
    // A deployment that set this did so to keep LESS. Dropping the variable
    // with the old implementation would have silently kept more.
    await insert('agent_messages', 'a', 40);
    await insert('agent_messages', 'b', 20);
    process.env.DATA_RETENTION_DAYS = '30';
    expect(retentionCapDays()).toBe(30);
    expect(deletedFor(await runRetentionPolicy(), 'agent_messages')).toBe(1);

    // And it cannot push a horizon out: a cap longer than a table's own
    // retention leaves that table's horizon where it was.
    await insert('audit_log', 'still-too-old', 200);
    process.env.DATA_RETENTION_DAYS = '3650';
    await runRetentionPolicy();
    expect((await query('SELECT id FROM audit_log', [])).rows).toHaveLength(0);
  });

  it('does not throw when a table is missing from this database', async () => {
    // AND PUTS IT BACK. The previous version of this test dropped
    // `agent_messages` and left it dropped — it got away with that by being the
    // last test in the file, which is not a property anybody should rely on.
    // The schema is captured from `sqlite_master` and replayed, because
    // re-running migrations does nothing: they are already recorded as applied.
    const created = String(((await query(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_messages'", []))
      .rows[0] as Record<string, unknown>).sql);

    await executeRaw('DROP TABLE IF EXISTS agent_messages');
    const results = await runRetentionPolicy();
    expect(deletedFor(results, 'agent_messages')).toBe(0);

    await executeRaw(created);
    expect((await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_messages'", [])).rows)
      .toHaveLength(1);
  });
});

describe('there is only one of it', () => {
  it('has no second implementation and no second job', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    expect(existsSync('src/services/retention.ts'),
      'the crude duplicate is deleted, not left importable').toBe(false);
    const jobs = readFileSync('src/jobs/index.ts', 'utf8');
    expect(jobs, 'and its daily job with it').not.toContain('data_retention');
    expect(jobs, 'while the surviving one is still scheduled').toContain('retention_policy');
  });
});
