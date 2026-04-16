-- =============================================================================
-- FOUNDRY — Migration 009: Conversational Layer
-- Multi-turn Ask Foundry threads with full business context and action tracking.
-- =============================================================================

-- A conversation thread: a persistent, named session tied to one product.
CREATE TABLE IF NOT EXISTS conversation_threads (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  title TEXT,                  -- auto-generated from first message
  intent TEXT CHECK(intent IN (
    'explain', 'compare', 'scenario', 'action', 'search', 'general'
  )),
  context_snapshot TEXT,       -- JSON: {signal, riskState, stressors, metrics} at thread start
  message_count INTEGER DEFAULT 0,
  last_message_at DATETIME,
  pinned BOOLEAN DEFAULT FALSE,
  archived BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conv_threads_product ON conversation_threads(product_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_threads_founder ON conversation_threads(founder_id, created_at DESC);

-- Individual messages within a thread.
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  data_points TEXT,            -- JSON: [{label, value}] — structured data surfaced alongside answer
  actions_taken TEXT,          -- JSON: [{type, description, entity_id, entity_type}]
  intent TEXT,                 -- classified intent for this specific exchange
  model_used TEXT,
  tokens_used INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conv_messages_thread ON conversation_messages(thread_id, created_at ASC);

-- Saved queries: founders can bookmark any assistant response for later.
CREATE TABLE IF NOT EXISTS saved_insights (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  message_id TEXT REFERENCES conversation_messages(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,       -- copied from the message for durability
  tags TEXT,                   -- JSON: string[]
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_saved_insights_product ON saved_insights(product_id, created_at DESC);
