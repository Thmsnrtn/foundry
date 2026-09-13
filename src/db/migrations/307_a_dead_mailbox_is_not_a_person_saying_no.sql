-- =============================================================================
-- FOUNDRY — a dead mailbox is not a person saying no
--
-- `opt_outs` described itself as counting "Workshop suppressions recorded from
-- this experiment". That is what the code did, and both were wrong in the same
-- way, because suppression is not a kind of evidence — it is what the
-- institution DOES with several different kinds.
--
-- An address is suppressed when a person asks to be left alone. It is also
-- suppressed when the provider reports the mailbox dead, when a complaint is
-- filed, and when the owner strikes it out by hand. All four are correct
-- suppressions and only the first is anybody saying no.
--
-- So one undeliverable address at RGC Millwork read as one bounce AND one
-- opt-out, and Experiment 001 sat one dead mailbox away from stopping itself
-- against a threshold of two while announcing that two people had asked not to
-- be written to. Nobody had asked. The experiment would have reported a fact
-- about the market that the market had not produced, and the four shops not yet
-- written to would have been withheld from on the strength of it.
--
-- A DELIVERY FAILURE AND A REFUSAL ARE DIFFERENT EVIDENCE. One says the list
-- was wrong; the other says the offer was unwelcome. They are gathered
-- differently, they mean different things about whether to continue, and a
-- system that adds them together can no longer tell the owner which of the two
-- it has seen. `bounces` already counts the first and has its own threshold and
-- its own rate. `opt_outs` counts only the second.
--
-- The suppression itself is untouched. RGC's address stays suppressed, because
-- the reason it must not be written to again does not depend on which of these
-- two facts put it there.
-- =============================================================================

DROP TRIGGER probe_stop_kinds_constitutional_update;
UPDATE probe_stop_kinds
   SET counts = 'people who asked this experiment not to contact them — not bounces, complaints '
             || 'or owner exclusions, which are suppressed for their own reasons and counted elsewhere'
 WHERE kind = 'opt_outs';
CREATE TRIGGER probe_stop_kinds_constitutional_update BEFORE UPDATE ON probe_stop_kinds
BEGIN SELECT RAISE(ABORT,'probe_stop_kind:constitutional'); END;
