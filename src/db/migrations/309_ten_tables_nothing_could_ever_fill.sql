-- =============================================================================
-- A table nothing writes is a promise the institution cannot keep.
--
-- The 72 routes deleted with the commercial product were the only writers these
-- tables ever had. What survived was the reading half: a milestone card called
-- "First Beta Intake Submitted" that no founder could ever earn, a lifecycle
-- condition requiring ten rows of `beta_intake` that would therefore hold
-- prompt_3 shut forever, an OKR forecast over `key_results` nobody could set,
-- and a push notifier that looked up the founder's devices in a table no device
-- had ever been able to register in — so every buzz it believed it sent was a
-- query returning nothing.
--
-- Permanent emptiness is worse than absence. An absent surface asks no
-- question; an empty one answers a question wrongly, and the founder believes
-- the answer. So the reading halves went with the writing halves, and the
-- tables go here.
--
-- Order is the foreign-key order: children before parents.
--   push_log            -> push_subscriptions
--   investor_annotations-> investors
--   key_results         -> company_okrs
-- (`okr_progress_updates`, the third level, went in migration 308.)
-- =============================================================================

DROP TABLE IF EXISTS push_log;
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS investor_annotations;
DROP TABLE IF EXISTS investors;
DROP TABLE IF EXISTS key_results;
DROP TABLE IF EXISTS company_okrs;
DROP TABLE IF EXISTS beta_intake;
DROP TABLE IF EXISTS cofounder_dna_responses;
DROP TABLE IF EXISTS cofounder_gate_agreements;
DROP TABLE IF EXISTS marketplace_metrics;

-- And then the second ring, found by running the gates again rather than by
-- guessing. Dropping a table makes its siblings visible: these four were
-- reachable only through the code above, so deleting that code left them with
-- neither a reader nor a writer — a table nobody can touch, which is still
-- schema to migrate and still an erasure question to answer.
--
-- `agent_wiki_entries` is the clearest of them. `services/scp/wiki.ts` was its
-- only reader and writer, and the only module that reached `wiki.ts` was
-- `scp/agents/scribe.ts`, deleted above. The wiki had frozen on its first five
-- articles because nothing had been able to add a sixth since the route went.
DROP TABLE IF EXISTS agent_wiki_entries;
DROP TABLE IF EXISTS cofounder_alignment_scores;
DROP TABLE IF EXISTS investor_updates;
DROP TABLE IF EXISTS marketplace_trust_audit;
