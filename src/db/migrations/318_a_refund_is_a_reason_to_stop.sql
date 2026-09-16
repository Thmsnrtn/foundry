-- =============================================================================
-- 318 — A REFUND IS A REASON TO STOP.
--
-- The stop-condition vocabulary (migration 286) was written for a probe whose
-- offer travelled by email: complaints, bounces, opt-outs, people saying it
-- was not useful, purchases that could not be delivered. The second real
-- experiment travels by a marketplace listing the owner places himself. Nobody
-- is written to, so bounces and opt-outs can never count; what CAN go wrong
-- there is a buyer paying and then wanting the money back, which is the
-- venue's own signal that the listing promised what the file did not deliver.
--
-- The vocabulary is constitutional: its triggers refuse every insert, so a
-- widening is a migration and a review, never a runtime write. The triggers
-- are dropped, one row is added, and the triggers are put back exactly as
-- they were. A stop condition of this kind counts `refund` outcome events on
-- the experiment's exposure.
-- =============================================================================

DROP TRIGGER IF EXISTS probe_stop_kinds_constitutional_insert;
DROP TRIGGER IF EXISTS probe_stop_kinds_constitutional_update;
DROP TRIGGER IF EXISTS probe_stop_kinds_constitutional_delete;

INSERT OR IGNORE INTO probe_stop_kinds (kind, what_it_is, counts, counted_one, counted_many, sort_order) VALUES
  ('refunds', 'buyers paid and then wanted their money back', 'refund outcome events at the exposure',
   'refund', 'refunds', 6);

CREATE TRIGGER probe_stop_kinds_constitutional_insert BEFORE INSERT ON probe_stop_kinds
BEGIN SELECT RAISE(ABORT,'probe_stop_kind:constitutional'); END;
CREATE TRIGGER probe_stop_kinds_constitutional_update BEFORE UPDATE ON probe_stop_kinds
BEGIN SELECT RAISE(ABORT,'probe_stop_kind:constitutional'); END;
CREATE TRIGGER probe_stop_kinds_constitutional_delete BEFORE DELETE ON probe_stop_kinds
BEGIN SELECT RAISE(ABORT,'probe_stop_kind:constitutional'); END;
