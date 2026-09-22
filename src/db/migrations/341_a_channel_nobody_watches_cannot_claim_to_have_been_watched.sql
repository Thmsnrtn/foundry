-- =============================================================================
-- A CHANNEL NOBODY WATCHES CANNOT CLAIM TO HAVE BEEN WATCHED.
--
-- Migration 340 added `experiment_fulfilments.observed_how` so the institution
-- could say how a row came to be known — the owner's distinction between "an
-- obligation independently observed by Foundry" and "an obligation requiring
-- the owner's manual action". Its commit claimed: "the vocabulary is closed by
-- a CHECK so a future writer cannot let a typed row default into looking
-- observed."
--
-- An independent review pointed out that this was false, and that the same line
-- proved it. The CHECK closes the VOCABULARY. The `DEFAULT 'foundry_observed'`
-- beside it is precisely what lets a typed row default into looking observed: a
-- writer that omits the column gets the strongest claim in the vocabulary,
-- silently. No gate could catch it either — `check-notnull-inserts.mjs` cannot
-- fire on a column that has a default.
--
-- TWO RULES MAKE THE SENTENCE TRUE.
--
-- The first is about what may be written. `foundry_observed` means a provider
-- Foundry watches told it, unprompted. This deployment watches exactly one such
-- channel: the Stripe webhook. So a row for any other provider claiming to have
-- been observed by Foundry is refused at insert. Adding a second watched
-- channel then means editing this rule — which is the visible edit the default
-- was hiding, and the point.
--
-- The second is about what may be changed. `provider` sits beside it in the
-- immutable list; `observed_how` was left out, so any UPDATE could quietly
-- promote an `owner_entered` row to `foundry_observed` and the CHECK would
-- allow it, because the value is in the vocabulary. A provenance column whose
-- whole purpose is to decide what silence means should be at least as fixed as
-- the provider it describes.
--
-- WHY NOT DROP THE DEFAULT. Removing a DEFAULT in SQLite is a table rebuild,
-- and a rebuild of a table carrying customer obligations is a far larger risk
-- than the one being closed. The trigger makes the wrong default unwritable,
-- which is the property that was actually wanted.
-- =============================================================================

CREATE TRIGGER experiment_fulfilment_observation_is_honest
BEFORE INSERT ON experiment_fulfilments
BEGIN
  SELECT RAISE(ABORT, 'experiment_fulfilment:not_a_channel_foundry_watches')
   WHERE NEW.observed_how = 'foundry_observed' AND NEW.provider <> 'stripe';
END;

CREATE TRIGGER experiment_fulfilment_observation_is_immutable
BEFORE UPDATE ON experiment_fulfilments
BEGIN
  SELECT RAISE(ABORT, 'experiment_fulfilment:observation_is_immutable')
   WHERE NEW.observed_how <> OLD.observed_how;
END;
