-- =============================================================================
-- AN ACT DOES NOT OUTLIVE THE CHARTER THAT DECIDED IT (Roadmap 2027 R24).
--
-- A charter's yes is the owner's yes for the term they signed, and no longer.
-- Migration 319 checked that the charter was live when it decided an act, but
-- not how long the act it decided would last, so an act decided on the last
-- day of a thirty-day term could reach three weeks past it. The hand now sizes
-- every act inside the term (act-window.ts); this is the row saying no when a
-- caller does not. An act the owner decides is theirs, and is not bounded here.
--
-- A new trigger, not a rewrite of 319's guard: that guard's clauses and their
-- error precedence stay exactly as they were.
-- =============================================================================
CREATE TRIGGER proposed_act_charter_term_guard
BEFORE UPDATE ON proposed_acts
WHEN NEW.decision IS NOT NULL AND OLD.decision IS NULL AND NEW.decided_by LIKE 'charter:%'
BEGIN
  SELECT RAISE(ABORT,'proposed_act:outlives_its_charter')
    WHERE datetime(NEW.expires_at) > (SELECT datetime(e.expires_at) FROM portfolio_envelopes e
                                        WHERE 'charter:' || e.id = NEW.decided_by);
END;
