// =============================================================================
// Tests: Data retention purge (Phase 3.5)
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { purgeExpiredRecords } from '../../src/services/retention.js';

const DAY = 86_400_000;

beforeAll(async () => {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, body TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action_type TEXT, created_at TEXT);
  `);
});

beforeEach(async () => {
  await executeRaw('DELETE FROM agent_messages');
  await executeRaw('DELETE FROM audit_log');
});

async function insert(table: string, id: string, daysAgo: number): Promise<void> {
  const ts = new Date(Date.now() - daysAgo * DAY).toISOString();
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
    await executeRaw('CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, body TEXT, created_at TEXT)');
  });
});
