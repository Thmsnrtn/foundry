-- =============================================================================
-- THINKING ABOUT THE SAME THING AGAIN.
--
-- WHAT PRODUCTION SHOWED. Between 1 and 14 September 2026 this institution
-- settled 1,099 model calls costing $14.88. One scheduled loop accounts for
-- more than half of it: every night at 04:00 UTC, nine agents across three
-- operating companies are asked to review their recent sessions and propose
-- improvements — about fifty-four calls, roughly eighty-three cents, every
-- night since 3 September.
--
-- In that time it has produced no change at all. `agent_evolution_versions`
-- holds thirty-six rows and every one of them is an initial_provision written
-- on the day the agents were created; `evolved_prompts` is empty. Eleven
-- nights, about six hundred calls, and not one altered anything.
--
-- Worse than the waste: the same five sessions are read again each night for
-- most of those agents, because no new session has completed. The institution
-- is paying to re-read an unchanged document and ask an unchanged question.
--
-- WHAT THIS TABLE IS FOR. Not a cache of answers — a record of OCCASIONS, so
-- that a loop can answer three questions before it spends anything:
--
--   has anything changed since I last considered this?  (over_digest)
--   was there anything to consider at all?              (over_digest of nothing)
--   has considering this ever once changed anything?    (changed_something)
--
-- A "no" to the first is a reason to sleep. A long run of "no" to the third is
-- a reason to ask less often — the crystallisation of a repeated question into
-- a settled answer, which is cheaper than the question and just as true.
--
-- APPEND-ONLY BY CONVENTION, NOT BY TRIGGER. This is an operational record of
-- what the institution chose to think about; it holds no personal data, no
-- money and no authority, and a row that turns out to be wrong is simply
-- followed by a truer one. Guarding it would cost more than it protects.
-- =============================================================================

CREATE TABLE IF NOT EXISTS cognition_occasions (
  id                TEXT PRIMARY KEY,

  -- WHAT KIND OF THINKING. A stable name, chosen by the caller, that groups
  -- occasions of the same question: 'agent_evolution_synthesis'. Never a
  -- model name and never a prompt — the question, not how it was asked.
  cognition         TEXT NOT NULL CHECK (trim(cognition) <> ''),

  -- WHAT IT WAS ABOUT. The subject that makes two occasions comparable: a
  -- product and an agent, an experiment, a company. Opaque here.
  about             TEXT NOT NULL CHECK (trim(about) <> ''),

  -- WHAT IT WAS OVER. A digest of the inputs, computed by the caller from the
  -- records it would read. Two occasions with the same digest were asked the
  -- same question about the same material, and the second one could not have
  -- learned anything the first did not.
  over_digest       TEXT NOT NULL CHECK (trim(over_digest) <> ''),

  at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- DID IT ACTUALLY THINK. 0 means it slept, and `because` says why in words
  -- the owner can read. A slept occasion still records its digest, so the next
  -- one can tell whether the material has moved since.
  thought           INTEGER NOT NULL CHECK (thought IN (0, 1)),
  because           TEXT,

  -- DID IT CHANGE ANYTHING. NULL when it slept — an occasion that did not
  -- happen neither changed nor failed to change anything, and recording a 0
  -- there would poison the very count that decides whether to sleep again.
  changed_something INTEGER CHECK (changed_something IN (0, 1)),

  -- WHAT IT COST, in cents, when it thought. Settled where the caller knows
  -- it; NULL where it does not, which is honest rather than a zero.
  cents             REAL
);

CREATE INDEX IF NOT EXISTS idx_cognition_occasions_subject
  ON cognition_occasions(cognition, about, at DESC);

-- READING WHAT ONE KIND OF THINKING COSTS ACROSS EVERYTHING IT IS ABOUT,
-- which is the question "what am I paying to think about" is actually asking.
CREATE INDEX IF NOT EXISTS idx_cognition_occasions_kind
  ON cognition_occasions(cognition, at DESC);
