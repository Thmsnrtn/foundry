-- =============================================================================
-- Migration 210: `decisions.decided_at` and `decisions.outcome_measured_at`
-- held two time formats at once
--
-- SQLite has no date type. A timestamp is TEXT, and two conventions were both
-- in use on these two columns:
--
--   'YYYY-MM-DD HH:MM:SS'          from `datetime('now')` — the execution path
--                                  (`decisions/actions.ts`), the ROI outcome
--                                  tracker and the accuracy tracker.
--   'YYYY-MM-DDTHH:MM:SS.sssZ'     from JavaScript `toISOString()` — the
--                                  decision queue's approve and record-outcome
--                                  paths.
--
-- Both are UTC, so no clock shifts here; the damage is that they are compared
-- as TEXT. At index 10 a space (0x20) sorts before 'T' (0x54), so:
--
--   * ORDER BY decided_at interleaved the two paths wrongly — a decision the
--     founder approved always sorted after one Foundry executed in the same
--     second, and usually after ones from later in the day.
--   * MAX(decided_at) preferred whichever row was written the JavaScript way.
--   * `decided_at >= datetime('now','-7 days')` — the founder's weekly outcome
--     card — excluded every founder-approved decision on the boundary date.
--
-- The writers are normalised on `datetime('now')` in the same commit, which is
-- what the columns' neighbours already used (`follow_up_at` was already
-- `datetime('now','+30 days')` on the very statement that wrote the ISO
-- `decided_at`).
--
-- THE REPAIR IS EXACT AND NARROW. A value is rewritten only if it carries the
-- ISO marker at position 11 — anything else is left untouched — and the
-- rewrite keeps the same instant: the date, a space, the time to the second.
-- Sub-second precision is dropped, which is what the other convention has
-- always stored.
-- =============================================================================

UPDATE decisions
   SET decided_at = REPLACE(SUBSTR(decided_at, 1, 19), 'T', ' ')
 WHERE decided_at IS NOT NULL AND SUBSTR(decided_at, 11, 1) = 'T';

UPDATE decisions
   SET outcome_measured_at = REPLACE(SUBSTR(outcome_measured_at, 1, 19), 'T', ' ')
 WHERE outcome_measured_at IS NOT NULL AND SUBSTR(outcome_measured_at, 11, 1) = 'T';
