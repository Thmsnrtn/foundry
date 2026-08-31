-- =============================================================================
-- Migration 155: a company on its way out stops acting
--
-- Scheduling a deletion changed nothing about what Foundry did. For thirty days
-- the agents kept running, mail kept going to the founder's customers, the AI
-- budget kept being spent, and new data kept accruing that was then deleted.
-- Foundry was spending a leaving customer's money and mailing their customers
-- on the way out.
--
-- The owner's decision: treat a scheduled erasure as a third pause axis. No
-- outward effects, no spend, no autonomous acts. Reads, the dashboard and the
-- public API's writes keep working — the window exists so the founder can
-- change their mind, and a company locked out of its own data for thirty days
-- is a punishment for clicking a button that is still reversible.
--
-- WHY A COLUMN AND NOT A JOIN. `checkKillSwitch` and `operatingProduct()` are
-- on the hot path of every outward effect and every work selector; making them
-- correlate against an event log per call is the kind of cost that gets
-- optimised away later by someone who does not know what it was for. The two
-- functions that write the event — scheduleDataDeletion and cancelDataDeletion
-- — are the only writers of this column, and a test asserts the two agree.
--
-- Backfilled from the ledger so a company that scheduled erasure before this
-- migration is paused too, and one that already cancelled is not.
-- =============================================================================

ALTER TABLE products ADD COLUMN erasure_scheduled_at DATETIME;

UPDATE products SET erasure_scheduled_at = (
  SELECT MAX(s.created_at) FROM agent_audit_log s
   WHERE s.event_type = 'data_deletion_scheduled' AND s.target_id = products.id
)
WHERE EXISTS (
  SELECT 1 FROM agent_audit_log s
   WHERE s.event_type = 'data_deletion_scheduled' AND s.target_id = products.id
     AND NOT EXISTS (
       SELECT 1 FROM agent_audit_log d
        WHERE d.event_type = 'data_deletion_completed' AND d.target_id = products.id)
     AND NOT EXISTS (
       SELECT 1 FROM agent_audit_log x
        WHERE x.event_type = 'data_deletion_cancelled' AND x.target_id = products.id
          AND x.created_at >= s.created_at)
);
