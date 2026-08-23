-- =============================================================================
-- Migration 201: an approval cannot be recorded before it happens
--
-- `proposeAction` stamped `approved_by = 'auto'` and `approved_at` ONE HOUR IN
-- THE FUTURE at the moment an authority-level-1 action was proposed, while
-- `status` stayed 'pending_approval' and no scheduler existed to execute it.
-- The row said an approval had happened, at a time that had not arrived, by a
-- principal whose meaning in this codebase is "reached its notice window
-- without anybody objecting" — a window nothing was counting.
--
-- The writer is fixed. This closes the shape, because the next version of that
-- code will also be written by somebody who has a deadline in hand and a column
-- that will accept it.
--
-- `approved_at` answers WHEN THIS WAS APPROVED. A deadline, a window, a
-- scheduled time and an intention are all different facts, and none of them
-- belong in a column whose name is a past participle. A future value here is
-- not a rounding error; it is the record asserting something that has not
-- occurred.
--
-- Five minutes of tolerance, because these timestamps are written by
-- application processes whose clocks are not guaranteed to agree with the
-- database's to the second. It is a skew allowance, not a grace period: an hour
-- ahead was the defect and five minutes cannot express it.
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS outbound_action_approval_not_in_the_future_insert
BEFORE INSERT ON outbound_actions
WHEN NEW.approved_at IS NOT NULL
 AND datetime(NEW.approved_at) > datetime('now', '+5 minutes')
BEGIN
  SELECT RAISE(ABORT,'outbound_action:approved_in_the_future');
END;

CREATE TRIGGER IF NOT EXISTS outbound_action_approval_not_in_the_future_update
BEFORE UPDATE OF approved_at ON outbound_actions
WHEN NEW.approved_at IS NOT NULL
 AND datetime(NEW.approved_at) > datetime('now', '+5 minutes')
BEGIN
  SELECT RAISE(ABORT,'outbound_action:approved_in_the_future');
END;
