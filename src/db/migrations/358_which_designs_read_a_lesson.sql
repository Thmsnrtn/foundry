-- =============================================================================
-- WHICH LATER DESIGNS READ A LESSON.
--
-- Integrated plan §7: a lesson keeps "past decisions that used it". Lessons
-- already carried their source (the test) and their invalidator (the test's
-- own outcome). What nothing kept was which later designs had the lesson in
-- front of them, so a lesson that turned out wrong could not say what it had
-- already influenced.
--
-- One row per lesson a design's record carried, written when the design is
-- composed. A design never reads itself, and nothing rewrites a row.
-- =============================================================================

CREATE TABLE lessons_read (
  design_experiment_id TEXT NOT NULL REFERENCES venture_experiments(id),
  lesson_experiment_id TEXT NOT NULL REFERENCES venture_experiments(id),
  founder_id           TEXT NOT NULL REFERENCES founders(id),
  read_at              TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (design_experiment_id, lesson_experiment_id),
  CHECK (design_experiment_id <> lesson_experiment_id)
);

CREATE INDEX lessons_read_by_lesson ON lessons_read (lesson_experiment_id, read_at);

CREATE TRIGGER lessons_read_is_as_read
BEFORE UPDATE ON lessons_read
BEGIN SELECT RAISE(ABORT, 'lessons_read:read_is_read'); END;
