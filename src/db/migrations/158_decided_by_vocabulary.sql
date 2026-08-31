-- =============================================================================
-- Migration 158: the values `decided_by` actually has
--
-- Migration 001 wrote this column with a comment naming its vocabulary:
--
--   decided_by TEXT -- founder, system_gate_0, system_gate_1
--
-- Two of those three have never been written by anything. The values the code
-- writes are 'founder' and 'second_self'. And the comment was not inert: the
-- Letter — the institution's daily statement to the founder about what it did
-- for them — asks for
--
--   AND decided_by IN ('system_gate_0', 'second_self')
--
-- so half of "what Foundry handled" has always been a term that cannot match.
-- Nothing was lost, because the autopilot resolves gate-<=1 decisions as
-- 'second_self' and that half works. But the query has been carrying a dead
-- term since the beginning, and the reason it survived review is that the
-- schema comment said it was real.
--
-- A COMMENT IS NOT A VOCABULARY. This column is a discriminated KIND, and it is
-- load-bearing: `getShadowStats` measures agreement on founder-decided rows,
-- `processOutcomeFeedback` demotes a category only on autopilot-decided ones,
-- the trust ledger and the wellbeing pulse both filter on it. A closed set that
-- the database does not enforce is a set the next query can miss by one word —
-- which is precisely what happened, four separate times in this campaign
-- (pending_approval, reviewed, resolved, system_gate_0).
--
-- With a CHECK it becomes enforceable AND falls under check-check-vocabularies,
-- which fails the build on any literal the column would refuse. That is the
-- difference between a rule that is documented and a rule that is enforced.
--
-- NULL stays permitted: a pending decision has not been decided by anybody, and
-- an undo sets it back to NULL deliberately.
--
-- Table rebuild, as SQLite cannot ALTER a CHECK. Same shape migration 147 used
-- for `hypotheses`: build beside, copy, drop, rename, restore the indexes.
-- =============================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS decisions_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  category TEXT CHECK(category IN ('urgent', 'strategic', 'product', 'marketing', 'informational')),
  gate INTEGER CHECK(gate BETWEEN 0 AND 4),
  what TEXT NOT NULL,
  why_now TEXT NOT NULL,
  context TEXT,
  options TEXT,
  recommendation TEXT,
  impact TEXT,
  scenario_model TEXT,
  deadline DATETIME,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'executed', 'expired')),
  chosen_option TEXT,
  outcome TEXT,
  outcome_measured_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME,
  decided_by TEXT CHECK(decided_by IN ('founder', 'second_self')),
  resolution_reasoning TEXT,
  wisdom_context_used TEXT,
  follow_up_at DATETIME,
  outcome_valence INTEGER,
  deleted_at DATETIME,
  architecture_class INTEGER DEFAULT 0,
  frozen_at TEXT,
  autopilot_counted INTEGER NOT NULL DEFAULT 0,
  decided_by_founder_id TEXT
);

-- Any historical row carrying a value outside the set becomes NULL rather than
-- blocking the migration. NULL means "not recorded", which is the truth about a
-- row whose marker names a decider that never existed.
--
-- The CASE is untestable in the suite — a fresh database has no pre-migration
-- rows to convert — and it is deliberately the FAIL-LOUD side of that gap:
-- without it, a row outside the set would violate the new CHECK and abort the
-- migration rather than corrupt anything. The conversion buys a clean upgrade,
-- not safety; the safety is that the alternative stops.
INSERT INTO decisions_new
SELECT id, product_id, category, gate, what, why_now, context, options,
       recommendation, impact, scenario_model, deadline, status, chosen_option,
       outcome, outcome_measured_at, created_at, decided_at,
       CASE WHEN decided_by IN ('founder', 'second_self') THEN decided_by ELSE NULL END,
       resolution_reasoning, wisdom_context_used, follow_up_at, outcome_valence,
       deleted_at, architecture_class, frozen_at, autopilot_counted,
       decided_by_founder_id
  FROM decisions;

DROP TABLE decisions;
ALTER TABLE decisions_new RENAME TO decisions;

CREATE INDEX IF NOT EXISTS idx_decisions_product ON decisions(product_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);
CREATE INDEX IF NOT EXISTS idx_decisions_product_status ON decisions(product_id, status);
CREATE INDEX IF NOT EXISTS idx_decisions_gate ON decisions(gate);
CREATE INDEX IF NOT EXISTS idx_decisions_product_gate ON decisions(product_id, gate);

PRAGMA foreign_keys=ON;
