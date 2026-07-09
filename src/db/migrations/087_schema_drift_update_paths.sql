-- =============================================================================
-- Migration 087: Columns the UPDATE/read paths reference but the schema lacks
-- (schema-drift audit — UPDATE-SET sweep).
--
-- A scan of `UPDATE <table> SET <col>` sites found columns that don't exist.
-- Where the feature genuinely needs the column (it's written AND read), add it.
--
--   • key_results.progress — the OKR page both writes it (progress update) and
--     READS it (AVG(kr.progress), sort-by-progress in briefing-context). Without
--     the column the OKR list 500s on `AVG(kr.progress)`.
--   • experiments.outcome / winning_variant_id / concluded_at — the /api/v1
--     experiments "conclude" endpoint records these.
--   • action_executions.approval_note — voice-reply stores the approving
--     transcript when a founder approves an action by voice.
-- =============================================================================

ALTER TABLE key_results ADD COLUMN progress REAL;

ALTER TABLE experiments ADD COLUMN outcome TEXT;
ALTER TABLE experiments ADD COLUMN winning_variant_id TEXT;
ALTER TABLE experiments ADD COLUMN concluded_at DATETIME;

ALTER TABLE action_executions ADD COLUMN approval_note TEXT;
