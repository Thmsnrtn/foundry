-- =============================================================================
-- Migration 173: an outbound action for a real integration is not born approved
--
-- `proposeAction` writes status='approved' and executes immediately when the
-- CALLER passes authorityLevel 0. Agents reach it with a level taken from their
-- own model output. Today that cannot produce a real effect, but only because
-- `integrationName` is set to the AGENT'S name, so execution falls through to a
-- log-only branch and never reaches an integration handler. The outbound
-- boundary is being held up by one parameter having a convenient value.
--
-- `queueEmail` was the same door with the integration hard-coded to 'resend'.
-- It had no caller and was deleted. This closes the shape rather than the one
-- function, so it cannot be reintroduced by a caller nobody is watching.
--
-- WHAT IS STILL ALLOWED, and why:
--   * The institution's own path writes 'approved' at birth WITH a
--     responsibility, and `assisted_action_plan_guard` checks the
--     responsibility, the exact live consent, and the scope in that same
--     insert. Approval there is not a claim; it is the result of the check.
--   * Anything born 'pending_approval' or any other status. Waiting for a
--     person is the normal case.
--   * An UPDATE to 'approved'. That is what `approveAction` does after a person
--     with ownership of the product said so, and it records who.
--
-- A row that is approved from birth, names no responsibility, and points at an
-- integration that can actually do something is authority asserted by the
-- caller. That is the one thing this boundary exists to refuse.
-- =============================================================================

CREATE TRIGGER outbound_action_birth_guard
BEFORE INSERT ON outbound_actions
WHEN NEW.status = 'approved' AND NEW.responsibility_id IS NULL
BEGIN
  SELECT RAISE(ABORT,'outbound_action:born_approved')
  WHERE NEW.integration_name IN ('resend');
END;
