-- =============================================================================
-- A HEALTH SCORE NOBODY COMPUTED.
--
-- `weekly_compressed_briefs.health_score` is NOT NULL, so the weekly brief — the
-- one page a founder is meant to be able to read in three minutes — could not
-- record that the company's health was not known. It always had a number, and
-- when nothing had scored the company that number was 50.
--
-- The chain behind it: five agents wrote `parsed.domain_health_score ?? 50` into
-- a field their own type declares OPTIONAL ("if provided");
-- `computeHealthScore` then counted every unscored agent AT 50 in a weighted
-- average and wrote the result to `products.health_score`; the dashboard, the
-- board packet and this table read it. Six layers, and the only one that told
-- the truth was `SCPBriefing.health_score`, declared `number | null` with the
-- briefing rendering "N/A" — a reader that was right about a value its producer
-- could not return.
--
-- 50 is the middle of every bar this system draws. An unmeasured company
-- rendered as exactly average, in amber, beside companies that were measured.
--
-- SQLite cannot drop a NOT NULL constraint in place, so the table is rebuilt.
-- It is a weekly cache with a UNIQUE(product_id, week_of) key and every row is
-- regenerable, but the rows are copied anyway: a brief a founder has already
-- read should not vanish because the schema changed underneath it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS weekly_compressed_briefs_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  week_of TEXT NOT NULL,

  -- Nullable: null means nothing has scored this company, which is different
  -- from a low score and must not be rendered as one.
  health_score INTEGER,
  health_trend TEXT NOT NULL CHECK (health_trend IN ('improving','stable','declining')),
  one_sentence_status TEXT NOT NULL,
  top_3_this_week TEXT NOT NULL DEFAULT '[]',
  metrics_delta_json TEXT NOT NULL DEFAULT '{}',
  agent_consensus TEXT,
  one_decision_to_make TEXT,
  estimated_read_minutes REAL NOT NULL DEFAULT 3.0,

  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, week_of)
);

INSERT INTO weekly_compressed_briefs_new (
  id, product_id, week_of, health_score, health_trend, one_sentence_status,
  top_3_this_week, metrics_delta_json, agent_consensus, one_decision_to_make,
  estimated_read_minutes, generated_at
)
SELECT
  id, product_id, week_of, health_score, health_trend, one_sentence_status,
  top_3_this_week, metrics_delta_json, agent_consensus, one_decision_to_make,
  estimated_read_minutes, generated_at
FROM weekly_compressed_briefs;

DROP TABLE weekly_compressed_briefs;
ALTER TABLE weekly_compressed_briefs_new RENAME TO weekly_compressed_briefs;

-- ─── AND THE 50 WAS IN THE SCHEMA, NOT ONLY IN THE CODE ──────────────────────
--
-- `agent_instances.domain_health_score INTEGER DEFAULT 50`, and the provisioner
-- did not even rely on the default: it wrote the literal 50 for every agent of
-- every company at provisioning time. So an agent's domain health was 50 before
-- it had run once, and the five `?? 50` expressions downstream were keeping
-- faith with a column that already said 50.
--
-- `products.health_score INTEGER DEFAULT 0` — every company started at health
-- zero, the worst there is, before anything had looked at it. The board packet
-- read that column.
--
-- Both defaults go. Values are preserved through a new column rather than a
-- full table rebuild, because `products` and `agent_instances` are central and
-- a rebuild is a bigger risk than this change is worth.
--
-- THE BACKFILLS ARE EXACT, NOT GUESSES:
--   • `products.health_score = 0` becomes NULL. A genuine computed 0 requires
--     every weighted agent to score 0, which no run has produced; every 0 in
--     this column is the default firing on insert.
--   • `agent_instances.domain_health_score = 50` becomes NULL ONLY where
--     `total_sessions = 0`. An agent that has never run cannot have been
--     scored, so those 50s are provisioning and nothing else. A 50 on an agent
--     that HAS run is left alone: it may be a real score, and overwriting a
--     measurement to tidy a default would be the same defect in reverse.

ALTER TABLE products ADD COLUMN health_score_v2 INTEGER;
UPDATE products SET health_score_v2 = CASE WHEN health_score = 0 THEN NULL ELSE health_score END;
ALTER TABLE products DROP COLUMN health_score;
ALTER TABLE products RENAME COLUMN health_score_v2 TO health_score;

ALTER TABLE agent_instances ADD COLUMN domain_health_score_v2 INTEGER;
UPDATE agent_instances
   SET domain_health_score_v2 = CASE
         WHEN domain_health_score = 50 AND COALESCE(total_sessions, 0) = 0 THEN NULL
         ELSE domain_health_score END;
ALTER TABLE agent_instances DROP COLUMN domain_health_score;
ALTER TABLE agent_instances RENAME COLUMN domain_health_score_v2 TO domain_health_score;
