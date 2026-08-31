-- =============================================================================
-- Migration 215: eleven tables nothing ever wrote
--
-- Each of these was created by a migration and then referenced by nothing —
-- no INSERT, no SELECT, no service, no route, no job, in the whole of `src/`.
-- Not written and unread, which is one defect; never written at all, which is
-- schema that describes an intention nobody carried out.
--
--   agent_message_threads          031. Threading lives on `agent_messages`.
--   competitor_feature_tracking    029. The weekly scan writes `competitors`
--   competitor_pricing_snapshots   029.   and `competitive_signals`.
--   custom_webhook_sources         034. Inbound webhooks arrive through
--                                       `product_webhooks` and `ingest`.
--   experiment_holdouts            035. The engine has no holdout arm.
--   experiment_results_timeline    035. Results are `experiments.results_json`.
--   idea_validations               009.
--   investor_annotations           011.
--   playbook_exports               012. No export destination exists.
--   sector_remediation_templates   004. Sector config is
--                                       `sector_scoring_overrides`.
--   strategic_plans                023.
--
-- THE OWNER'S RULE FROM MIGRATION 157 APPLIES UNCHANGED: remove the consuming
-- halves rather than build the producing ones, and anything genuinely wanted
-- comes back as a whole feature against a ledger that is actually populated.
-- Here there is not even a consuming half. Every one of these is empty in
-- every environment, because no code path could ever have put a row in one.
--
-- Nothing on the public surfaces depends on any of them. "Competitive
-- intelligence — weekly competitor scans" is the one adjacent claim, and it is
-- served by `competitiveScan` on `0 6 * * 0` writing the two tables that stay.
-- =============================================================================

DROP TABLE IF EXISTS agent_message_threads;
DROP TABLE IF EXISTS competitor_feature_tracking;
DROP TABLE IF EXISTS competitor_pricing_snapshots;
DROP TABLE IF EXISTS custom_webhook_sources;
DROP TABLE IF EXISTS experiment_holdouts;
DROP TABLE IF EXISTS experiment_results_timeline;
DROP TABLE IF EXISTS idea_validations;
DROP TABLE IF EXISTS investor_annotations;
DROP TABLE IF EXISTS playbook_exports;
DROP TABLE IF EXISTS sector_remediation_templates;
DROP TABLE IF EXISTS strategic_plans;
