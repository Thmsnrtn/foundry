-- =============================================================================
-- Migration 211: four `lifecycle_state` columns for badges that are not drawn
--
-- `groupedSidebar` renders exactly one badge — the count beside "Decide" — and
-- has since the nav was cut to five doors under a comment that says the point
-- is "nothing shouting". The other four numbers in `NavBadges` were:
--
--   computed for every product every six hours by `nav_badge_refresh`,
--   written into these columns,
--   read back on every dashboard page load by `getLayoutContext`,
--   assembled into a struct,
--   and handed to a layout that ignored them.
--
-- An audit's age, unacknowledged competitive signals, unseen milestones and
-- open remediation PRs, counted on a schedule for a badge that does not exist.
--
-- THE COLUMNS GO RATHER THAN THE BADGES COMING BACK. A nav that deliberately
-- stopped shouting is a decision; reviving four badges to justify the
-- arithmetic behind them would be the arithmetic deciding the design. If any of
-- these is wanted on the sidebar it comes back as a whole feature, and this
-- migration is what it will have to undo — which is the honest cost.
--
-- `pending_decisions_count` stays: it is the badge that renders.
-- `dna_completion_pct` stays: `wisdom/dna.ts` both writes and reads it, and the
-- audit page shows it. What changed there is that the job is no longer a SECOND
-- writer of the same number.
--
-- SQLite drops a column in place when no index or trigger references it. The
-- only index on this table is on `risk_state`, and there are no triggers.
-- =============================================================================

ALTER TABLE lifecycle_state DROP COLUMN audit_age_days;
ALTER TABLE lifecycle_state DROP COLUMN unread_competitive_signals;
ALTER TABLE lifecycle_state DROP COLUMN open_remediation_prs;
ALTER TABLE lifecycle_state DROP COLUMN unread_milestones;
