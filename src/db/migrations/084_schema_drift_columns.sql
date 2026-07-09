-- =============================================================================
-- Migration 084: Add columns the shipped code writes but the schema lacks
-- (schema-drift audit — INSERT-column mismatches, batch 1).
--
-- These are cases where the feature genuinely needs the column (it writes and
-- reads structured data there); the migration was simply never added. Adding
-- the column is the correct fix, not deleting the write.
--
--   • strategic_decisions_log: createDecision() (services/scp/decision-log.ts)
--     persists the alternatives it weighed and the assumptions behind a strategic
--     decision as JSON. Both are distinct from agent_context_json.
--   • agent_wiki_entries: createWikiEntry() (services/scp/wiki.ts) writes and
--     upserts a confidence score for each wiki entry.
-- =============================================================================

ALTER TABLE strategic_decisions_log ADD COLUMN alternatives_considered_json TEXT;
ALTER TABLE strategic_decisions_log ADD COLUMN key_assumptions_json TEXT;

ALTER TABLE agent_wiki_entries ADD COLUMN confidence_score REAL DEFAULT 0;
