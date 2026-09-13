-- =============================================================================
-- THE DATA HALF OF THE COMMERCIAL DELETION.
--
-- Fifty-three service modules were deleted in this pass — every module the
-- reachability gate could reach from no entry point at all. That emptied the
-- unreachable-modules baseline and pinned it at zero, and it left thirty-one
-- tables with nothing on either side of them.
--
-- These are not tables that merely went quiet. `check-unreferenced-tables` is
-- the gate that sees them, and its rule is the strict one: no INSERT, no
-- UPDATE, no DELETE, no SELECT, no trigger body, no foreign key held by a
-- table that stays. A table nobody can touch is still schema to migrate, still
-- an erasure question to answer, and its NAME is still a claim.
--
-- Three of them were not silent, and had to be dealt with in code first,
-- because live modules were still READING them:
--
--   `founder_psychology_insights` — `ai/calibration.ts` read active patterns
--     from it to shape the founder's system prompt. Its writer was
--     `intelligence/psychology.ts`. Auto-calibration now derives only the
--     sector agreement, which it can actually observe.
--
--   `fundraising_scores` — `network/failure-library.ts` counted rows in it to
--     decide `no_fundraising_activity`, a criterion of the critical Runway
--     Crisis pattern. With no writer the count was permanently zero, so the
--     criterion permanently MATCHED and put "No fundraising activity recorded
--     in the last 90 days" in front of a founder as an observation. An absence
--     of measurement reported as an absence of activity. The pattern now
--     matches on runway, which is a thing the institution can see.
--
--   `recommendation_outcomes` — the source of `scp/roi/calculator.ts`, run
--     monthly by `scp_roi_monthly` over every operating product, writing
--     `roi_monthly_summaries`, whose only reader was the `/roi` page deleted
--     with the commercial product. Both ends gone: a job paying a round-trip
--     per company per month to record that nothing had been measured.
--
-- `business_model_profile` was the mirror image — written by the demo seeder
-- and read by `intelligence/business-model.ts`. The reader went; the seed
-- write goes with the table.
--
-- Order is foreign-key order. `playbook_exports` holds the only FK into this
-- set, so it goes before its parent; nothing outside the set points in.
-- =============================================================================

DROP TABLE IF EXISTS playbook_exports;
DROP TABLE IF EXISTS playbooks;

DROP TABLE IF EXISTS acquirer_signals;
DROP TABLE IF EXISTS anomalies;
DROP TABLE IF EXISTS board_decks;
DROP TABLE IF EXISTS board_packets;
DROP TABLE IF EXISTS business_model_profile;
DROP TABLE IF EXISTS calendar_allocations;
DROP TABLE IF EXISTS cap_table_scenarios;
DROP TABLE IF EXISTS cohort_patterns;
DROP TABLE IF EXISTS competitor_job_signals;
DROP TABLE IF EXISTS decision_counterfactuals;
DROP TABLE IF EXISTS decision_quality_scores;
DROP TABLE IF EXISTS event_rules;
DROP TABLE IF EXISTS event_stream;
DROP TABLE IF EXISTS experiment_events;
DROP TABLE IF EXISTS financial_scenarios;
DROP TABLE IF EXISTS founder_preferences;
DROP TABLE IF EXISTS founder_psychology_insights;
DROP TABLE IF EXISTS fundraising_scores;
DROP TABLE IF EXISTS integration_health;
DROP TABLE IF EXISTS ma_readiness_scores;
DROP TABLE IF EXISTS memory_edges;
DROP TABLE IF EXISTS recommendation_outcomes;
DROP TABLE IF EXISTS roi_monthly_summaries;
DROP TABLE IF EXISTS taste_journals;
DROP TABLE IF EXISTS term_sheet_models;
DROP TABLE IF EXISTS unit_economics_snapshots;
DROP TABLE IF EXISTS value_delivery_metrics;
DROP TABLE IF EXISTS vendor_recommendations;
DROP TABLE IF EXISTS web_audit_results;

-- The second ring, found by running the gates again rather than by guessing.
-- `memory_nodes` was held up only by the two tables above that point at it —
-- `memory_edges` and `decision_counterfactuals` — so it becomes unreachable in
-- both directions the moment they go. It is dropped last for that reason.
DROP TABLE IF EXISTS memory_nodes;
