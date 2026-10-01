process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A REPLY NOBODY COULD SEND.
//
// `agent_messages` carried four columns for a request-and-answer loop between
// agents. Nobody asked: `sendMessage` took `requiresResponse` and
// `responseDeadlineHours` and no caller ever passed either. Nobody could
// answer: `responded_at` and `response_id` had one writer, `replyToMessage`,
// which had no caller anywhere. A dashboard drew both — an "Unanswered" card
// counting a state nothing could produce, and a "Response requested" badge that
// could never render — and that page has since gone with the rest of Commercial
// Foundry.
//
// Migration 213 takes the four columns and the function together, because they
// were one unbuilt mechanism; what is checked here is the schema and the service,
// which is where the mechanism would have to come back.
//
// In the same file: `markAsRead` took message ids alone, so the company whose
// messages were marked was decided by whoever assembled the list.
// =============================================================================

// `scp/messages.ts` was deleted in Roadmap 2027 R9 with the agents; the schema
// half of this file is what is left to hold.

beforeAll(async () => { await runMigrations(); });

describe('the response protocol', () => {
  it('is gone from the schema', async () => {
    const cols = (await query('PRAGMA table_info(agent_messages)'))
      .rows as unknown as Array<Record<string, unknown>>;
    const names = cols.map((c) => String(c.name));
    for (const dead of ['requires_response', 'response_deadline', 'responded_at', 'response_id']) {
      expect(names, `${dead} survived migration 213`).not.toContain(dead);
    }
    // What the bus does do is untouched. This list is an anti-overreach guard —
    // 213 took four columns and must not have taken a fifth — so it shrinks only
    // when a LATER migration removes one deliberately. `thread_id` left in 216,
    // which dropped it together with `agent_message_threads`; the guard against
    // 213 having taken it is the assertion below that 213's own text names four
    // columns and no more.
    for (const live of ['from_agent', 'to_agent', 'priority', 'read_at']) {
      expect(names).toContain(live);
    }
    const m213 = readFileSync('src/db/migrations/213_a_reply_nobody_could_send.sql', 'utf8');
    expect(m213.match(/ALTER TABLE agent_messages DROP COLUMN/g)).toHaveLength(4);
    expect(m213).not.toContain('thread_id;');
  });
});
