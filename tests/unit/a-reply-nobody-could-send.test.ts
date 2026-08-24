process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { sendMessage, markAsRead, getMessageInbox } from '../../src/services/scp/messages.js';

// =============================================================================
// A REPLY NOBODY COULD SEND.
//
// `agent_messages` carried four columns for a request-and-answer loop between
// agents. Nobody asked: `sendMessage` took `requiresResponse` and
// `responseDeadlineHours` and no caller ever passed either. Nobody could
// answer: `responded_at` and `response_id` had one writer, `replyToMessage`,
// which had no caller anywhere. And the dashboard drew both — an "Unanswered"
// card counting a state nothing could produce, and a "Response requested" badge
// that could never render.
//
// Migration 213 takes the four columns, the function and the two pieces of
// interface together, because they were one unbuilt mechanism.
//
// In the same file: `markAsRead` took message ids alone, so the company whose
// messages were marked was decided by whoever assembled the list.
// =============================================================================

const A = 'p_msg_a';
const B = 'p_msg_b';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_msg','c_msg','msg@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Alpha','f_msg','active')", [A]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Beta','f_msg','active')", [B]);
});

beforeEach(async () => { await query('DELETE FROM agent_messages'); });

describe('the response protocol', () => {
  it('is gone from the schema', async () => {
    const cols = (await query('PRAGMA table_info(agent_messages)'))
      .rows as unknown as Array<Record<string, unknown>>;
    const names = cols.map((c) => String(c.name));
    for (const dead of ['requires_response', 'response_deadline', 'responded_at', 'response_id']) {
      expect(names, `${dead} survived migration 213`).not.toContain(dead);
    }
    // What the bus does do is untouched.
    for (const live of ['from_agent', 'to_agent', 'priority', 'read_at', 'thread_id']) {
      expect(names).toContain(live);
    }
  });

  it('is gone from the code, including the reply nothing called', async () => {
    const src = stripComments(readFileSync('src/services/scp/messages.ts', 'utf8'));
    expect(src).not.toContain('replyToMessage');
    expect(src).not.toContain('requiresResponse');
    expect(src).not.toContain('responded_at');
  });

  it('is gone from the page that drew it', () => {
    const page = stripComments(readFileSync('src/routes/dashboard/agents-messages.ts', 'utf8'));
    expect(page).not.toContain('unresponded_count');
    expect(page).not.toContain('Response requested');
  });

  it('and a message still sends and arrives', async () => {
    const id = await sendMessage({
      productId: A, fromAgent: 'compass', toAgent: 'harbor',
      type: 'insight', priority: 'high', subject: 'Churn is up', body: 'In the SMB cohort.',
    });
    const inbox = await getMessageInbox(A, 'harbor');
    expect(inbox.map((m) => m.id)).toEqual([id]);
    expect(inbox[0].subject).toBe('Churn is up');
  });
});

describe('marking messages read', () => {
  it('cannot reach another company’s messages', async () => {
    const mine = await sendMessage({
      productId: A, fromAgent: 'compass', toAgent: 'harbor',
      type: 'insight', subject: 'Mine', body: 'x',
    });
    const theirs = await sendMessage({
      productId: B, fromAgent: 'compass', toAgent: 'harbor',
      type: 'insight', subject: 'Theirs', body: 'x',
    });

    await markAsRead(A, [mine, theirs]);

    const rows = (await query('SELECT id, read_at FROM agent_messages ORDER BY id'))
      .rows as unknown as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.read_at]));
    expect(byId[mine]).not.toBeNull();
    expect(byId[theirs], 'another company’s message was marked read').toBeNull();
  });
});
