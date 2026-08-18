// =============================================================================
// Tests: Data retention purge (Phase 3.5)
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { purgeExpiredRecords } from '../../src/services/retention.js';

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
  if (table === 'audit_log') {
    await query(
      `INSERT INTO audit_log (id, product_id, action_type, gate, "trigger", reasoning, input_context, output, created_at)
       VALUES (?, 'ret_p1', 'test_action', 0, 'test', 'because', '{}', '{}', ?)`, [id, ts]);
    return;
  }
  await query(`INSERT INTO ${table} (id, created_at) VALUES (?, ?)`, [id, ts]);
}

describe('purgeExpiredRecords', () => {
  it('deletes rows older than the retention window and keeps recent ones', async () => {
    await insert('agent_messages', 'old', 200);
    await insert('agent_messages', 'edge', 179);
    await insert('agent_messages', 'new', 5);
    await insert('audit_log', 'old-audit', 365);
    await insert('audit_log', 'new-audit', 10);

    const counts = await purgeExpiredRecords(180);

    expect(counts.agent_messages).toBe(1);
    expect(counts.audit_log).toBe(1);

    const remainingMsgs = await query('SELECT id FROM agent_messages ORDER BY id', []);
    expect(remainingMsgs.rows.map((r) => (r as Record<string, string>).id)).toEqual(['edge', 'new']);
    const remainingAudit = await query('SELECT id FROM audit_log', []);
    expect(remainingAudit.rows.map((r) => (r as Record<string, string>).id)).toEqual(['new-audit']);
  });

  it('honors a custom retention window', async () => {
    await insert('agent_messages', 'a', 40);
    await insert('agent_messages', 'b', 20);
    const counts = await purgeExpiredRecords(30);
    expect(counts.agent_messages).toBe(1);
  });

  it('does not throw when a table is missing (returns -1 for it)', async () => {
    await executeRaw('DROP TABLE IF EXISTS agent_messages');
    const counts = await purgeExpiredRecords(180);
    expect(counts.agent_messages).toBe(-1);
    // recreate for other tests
  });
});
