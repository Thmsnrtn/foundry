process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

// =============================================================================
// TWO FEATURES, ONE TABLE, AND A UNIQUE KEY ONLY ONE OF THEM RESPECTED.
//
// `voice_sessions` was declared twice — migration 013 (the DAILY BRIEFING, keyed
// UNIQUE(product_id, session_date)) and again by 031 (the CONVERSATION).
// `CREATE TABLE IF NOT EXISTS` made the second a no-op, so the conversation
// inherited a key written for the briefing: one per company per day. The
// founder could not hold a voice conversation after 06:30 UTC on any day, and a
// conversation started first left a row `getOrGenerateBriefing` returned AS the
// briefing, with `briefing_text` null. Migration 218 separated them.
//
// THE CONVERSATION HALF IS GONE. `voice/processor.ts` held `startVoiceSession`,
// `endVoiceSession` and `getVoiceConversations`; its HTTP door went with the
// Commercial Foundry surface, and the module has now followed it as reachable
// from no entry point. The eight cases here that started conversations, and
// that read back what the model was paid to extract from them, went with it.
//
// THE BRIEFING HALF IS STILL LIVE — `voice/briefing.ts` writes and reads
// `voice_sessions` — so the separation itself still has to hold. That is what
// is asserted below: the briefing's table does not carry the conversation's
// columns, and does carry the two both features share.
// =============================================================================

const P = 'p_voice';
const OWNER = 'f_voice';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, `c_${OWNER}`, 'o@example.com']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme',?,'active')", [P, OWNER]);
});

describe('the briefing table is the briefing\'s alone', () => {
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
