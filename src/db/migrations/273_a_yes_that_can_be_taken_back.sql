-- A YES THAT CAN BE TAKEN BACK.
--
-- Acquiring a capability was a one-way door. The owner could say yes or no, and
-- after yes there was no row anywhere that could mean "not any more" — the
-- provider stayed in the fabric and the institution went on believing it had
-- something the owner had since stopped paying for.
--
-- That matters most exactly where the decision costs money. A card that asks
-- for a subscription and cannot say what happens when he changes his mind is
-- asking him to treat a recurring commitment as permanent, which is the one
-- thing this institution is not allowed to do to him.
--
-- WHAT WITHDRAWAL CAN AND CANNOT REACH. It stops the institution using the
-- provider: the row moves to `unavailable` and everything that asks what it
-- would take gets the truth from that moment on. It does not cancel anything at
-- the provider. A subscription lives in the owner's own account with the
-- provider and only he can end it, and the card says so rather than implying a
-- reach this has never had.

ALTER TABLE capability_acquisitions ADD COLUMN withdrawn_at TEXT;
ALTER TABLE capability_acquisitions ADD COLUMN withdraw_reason TEXT;

-- Withdrawal is a decision about a decision: there must have been one.
CREATE TRIGGER capability_acquisition_withdrawal_needs_a_yes
BEFORE UPDATE OF withdrawn_at ON capability_acquisitions
WHEN NEW.withdrawn_at IS NOT NULL AND OLD.decision IS NOT 'approved'
BEGIN SELECT RAISE(ABORT,'capability_acquisition:nothing_to_withdraw'); END;
