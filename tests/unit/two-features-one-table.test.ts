process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => ({
    content: JSON.stringify({
      decisions: ['Whether to raise now or in the spring'],
      actions: ['Send Ines the updated deck'],
      summary: 'Talked through the raise and the deck.',
    }),
    tokensUsed: 10, costUsd: 0,
  })),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { startVoiceSession, endVoiceSession, getVoiceConversations } = await import(
  '../../src/services/voice/processor.js');

// =============================================================================
// TWO FEATURES, ONE TABLE, AND A UNIQUE KEY ONLY ONE OF THEM RESPECTED.
//
// `voice_sessions` was declared twice — migration 013 (the DAILY BRIEFING, keyed
// UNIQUE(product_id, session_date)) and again by 031 (the CONVERSATION).
// `CREATE TABLE IF NOT EXISTS` made the second a no-op, so the conversation
// inherited a key written for the briefing: one per company per day.
//
// THE FOUNDER COULD NOT HOLD A VOICE CONVERSATION AFTER 06:30 UTC, ANY DAY.
// `morning_briefings` runs then and writes that day's row; `startVoiceSession`
// supplied `date('now')` to satisfy the NOT NULL and was refused by the UNIQUE.
// The reverse order is the same defect from the other side: a conversation
// started first leaves a row `getOrGenerateBriefing` returns AS the briefing —
// `SELECT *`, no discriminator, no ORDER BY — with `briefing_text` null.
//
// And `endVoiceSession` pays for a Sonnet call to extract decisions and action
// items from every transcript, into a row no route could read back.
// =============================================================================

const P = 'p_voice';
const OWNER = 'f_voice';
const STRANGER = 'f_voice_other';

let app: Hono;

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'o@example.com'], [STRANGER, 's@example.com']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)', [id, `c_${id}`, email]);
  }
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme',?,'active')", [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM voice_conversations WHERE product_id = ?', [P]);
  await query('DELETE FROM voice_sessions WHERE product_id = ?', [P]);
});

function appAs(founderId: string): Promise<Hono> {
  return (async () => {
    const { platformApiRoutes } = await import('../../src/routes/api/platform.js');
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('founder' as never, { id: founderId, email: 'x@example.com', preferences: {} } as never);
      await next();
    });
    a.route('/', platformApiRoutes as unknown as Hono);
    return a;
  })();
}

async function briefingExistsForToday(): Promise<void> {
  await query(
    `INSERT INTO voice_sessions (id, product_id, founder_id, session_date, briefing_text)
     VALUES ('vs_brief', ?, ?, date('now'), 'Signal is at 62.')`,
    [P, OWNER]);
}

describe('a conversation and a briefing no longer collide', () => {
  it('a conversation can start on a day the briefing has already been written', async () => {
    await briefingExistsForToday();
    const session = await startVoiceSession(OWNER, P);
    expect(session.voice_session_id).toBeTruthy();
  });

  it('and a second and a third the same day, because a conversation is not one-per-day', async () => {
    await briefingExistsForToday();
    const a = await startVoiceSession(OWNER, P);
    const b = await startVoiceSession(OWNER, P);
    const c = await startVoiceSession(OWNER, P);
    expect(new Set([a.voice_session_id, b.voice_session_id, c.voice_session_id]).size).toBe(3);
  });

  it('a conversation leaves the briefing row alone, so the day still has a briefing', async () => {
    await startVoiceSession(OWNER, P);
    await briefingExistsForToday();
    const rows = await query(
      "SELECT briefing_text FROM voice_sessions WHERE product_id = ? AND session_date = date('now')",
      [P]);
    expect(rows.rows).toHaveLength(1);
    expect(String((rows.rows[0] as unknown as { briefing_text: string }).briefing_text))
      .toContain('Signal is at 62');
  });

  it('the briefing table no longer carries the conversation columns at all', async () => {
    const cols = (await query('PRAGMA table_info(voice_sessions)'))
      .rows as unknown as Array<Record<string, unknown>>;
    const names = cols.map((c) => String(c.name));
    for (const gone of ['chat_session_id', 'extracted_decisions', 'extracted_actions',
      'summary', 'audio_url', 'status']) {
      expect(names, `${gone} should have moved`).not.toContain(gone);
    }
    // What both features write stays where both can reach it.
    expect(names).toContain('transcript');
    expect(names).toContain('duration_seconds');
  });
});

describe('what the model was paid to extract can be read back', () => {
  it('the owner reads the decisions and actions taken from their own transcript', async () => {
    const { voice_session_id } = await startVoiceSession(OWNER, P);
    await endVoiceSession(voice_session_id, 'We talked about the raise.', 240);

    const conversations = await getVoiceConversations(P);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.extracted_actions).toEqual(['Send Ines the updated deck']);
    expect(conversations[0]!.extracted_decisions)
      .toEqual(['Whether to raise now or in the spring']);
    expect(conversations[0]!.summary).toContain('raise');
    expect(conversations[0]!.status).toBe('completed');
  });

  it('over the route, owner-verified — a stranger gets 404 and none of the words', async () => {
    const { voice_session_id } = await startVoiceSession(OWNER, P);
    await endVoiceSession(voice_session_id, 'We talked about the raise.', 240);

    const mine = await (await appAs(OWNER)).request(`/api/voice/conversations/${P}`);
    expect(mine.status).toBe(200);
    expect(await mine.text()).toContain('Send Ines the updated deck');

    const theirs = await (await appAs(STRANGER)).request(`/api/voice/conversations/${P}`);
    expect(theirs.status).toBe(404);
    expect(await theirs.text()).not.toContain('Ines');
  });

  it('the list does not carry the transcript — a list is for choosing', async () => {
    const { voice_session_id } = await startVoiceSession(OWNER, P);
    await endVoiceSession(voice_session_id, 'A very long transcript indeed.', 240);
    const res = await (await appAs(OWNER)).request(`/api/voice/conversations/${P}`);
    expect(await res.text()).not.toContain('A very long transcript indeed');
  });

  it('a malformed stored value yields an empty list, not a crash', async () => {
    await query(
      `INSERT INTO voice_conversations (id, product_id, founder_id, extracted_actions)
       VALUES ('vc_bad', ?, ?, 'not json')`, [P, OWNER]);
    const conversations = await getVoiceConversations(P);
    expect(conversations[0]!.extracted_actions).toEqual([]);
  });
});
