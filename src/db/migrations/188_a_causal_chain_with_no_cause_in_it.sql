-- =============================================================================
-- A CAUSAL CHAIN WITH NO CAUSE IN IT.
--
-- `discoverCausalChains` asks Opus, with a 4096-token budget, to find multi-hop
-- causes in a product's knowledge graph. The model returns `root_cause` and
-- `effect` as ENTITY LABELS — the same labels it was given in the prompt. The
-- INSERT wrote them into `root_cause_entity_id` and `effect_entity_id` as
-- literal NULL, and kept no other copy.
--
-- So every stored chain lost the two things a causal chain is about. It kept
-- the prose description and the insight; the cause and the effect were dropped
-- on the way to disk.
--
-- It did not matter, because nothing read the table. That is the other half:
-- the weekly graph_rebuild job ran this for every active product and used the
-- result for a log line — "3 causal chains discovered" — while the one route
-- that serves chains to a caller called the model again on every request rather
-- than reading what the job had already paid for.
--
-- These two columns hold the labels. The ids are now resolved against
-- `graph_entities` where a label matches and left NULL where none does, which
-- is the honest outcome: the model may name something that is not in the graph,
-- and a chain that points at nothing should say so rather than point at
-- whatever was nearest.
-- =============================================================================

ALTER TABLE causal_chains ADD COLUMN root_cause_label TEXT;
ALTER TABLE causal_chains ADD COLUMN effect_label TEXT;
