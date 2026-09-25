-- =============================================================================
-- AVAILABLE BY THE VENUE'S RULE, NOT OBSERVED BEING COLLECTED (Gate 1, case 4).
--
-- A marketplace order was recorded with a `delivery` event — "what they paid
-- for reached them" — stamped with the payment's own time, because Etsy makes
-- an instant download available the moment payment confirms. Nothing here saw
-- the buyer collect it. Provider-confirmed availability, a buyer's download,
-- and the buyer actually using the thing are three different claims, and this
-- vocabulary could only say the strongest of them.
--
-- `made_available` says the one that is true: the venue's own rule makes what
-- was bought available on payment. Its time is the payment's, because that is
-- when the rule makes it available — not an observation of anybody.
--
-- IT STAYS IN THE DELIVERY CLASS, BY THE OWNER'S DECISION (25 September 2026).
-- Asked whether an Etsy sale recorded this honestly should still move an
-- asset from experimental to earned, he answered: yes, labelled. So
-- `is_delivery = 1` — the earning trigger and the first-closure reading keep
-- treating it as the exchange completing — and every sentence built on it
-- says the file is available by the venue's rule and the download is not
-- observed.
-- =============================================================================

DROP TRIGGER business_outcome_event_kinds_constitutional_insert;

INSERT INTO business_outcome_event_kinds (kind, what_it_is, is_payment, is_delivery, sort_order) VALUES
  ('made_available', 'the venue makes what was bought available on payment, by its own rule; nobody here saw it collected', 0, 1, 12);

CREATE TRIGGER business_outcome_event_kinds_constitutional_insert
BEFORE INSERT ON business_outcome_event_kinds
BEGIN SELECT RAISE(ABORT,'business_outcome_event_kind:constitutional'); END;
