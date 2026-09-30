-- =============================================================================
-- 373 — WHAT THE OWNER WANTS: THE MANDATE, AS STATEMENTS.
--
-- The long-horizon directive (30 September 2026; INSTITUTION_MODEL §3.2). The
-- parts of what the owner wants that already had homes keep them: the charter,
-- the search's guidance, objectives, preferences, boundaries. What had none is
-- the portfolio-level steering — what to pursue and avoid, what to optimise
-- for, how bold to be, a temporary posture like "spend less this month". One
-- append-only table holds it.
--
--   dimension   interest | avoid | optimize | experiment_style | involvement
--               | risk | allocation | posture
--   subject     a key within the dimension ('saas', 'cash_flow', 'conserve')
--   value_json  the typed value the reader produced
--   scope_kind  portfolio | domain | asset | mission, with scope_ref naming it
--   statement   the owner's words, verbatim, or the direct control's label
--   source      'intent:<owner_intents id>' when typed, 'direct' when tapped
--   until       NULL until changed, or the moment it lapses by itself
--   review_at   NULL, or when it is brought back to the owner — never changed
--               by itself
--
-- IT GRANTS NOTHING. No gate that decides whether Foundry may act reads these
-- rows. Steering may NARROW what Foundry looks for; it can never widen what
-- Foundry may do, spend or send.
--
-- SUPERSEDED, NEVER EDITED. A change is a new row; the old one is pointed at
-- it once. A withdrawal points it at 'withdrawn'. So the record says when the
-- owner stopped avoiding SaaS, and what they had said before.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mandate_statements (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  dimension      TEXT NOT NULL CHECK (dimension IN
                   ('interest','avoid','optimize','experiment_style','involvement','risk','allocation','posture')),
  subject        TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 60 AND subject = lower(subject)),
  value_json     TEXT NOT NULL DEFAULT '{}',
  scope_kind     TEXT NOT NULL DEFAULT 'portfolio' CHECK (scope_kind IN ('portfolio','domain','asset','mission')),
  scope_ref      TEXT,
  statement      TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 800),
  source         TEXT NOT NULL CHECK (source = 'direct' OR source LIKE 'intent:%' OR source LIKE 'undo:%'),
  until          TEXT,
  review_at      TEXT,
  said_at        TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by  TEXT,
  CHECK ((scope_kind = 'portfolio') = (scope_ref IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_mandate_statements_live ON mandate_statements(founder_id, superseded_by, said_at);

CREATE TRIGGER IF NOT EXISTS mandate_statements_are_superseded_never_edited
BEFORE UPDATE ON mandate_statements
WHEN NEW.id IS NOT OLD.id OR NEW.founder_id IS NOT OLD.founder_id OR NEW.dimension IS NOT OLD.dimension
  OR NEW.subject IS NOT OLD.subject OR NEW.value_json IS NOT OLD.value_json OR NEW.scope_kind IS NOT OLD.scope_kind
  OR NEW.scope_ref IS NOT OLD.scope_ref OR NEW.statement IS NOT OLD.statement OR NEW.source IS NOT OLD.source
  OR NEW.until IS NOT OLD.until OR NEW.review_at IS NOT OLD.review_at OR NEW.said_at IS NOT OLD.said_at
  OR OLD.superseded_by IS NOT NULL OR NEW.superseded_by IS NULL
BEGIN
  SELECT RAISE(ABORT, 'mandate_statements: superseded, never edited');
END;
