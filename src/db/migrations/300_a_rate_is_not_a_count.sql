-- =============================================================================
-- FOUNDRY — a rate is not a count, and a bigger sample must not hide a bad list
--
-- The stop envelope was designed around a cohort of two. Three bounces out of
-- two attempts is impossible; three out of forty is a Tuesday. Multiplying every
-- threshold by the new sample size would be the wrong correction in the other
-- direction: it would let a list that is a quarter wrong run to completion
-- because no absolute number was ever reached.
--
-- So the counts stay conservative where the harm is to a person — one genuine
-- complaint, one paid brief that cannot be delivered — and a RATE joins them
-- for the one failure that only a rate can see. A bounce rate says the list is
-- wrong; a bounce count says the day was unlucky. Both are worth stopping on,
-- and they stop on different evidence.
--
-- THE RATE HAS A FLOOR. One bounce out of one attempt is 100% and means
-- nothing. The reading is zero until enough has been attempted for a proportion
-- to be a fact, which is where the arithmetic stops being a headline.
-- =============================================================================

DROP TRIGGER probe_stop_kinds_constitutional_insert;
INSERT INTO probe_stop_kinds (kind, what_it_is, counts, counted_one, counted_many, sort_order) VALUES
  ('bounce_rate', 'too many of the messages are not arriving',
   'the percentage of attempted offers the provider reported as failed, once enough have been attempted to mean anything',
   'percent of messages not arriving', 'percent of messages not arriving', 6);
CREATE TRIGGER probe_stop_kinds_constitutional_insert BEFORE INSERT ON probe_stop_kinds
BEGIN SELECT RAISE(ABORT,'probe_stop_kind:constitutional'); END;
