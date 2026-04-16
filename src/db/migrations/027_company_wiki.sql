-- Migration 027: Persistent cross-agent knowledge store
-- Agents and founders collaboratively build a structured knowledge base per product.
-- Entries are versioned; reads are tracked so agents know what context others have seen.

-- agent_wiki_entries: structured knowledge articles organised by section
-- version is incremented on each edit; last_editor tracks who made the latest change
-- is_pinned = 1 causes the entry to surface prominently in agent briefing context
CREATE TABLE IF NOT EXISTS agent_wiki_entries (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL,
  section      TEXT NOT NULL CHECK (section IN (
                 'customers','product','market','operations','team',
                 'financial','technical','strategy','other'
               )),
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  tags         TEXT NOT NULL DEFAULT '[]',    -- JSON array of tag strings
  author       TEXT NOT NULL,                 -- 'founder' or agent name
  last_editor  TEXT,                          -- updated on each revision
  version      INTEGER NOT NULL DEFAULT 1,
  is_pinned    INTEGER NOT NULL DEFAULT 0,    -- 1 = always included in agent context
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enforce one entry per (product, section, title) combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_entries_unique
  ON agent_wiki_entries(product_id, section, title);

CREATE INDEX IF NOT EXISTS idx_wiki_entries_product_section
  ON agent_wiki_entries(product_id, section, updated_at);

-- agent_wiki_reads: tracks which agents have read each entry and when
-- Useful for ensuring agents refresh their context when entries change
CREATE TABLE IF NOT EXISTS agent_wiki_reads (
  id         TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  read_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wiki_reads_entry    ON agent_wiki_reads(entry_id);
CREATE INDEX IF NOT EXISTS idx_wiki_reads_agent    ON agent_wiki_reads(agent_name);
