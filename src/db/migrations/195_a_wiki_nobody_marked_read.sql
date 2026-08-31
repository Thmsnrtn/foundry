-- =============================================================================
-- A READ-TRACKING LEDGER WITH NO READER AND NO WRITER.
--
-- `agent_wiki_reads` was to record which agent had read which wiki entry, so
-- `getUnreadWikiEntries` could tell an agent what it had not seen yet. Its only
-- writer was `markWikiRead` and its only reader was `getUnreadWikiEntries`,
-- both in `services/scp/wiki.ts`, and NEITHER HAD A CALLER anywhere. Same shape
-- as `temporal_events` in migration 194, and invisible to the same pair of
-- gates for the same reason: each found the other's half and stopped.
--
-- The consequence had this been wired without the ledger being populated is
-- worth naming, because it is the reason a half-feature is worse than none:
-- with nothing marking entries read, `getUnreadWikiEntries` returns EVERY entry
-- as unread, every time, forever. An agent asking "what is new for me" would be
-- handed the whole wiki and would conclude it had never read anything.
--
-- The store itself, `agent_wiki_entries`, is live: Scribe writes articles to it
-- every cycle and reads it back to see what the company already knows. Only the
-- read-tracking half goes.
--
-- Nothing is preserved. There are no rows to preserve.
-- =============================================================================

DROP INDEX IF EXISTS idx_wiki_reads_entry;
DROP INDEX IF EXISTS idx_wiki_reads_agent;
DROP TABLE IF EXISTS agent_wiki_reads;
