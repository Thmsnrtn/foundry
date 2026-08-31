-- =============================================================================
-- Migration 216: two columns pointing at tables that are gone
--
-- MIGRATION 215 WAS INCOMPLETE AND THE SUITE SAID SO IMMEDIATELY: fifty test
-- files went red with
--
--   data deletion incomplete: agent_messages:
--   SQLITE_ERROR: no such table: main.agent_message_threads
--
-- Two of the eleven tables it dropped were the PARENT SIDE OF A FOREIGN KEY
-- held by a table that stays:
--
--   agent_messages.thread_id  REFERENCES agent_message_threads(id)   -- 031
--   experiments.holdout_id    REFERENCES experiment_holdouts(id)     -- 035
--
-- With `foreign_keys = 1`, a DELETE against the child fails once the parent is
-- gone — so the erasure path, which deletes a founder's `agent_messages`,
-- could not complete. A dangling foreign key is not a cosmetic leftover.
--
-- THE ANSWER IS NOT TO PUT THE TABLES BACK. Both columns are exactly what 215
-- was clearing: the pointer half of a mechanism whose other half was never
-- built. Neither is read or written anywhere in `src/` — no threading feature
-- groups agent messages, no experiment has ever had a holdout arm — and
-- migration 213 removed four columns from this same `agent_messages` table for
-- the same reason and in the same words: not a feature with a gap, an unbuilt
-- mechanism, and it comes back whole if it is wanted.
--
-- `parent_message_id` stays. It is the other column 031 added, and its
-- REFERENCES points at `agent_messages` itself, which is not going anywhere.
--
-- SQLite drops a column in place when no index or trigger references it, so
-- `idx_agent_messages_thread` goes first. `experiments.holdout_id` never had
-- an index of its own; 035's index was on the dropped table.
--
-- The gate that missed this is fixed in the same batch:
-- `check-unreferenced-tables.mjs` read TypeScript only, so a table referenced
-- solely by a foreign key from live schema counted as reachable by nothing.
-- =============================================================================

DROP INDEX IF EXISTS idx_agent_messages_thread;

ALTER TABLE agent_messages DROP COLUMN thread_id;
ALTER TABLE experiments DROP COLUMN holdout_id;
