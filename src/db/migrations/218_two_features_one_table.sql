-- =============================================================================
-- Migration 218: two features, one table, and a UNIQUE key only one respected
--
-- `voice_sessions` was declared TWICE, by migration 013 and again by 031, with
-- different columns. `CREATE TABLE IF NOT EXISTS` made the second a no-op, so
-- the table that exists is 013's — the DAILY BRIEFING, keyed
-- `UNIQUE(product_id, session_date)` — and 031's conversation columns arrived
-- later as ALTERs in the schema-drift batch. One name, two features, one key.
--
-- THE FOUNDER COULD NOT HOLD A VOICE CONVERSATION AFTER 06:30 UTC, ANY DAY.
-- `morning_briefings` runs at 06:30 and writes that day's row. `startVoiceSession`
-- then inserts its own row for the same product and the same `date('now')` and
-- is refused:
--
--   SQLITE_CONSTRAINT_UNIQUE: voice_sessions.product_id, voice_sessions.session_date
--
-- Confirmed against a migrated database rather than reasoned about. The reverse
-- order is the other half of the same defect: a conversation started before the
-- briefing leaves a row that `getOrGenerateBriefing` finds with
-- `SELECT * FROM voice_sessions WHERE product_id = ? AND session_date = ?` —
-- no discriminator, no ORDER BY — and returns AS the briefing, `briefing_text`
-- null. The founder's daily briefing becomes an empty row and the real one is
-- never generated for that day.
--
-- These are two different things. A briefing is one per company per day, which
-- is what that UNIQUE key says and it is right. A conversation is as many as
-- somebody wants to have. Conflating them meant the second inherited a rule
-- written for the first.
--
-- `transcript` and `duration_seconds` STAY on `voice_sessions`: the briefing's
-- own voice-input path writes them, so they belong to both features and are not
-- the conversation's to take.
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_conversations (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id          TEXT NOT NULL REFERENCES founders(id),
  chat_session_id     TEXT REFERENCES chat_sessions(id),
  transcript          TEXT,
  duration_seconds    INTEGER,
  extracted_decisions TEXT,
  extracted_actions   TEXT,
  summary             TEXT,
  audio_url           TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active', 'completed')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voice_conversations_product
  ON voice_conversations(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_conversations_founder
  ON voice_conversations(founder_id, created_at DESC);

-- Any conversation rows that did get in — days when no briefing had been
-- generated first — move rather than being dropped. What a founder said is
-- theirs.
INSERT OR IGNORE INTO voice_conversations
  (id, product_id, founder_id, chat_session_id, transcript, duration_seconds,
   extracted_decisions, extracted_actions, summary, audio_url, status, created_at)
SELECT id, product_id, founder_id, chat_session_id, transcript, duration_seconds,
       extracted_decisions, extracted_actions, summary, audio_url,
       CASE WHEN status = 'completed' THEN 'completed' ELSE 'active' END,
       COALESCE(created_at, datetime('now'))
  FROM voice_sessions
 WHERE chat_session_id IS NOT NULL;

DELETE FROM voice_sessions WHERE chat_session_id IS NOT NULL;

ALTER TABLE voice_sessions DROP COLUMN chat_session_id;
ALTER TABLE voice_sessions DROP COLUMN extracted_decisions;
ALTER TABLE voice_sessions DROP COLUMN extracted_actions;
ALTER TABLE voice_sessions DROP COLUMN summary;
ALTER TABLE voice_sessions DROP COLUMN audio_url;
ALTER TABLE voice_sessions DROP COLUMN status;
