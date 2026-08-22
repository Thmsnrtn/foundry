-- =============================================================================
-- AN AUDIT TRAIL WITH NO ENTRIES, AND NOTHING THAT COULD MAKE ONE.
--
-- Migration 007 created `audit_trail` under the header "Every mutation in the
-- system should be traceable to a person or job", with columns for the table,
-- the row, the action, the before and after values, who changed it and by what
-- kind of principal. Nothing has ever written a row. No TypeScript, no trigger,
-- no job. The only mention of the name anywhere in the codebase was a line in
-- the privacy classification recording that it is "created by migration 007 and
-- never written or read by any code path".
--
-- AN EMPTY TABLE NAMED FOR A CONTROL IS A CLAIM OF A CONTROL. That is the one
-- thing this institution may not make. A reader of the schema — a person, an
-- auditor, a future agent deciding whether a mutation is traceable — finds a
-- universal traceability guarantee stated in the DDL and no way to learn from
-- the schema alone that it has never held anything.
--
-- What actually records what happened, and does so honestly: `audit_log`
-- (seven writers), `agent_audit_log` (five), `strategic_decisions_log` (five),
-- and the authority and approval ledgers that the institution's own gates read.
-- Traceability in this system is per-decision and per-authority, recorded where
-- the decision is made. It is not, and has never been, a universal row-level
-- shadow of every mutation.
--
-- Found by asking which tables no code can reach in EITHER direction — a
-- population neither `check-writerless-tables` nor `check-unread-tables` can
-- see, because each starts from a half this table does not have. Fifteen tables
-- were in that position. `check-unreferenced-tables.mjs` now holds the rest as
-- a ratchet that may only fall; this one is removed rather than baselined
-- because it is the one that makes a claim.
--
-- Nothing is preserved. There are no rows to preserve.
-- =============================================================================

DROP INDEX IF EXISTS idx_audit_trail_table_row;
DROP INDEX IF EXISTS idx_audit_trail_created;
DROP INDEX IF EXISTS idx_audit_trail_changed_by;
DROP TABLE IF EXISTS audit_trail;
