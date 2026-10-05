-- =============================================================================
-- THE MODEL DOOR'S CREDIT, READ ONCE A DAY (Roadmap 2027 R33).
--
-- Every thinking routine reaches the model through one paid account, and
-- nothing read how much credit was left: the first sign was the forge and
-- discovery going quiet. One row per reading, written by the hourly pulse at
-- most once a UTC day. A failed reading is a row that says so (ok = 0), never
-- a balance of zero.
-- =============================================================================
CREATE TABLE IF NOT EXISTS model_door_readings (
  id TEXT PRIMARY KEY,
  read_on TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  remaining_usd REAL,
  source TEXT CHECK (source IS NULL OR source IN ('account', 'key')),
  detail TEXT,
  CHECK (ok = 1 OR remaining_usd IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_door_readings_day ON model_door_readings(read_on);
