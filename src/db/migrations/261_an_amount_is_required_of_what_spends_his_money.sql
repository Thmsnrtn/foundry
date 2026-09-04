-- AN AMOUNT IS REQUIRED OF WHAT SPENDS HIS MONEY — AND ONLY OF THAT.
--
-- Migration 260 made every act on the `financial` rung declare its cost. The
-- property is right and the scope was wrong, and the test suite said so in the
-- clearest possible way: a refund stopped being allowed.
--
-- The financial rung holds two different things. `commerce` capabilities —
-- accept_payment, create_subscription, change_subscription, refund, set_price —
-- move the COMPANY'S money between it and its customers. They are consequential
-- and they do not draw on the allowance he set. The others — buy a domain, pay
-- for a service, run a paid experiment, engage a specialist — spend HIS money,
-- and those are the ones whose amount has to be known before the act, because
-- the allowance is what bounds them.
--
-- Stated on the capability rather than inferred from its family in code, so the
-- rule is inspectable in the same place as the rung it qualifies.

-- Constitutional, so seeding it is a migration act and not a runtime one: the
-- guard comes off for this statement and goes straight back on.
DROP TRIGGER capabilities_constitutional_update;

ALTER TABLE capabilities ADD COLUMN draws_on_allowance INTEGER NOT NULL DEFAULT 0;

UPDATE capabilities SET draws_on_allowance = 1
 WHERE capability_key IN (
   'register_domain', 'buy_service', 'run_paid_experiment', 'commission_specialist');

CREATE TRIGGER capabilities_constitutional_update BEFORE UPDATE ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

-- AN APPEND-ONLY LEDGER STILL HAS TO BE ERASABLE.
--
-- `asset_money_is_not_deleted` refused every delete, which made the money ledger
-- a table erasure could never clear — so an owner erasing a company would have
-- been told it completed while a record of his spending survived. Caught by the
-- gate that exists for exactly this, which is the second time this session that
-- an immutability guarantee and an erasure guarantee have met.
--
-- The existing idiom decides it: immutable while the company lives, deletable
-- once that company is going. Same shape as `proposed_act_no_delete`.
DROP TRIGGER asset_money_is_not_deleted;

CREATE TRIGGER asset_money_is_not_deleted
BEFORE DELETE ON asset_money_spent
BEGIN
  SELECT RAISE(ABORT,'asset_money:append_only') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;
