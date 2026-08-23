-- =============================================================================
-- Migration 031: Voice-First COO
-- Voice sessions, transcripts, voice memos with extracted actions.
-- =============================================================================

-- THIS STATEMENT DID NOT RUN. `voice_sessions` was created by `013_voice_push.sql`, and
-- `CREATE TABLE IF NOT EXISTS` over an existing table does nothing — so the
-- columns below are a PROPOSAL, not the schema. The live shape is the earlier
-- one plus whatever later migrations added by ALTER; read
-- `docs/db/schema.snapshot.sql` for what the database actually has.
-- `tests/unit/only-the-first-create-is-the-schema.test.ts` pins the full list.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  chat_session_id TEXT REFERENCES chat_sessions(id),
  duration_seconds INTEGER,
  transcript TEXT,
  extracted_decisions TEXT,
  extracted_actions TEXT,
  summary TEXT,
  audio_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voice_memos (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  audio_url TEXT,
  transcript TEXT,
  duration_seconds INTEGER,
  action_items TEXT,
  decisions_created TEXT,
  coo_response TEXT,
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions ON voice_sessions(founder_id, created_at);
CREATE INDEX IF NOT EXISTS idx_voice_memos ON voice_memos(founder_id, processed);
