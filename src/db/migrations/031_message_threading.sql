-- Migration 031: Agent message threads
-- Adds threading support to agent_messages so multi-turn conversations
-- between agents can be grouped and traversed as a coherent thread.
-- agent_message_threads is the parent; individual messages link back via thread_id.

-- agent_message_threads: groups related messages into a named conversation
-- participants is a JSON array of agent names involved in the thread
-- message_count and last_message_at are denormalised for efficient listing queries
CREATE TABLE IF NOT EXISTS agent_message_threads (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL,
  subject         TEXT NOT NULL,
  participants    TEXT NOT NULL DEFAULT '[]',   -- JSON array of agent name strings
  message_count   INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,                         -- updated when a new message is posted
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_message_threads_product
  ON agent_message_threads(product_id, last_message_at);

-- Add thread_id and parent_message_id to the existing agent_messages table.
-- thread_id groups messages into a conversation thread.
-- parent_message_id enables reply-to-message nesting within a thread.
-- Both are nullable so existing rows remain valid.
ALTER TABLE agent_messages ADD COLUMN thread_id TEXT REFERENCES agent_message_threads(id);
ALTER TABLE agent_messages ADD COLUMN parent_message_id TEXT REFERENCES agent_messages(id);

CREATE INDEX IF NOT EXISTS idx_agent_messages_thread
  ON agent_messages(thread_id);
