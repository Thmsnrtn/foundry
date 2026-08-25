-- =============================================================================
-- Migration 217: a message that had not been sent yet, at the top of the queue
--
-- `inbound_customer_messages.source_observed_at` is the SOURCE'S OWN CLOCK —
-- the time the customer's message arrived at whatever system is forwarding it.
-- Foundry preserves it separately from `received_at` on purpose: a delayed
-- delivery is late, not recent.
--
-- IT IS ALSO THE ORDER OF THE FOUNDER'S QUEUE. `getMessagesForResponsibility`
-- reads `ORDER BY datetime(m.source_observed_at) DESC ... LIMIT ?`, so the
-- number an outside system supplies decides which messages a founder is shown
-- and which fall off the end. The intake refused a value that was not a time at
-- all; it accepted any time, including times that have not happened. One
-- message stamped 2099 sits at the top of that queue forever and pushes a real
-- customer out of the LIMIT — and nothing about the founder's screen would say
-- why.
--
-- This is migration 201 in a different place: an approval dated in the future
-- was the same defect against `outbound_actions.approved_at`. The difference is
-- whose clock it is. 201 allows five minutes because the timestamp is written
-- by Foundry's own processes, whose clocks are not guaranteed to agree with the
-- database's to the second. This one comes from a machine Foundry does not run,
-- so the allowance is fifteen minutes — enough for ordinary drift on somebody
-- else's server, and deliberately far short of a timezone mistake, which is
-- hours and which the integration's author should be told about rather than
-- have absorbed silently.
--
-- IT IS A SKEW ALLOWANCE, NOT A GRACE PERIOD. Both halves are here for the
-- same reason as everywhere else on this branch: the application refuses with a
-- diagnosis the channel's owner can read, and the database refuses whatever the
-- writer.
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS inbound_message_not_observed_in_the_future_insert
BEFORE INSERT ON inbound_customer_messages
WHEN NEW.source_observed_at IS NOT NULL
 AND datetime(NEW.source_observed_at) > datetime('now', '+15 minutes')
BEGIN
  SELECT RAISE(ABORT,'inbound_customer_message:observed_in_the_future');
END;

CREATE TRIGGER IF NOT EXISTS inbound_message_not_observed_in_the_future_update
BEFORE UPDATE OF source_observed_at ON inbound_customer_messages
WHEN NEW.source_observed_at IS NOT NULL
 AND datetime(NEW.source_observed_at) > datetime('now', '+15 minutes')
BEGIN
  SELECT RAISE(ABORT,'inbound_customer_message:observed_in_the_future');
END;
