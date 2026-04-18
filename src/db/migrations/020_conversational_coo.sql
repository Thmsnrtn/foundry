-- =============================================================================
-- Migration 020: Conversational COO Interface
-- Chat sessions and messages for natural language founder interaction.
-- =============================================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  title TEXT,
  channel TEXT DEFAULT 'web',
  started_at TEXT DEFAULT (datetime('now')),
  last_message_at TEXT DEFAULT (datetime('now')),
  message_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id),
  role TEXT NOT NULL CHECK(role IN ('founder', 'coo', 'system')),
  content TEXT NOT NULL,
  context_used TEXT,
  actions_proposed TEXT,
  actions_taken TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_webhooks (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  config TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_founder ON chat_sessions(founder_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_product ON chat_sessions(product_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_webhooks_founder ON chat_webhooks(founder_id);
