process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { sendMessage } from '../../src/services/scp/messages.js';

// =============================================================================
// A WORD THE COLUMN REFUSED, AND THE MESSAGE THAT WENT WITH IT.
//
// `sendMessage` declares `priority` as a union of four words, and its only
// caller fills it by casting a field straight out of a language model's JSON.
// A compiler guarantee ends where the data begins. `agent_messages.priority`
// carries CHECK(priority IN ('low','medium','high','critical')), so a model
// answering 'urgent' aborted the INSERT — and because the call site ends in
// `.catch(err => logger.error(...))`, the whole message from one agent to
// another disappeared, leaving a log line.
//
// The field beside it was already handled: `message_type` is mapped to 'report'
// when the model says something the enum does not have. One validated field
// proves nothing about the one next to it.
// =============================================================================

const P = 'p_msg';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_msg','c_msg','msg@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_msg','active')", [P]);
});
beforeEach(async () => { await query('DELETE FROM agent_messages'); });

/** What the call site actually does: a cast, not a check. */
function sendWithModelPriority(word: string) {
  return sendMessage({
    productId: P,
    fromAgent: 'atlas',
    toAgent: 'sentinel',
    type: 'handoff',
    priority: word as 'low' | 'medium' | 'high' | 'critical',
    subject: 'the billing module',
    body: 'handing this over',
  });
}

describe('a message survives a priority the column does not have', () => {
  it('delivers it at the default rather than losing it', async () => {
    const id = await sendWithModelPriority('urgent');

    const row = (await query(
      'SELECT priority, subject FROM agent_messages WHERE id = ?', [id]
    )).rows[0] as Record<string, unknown> | undefined;

    expect(row, 'the message must exist — losing a handoff over its label is the '
      + 'larger failure').toBeDefined();
    expect(String(row!.priority)).toBe('medium');
    expect(String(row!.subject)).toBe('the billing module');
  });

  it('keeps a priority the column does have', async () => {
    const id = await sendWithModelPriority('critical');
    const row = (await query('SELECT priority FROM agent_messages WHERE id = ?', [id])).rows[0] as Record<string, unknown>;
    expect(String(row.priority),
      'coercion must not flatten the levels that are real').toBe('critical');
  });

  it('is checked against the vocabulary the database actually enforces', () => {
    // Pinning the two lists to each other: a migration widening the CHECK
    // without widening the guard would silently start coercing a level that had
    // become legal.
    const migration = readFileSync(
      resolve(import.meta.dirname, '../../src/db/migrations/022_customer_lifecycle.sql'), 'utf8');
    const check = /priority\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'medium'\s+CHECK\(priority\s+IN\s*\(([^)]*)\)\)/i
      .exec(migration);
    expect(check, 'the agent_messages priority CHECK is no longer where this expects it').not.toBeNull();

    const allowed = check![1].split(',').map((w) => w.trim().replace(/'/g, '')).sort();
    const guard = readFileSync(
      resolve(import.meta.dirname, '../../src/services/scp/messages.ts'), 'utf8');
    const set = /VALID_PRIORITIES\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(guard);
    expect(set, 'VALID_PRIORITIES is no longer declared as expected').not.toBeNull();

    const guarded = set![1].split(',').map((w) => w.trim().replace(/'/g, '')).filter(Boolean).sort();
    expect(guarded).toEqual(allowed);
  });
});
