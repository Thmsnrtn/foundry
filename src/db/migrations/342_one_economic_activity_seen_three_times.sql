-- =============================================================================
-- ONE ECONOMIC ACTIVITY, SEEN THREE TIMES.
--
-- The owner, 22 September 2026, simplifying Apex Micro's role: Private Foundry
-- "should connect directly, through appropriately authorized integrations, to
-- the external platforms and financial systems needed to operate my portfolio",
-- while Apex Micro "does not need to become a financial hub, universal
-- storefront, payment processor, or intermediary through which every portfolio
-- transaction passes". Etsy processes Etsy purchases and pays out to his bank;
-- Stripe processes eligible direct purchases and pays out to the appropriate
-- account; "Foundry privately observes and reconciles those separate economic
-- activities."
--
-- And earlier, on the ledger: "A marketplace sale, its eventual payout and the
-- receiving-account deposit may be different observations of one economic
-- activity. Do not duplicate revenue."
--
-- WHAT WAS ALREADY TRUE. A `charge` cannot be asserted without the provider's
-- own outcome event standing behind it (`charge_needs_source`, migration 313),
-- so a payout cannot be smuggled in as gross that way. The kinds table already
-- separates money in a provider's balance from money that has reached an
-- account a human could draw on.
--
-- WHAT WAS NOT. `owner_contribution` is `affects_cash = 1`, `in`, needs no
-- source event, and `moneyHeld` adds the owner term with no `affects_cash`
-- filter at all — deliberately, because it is the one term that records what
-- the owner actually moved. So an Etsy payout landing in his bank, recorded the
-- natural way somebody would record money arriving, counts the same gross
-- twice: once as the charge Etsy reported, once as a contribution. An
-- independent review found this with no reader for payouts yet built, which is
-- containment by absence rather than by rule.
--
-- THE RULE IS THE ONE THE WRITER ALREADY OBEYS. `money-place.ts` records the
-- owner's own movements with `provider = 'owner'`, and says why in as many
-- words: "The owner saying he moved money is a different kind of evidence from
-- Stripe saying so, and the provider column is what a reconciler would use to
-- ask the other side. `owner` is the other side." That was a convention held by
-- one call site. It is a law now, which is what makes it survive the second
-- call site.
--
-- AND A PAYOUT BELONGS TO A BALANCE, NEVER TO A SALE. The `source_event_id`
-- comment in 313 already said so — "a `payout` never does, because a payout is
-- about the balance rather than about any single sale" — and nothing enforced
-- it. Attributing a payout to one fulfilment would make that unit's economics
-- count its own revenue twice over.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not add a settlement link. The
-- ledger still cannot express "this payout settles these charges", because
-- `business_outcome_events` has `settles_ref` and `economic_events` has no
-- equivalent — and one TEXT column cannot name the many charges one payout
-- covers. That gap is real and is recorded in the maturity map against a named
-- trigger: the first provider payout this institution actually reads. Building
-- the representation now, with nothing to write it and nothing to read it,
-- would repeat the mistake this very wave was convened to repair — a vocabulary
-- shipped complete for a state nothing could enter.
-- =============================================================================

CREATE TRIGGER economic_event_whose_money_is_this
BEFORE INSERT ON economic_events
BEGIN
  -- The owner's own money is the owner's own evidence. A provider's payout
  -- recorded under these kinds is the same gross counted a second time.
  SELECT RAISE(ABORT, 'economic_event:owner_money_comes_from_the_owner')
   WHERE NEW.kind IN ('owner_contribution', 'owner_distribution')
     AND NEW.provider <> 'owner';

  -- And nothing else may claim to be the owner moving money.
  SELECT RAISE(ABORT, 'economic_event:only_owner_money_is_owners')
   WHERE NEW.provider = 'owner'
     AND NEW.kind NOT IN ('owner_contribution', 'owner_distribution');

  -- A payout is about the balance, not about any single sale.
  SELECT RAISE(ABORT, 'economic_event:a_payout_is_not_a_sale')
   WHERE NEW.kind IN ('payout', 'payout_reversed')
     AND (NEW.fulfilment_id IS NOT NULL OR NEW.source_event_id IS NOT NULL);
END;
