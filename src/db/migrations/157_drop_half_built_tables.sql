-- =============================================================================
-- Migration 157: five tables whose producing half never shipped
--
-- Each of these is read by live code and written by nothing — no INSERT
-- anywhere in the codebase, no trigger, no migration seed. The consuming half
-- shipped and the producing half did not, which reads as a feature and behaves
-- as an absence:
--
--   customer_notes       GET /v1/customers/:id returned `recent_notes` — always
--                        []. A documented API field that can only ever be empty
--                        is worse than an absent one: an integrator builds
--                        against it and concludes their customers have no notes.
--   chat_webhooks        the COO looked here for a founder-configured
--                        destination to deliver a proactive message to. There
--                        was no settings page, no API and no onboarding step
--                        that could create one, so the branch never fired.
--   decision_snooze_log  a nightly job deleted expired decision snoozes. There
--                        is no snooze button, route or API, so it swept an
--                        always-empty table.
--   daily_actions        read three times by `autonomous/autonomy-engine.ts` to
--                        compute a trust score, a tier action limit and a
--                        monthly value summary. That module had no importers at
--                        all.
--   ai_usage_log         read by `intelligence/financial-snapshot.ts` for the
--                        AI cost behind operating margin. That module had no
--                        callers either — and its test INSERTED rows into this
--                        table to make the assertion pass, which is a test
--                        manufacturing the evidence for its own subject. The
--                        real per-company AI cost is in `ai_daily_spend`, which
--                        the spend ceiling maintains.
--
-- Owner decision: remove the consuming halves rather than build the producing
-- ones. Anything genuinely wanted comes back as a whole feature, against a
-- ledger that is actually populated.
-- =============================================================================

DROP TABLE IF EXISTS customer_notes;
DROP TABLE IF EXISTS chat_webhooks;
DROP TABLE IF EXISTS decision_snooze_log;
DROP TABLE IF EXISTS daily_actions;
DROP TABLE IF EXISTS ai_usage_log;
