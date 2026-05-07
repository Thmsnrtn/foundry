-- =============================================================================
-- FOUNDRY — V3.1 Layer B: Product Voice Fingerprints
-- Per-product writing-voice signature. Distinct from `founder_voice`
-- (founder communication style) and `src/services/voice/` (audio briefings).
-- This table captures: how does THIS product (Foundry, AcreOS, Astrum)
-- sound when it speaks to its customers?
-- Vesper/Lyric recursion findings: exemplars + anti-canon + register.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_voice_fingerprints (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,                   -- monotonic per product
  status TEXT NOT NULL DEFAULT 'draft',       -- 'draft' | 'active' | 'archived'
  -- ─── Linguistic signature ────────────────────────────────────────────────
  sentence_rhythm TEXT,                       -- e.g. 'short_punchy', 'rolling', 'staccato_then_long'
  lexical_preferences TEXT,                   -- JSON list of preferred terms/phrasings
  banned_words TEXT,                          -- JSON list of forbidden words/phrases
  register TEXT,                              -- 'formal'|'conversational'|'technical'|'irreverent'|'plainspoken'
  energy TEXT,                                -- 'urgent'|'measured'|'warm'|'cool'
  pov TEXT,                                   -- 'we'|'you'|'i'|'mixed'
  -- ─── Anti-canon (Vesper's recursion finding) ────────────────────────────
  anti_exemplars TEXT,                        -- JSON list: "what we are NOT" sentences
  -- ─── Exemplars (founder-rated in-voice sentences) ──────────────────────
  -- Required (≥5) for status='active'; nullable for drafts.
  exemplar_sentences TEXT,                    -- JSON list
  -- ─── Meta ───────────────────────────────────────────────────────────────
  source TEXT NOT NULL DEFAULT 'founder',     -- 'founder' | 'llm_distilled' | 'mixed'
  notes TEXT,
  activated_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voice_fp_product_status
  ON product_voice_fingerprints(product_id, status, version DESC);

-- Partial unique index: at most one 'active' fingerprint per product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_fp_active_unique
  ON product_voice_fingerprints(product_id) WHERE status = 'active';
