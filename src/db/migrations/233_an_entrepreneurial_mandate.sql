-- =============================================================================
-- AN ENTREPRENEURIAL MANDATE, NOT AN INSTRUCTION TO BUILD SOFTWARE
--
-- "I'd like you to add a new micro-SaaS venture to my portfolio."
--
-- The failure this exists to prevent is the obvious one: hearing that as "build
-- me a SaaS" and producing software nobody wanted. It is a MANDATE — a standing
-- instruction to go and look, under constraints, with a budget, that accretes
-- guidance over weeks and can be stopped.
--
-- WHY IT IS NOT STANDING INTENT. `owner_objectives` says what an existing
-- company is for. A mandate has no company: it is the search that might produce
-- one. It carries constraints that are not boundaries (Foundry may not "refuse"
-- paid acquisition; there is nothing to refuse until a venture exists), a
-- budget that is not the company allowance, and a lifecycle — searching,
-- narrowed, deciding, established, abandoned — that no objective has.
--
-- AND THE STEERING IS ABSORBED, NOT CHATTED AT. "I don't want paid acquisition"
-- becomes a row that every later candidate is filtered by. "Try harder to
-- disprove it" raises the bar a candidate must clear. A mandate that heard
-- those and kept its own counsel would be a chat window with a database behind
-- it, which is the thing this institution is not.
--
-- RESEARCH IS A SENSE FOUNDRY DOES NOT HAVE, and that shapes the schema rather
-- than being a caveat on it. An opportunity carries where each claim CAME FROM;
-- with no market sense connected there is nowhere for a claim to come from, so
-- a mandate can be created, constrained, steered and stopped — and will
-- honestly produce nothing until it can see. Better than plausible candidates
-- assembled from a model's recollection, which is invented evidence wearing a
-- research report's clothes.
-- =============================================================================

CREATE TABLE venture_mandates (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  -- His words, verbatim. What he actually asked for.
  statement      TEXT NOT NULL,
  -- The shape he asked for, when he named one: 'micro_saas', 'saas', etc. NULL
  -- is honest — "find me a business" is a real mandate.
  shape          TEXT,
  state          TEXT NOT NULL DEFAULT 'searching'
                   CHECK (state IN ('searching','narrowed','deciding','established','stopped')),
  -- A mandate that produced a company names it. One mandate, one company: a
  -- search that yielded two businesses is two mandates in retrospect.
  became_product TEXT REFERENCES products(id),
  -- Reference mandates exercise the whole flow and may only ever produce a
  -- company that does not exist.
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  opened_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at      TEXT,
  closed_reason  TEXT
);

CREATE TRIGGER venture_mandate_guard
BEFORE INSERT ON venture_mandates
BEGIN
  SELECT RAISE(ABORT,'venture_mandate:statement_required')
    WHERE trim(NEW.statement) = '';
  SELECT RAISE(ABORT,'venture_mandate:cannot_arrive_closed')
    WHERE NEW.closed_at IS NOT NULL OR NEW.became_product IS NOT NULL
       OR NEW.state <> 'searching';
END;

CREATE TRIGGER venture_mandate_progress
BEFORE UPDATE ON venture_mandates
BEGIN
  SELECT RAISE(ABORT,'venture_mandate:already_closed')
    WHERE OLD.closed_at IS NOT NULL;
  SELECT RAISE(ABORT,'venture_mandate:close_needs_reason')
    WHERE NEW.closed_at IS NOT NULL AND trim(coalesce(NEW.closed_reason,'')) = '';
  -- A REFERENCE MANDATE MAY NEVER PRODUCE A REAL COMPANY. Structural, because
  -- a procedure that remembered to check would eventually be a procedure that
  -- forgot: the whole point of exercising origination in the reference world is
  -- that nothing it invents can walk out of it.
  SELECT RAISE(ABORT,'venture_mandate:reference_cannot_make_a_real_company')
    WHERE NEW.became_product IS NOT NULL AND OLD.evidence_mode = 'reference'
      AND NOT EXISTS (
        SELECT 1 FROM products WHERE id = NEW.became_product AND reality = 'reference');
  SELECT RAISE(ABORT,'venture_mandate:immutable')
    WHERE NEW.founder_id IS NOT OLD.founder_id
       OR NEW.statement IS NOT OLD.statement
       OR NEW.evidence_mode IS NOT OLD.evidence_mode
       OR NEW.opened_at IS NOT OLD.opened_at;
END;

CREATE UNIQUE INDEX idx_venture_mandate_one_open
  ON venture_mandates(founder_id) WHERE closed_at IS NULL;

-- WHAT HE SAID WHILE IT WAS RUNNING.
--
-- Each row is one piece of steering, kept verbatim and classified into
-- something the search actually applies. Never edited: "target this industry
-- instead" REPLACES an earlier industry by superseding it, so the record still
-- says he changed his mind and when.
CREATE TABLE venture_guidance (
  id           TEXT PRIMARY KEY,
  mandate_id   TEXT NOT NULL REFERENCES venture_mandates(id),
  -- WHOSE IT IS, CARRIED DIRECTLY. Reachable through the mandate, and the
  -- erasure machinery deletes person-scoped rows by a COLUMN on the table
  -- rather than by a join — so a table that can only be reached through a
  -- parent is a table erasure walks past. Every other person-scoped table here
  -- carries this for the same reason.
  founder_id   TEXT NOT NULL REFERENCES founders(id),
  statement    TEXT NOT NULL,
  -- What the search does with it. A closed vocabulary: guidance the institution
  -- cannot act on must be refused out loud rather than filed and forgotten.
  -- Each kind, and the sentence of the owner's it came from:
  --
  --   avoid     "I don't want paid acquisition"
  --   prefer    "look for higher-ticket opportunities"
  --   industry  "target this industry instead"
  --   budget    "spend no more than $20 validating it"
  --   harder    "try harder to disprove it"
  --   deeper    "research this more deeply"
  --   favour    "I like this one"
  --   another   "show me another option"
  --
  -- The list stays free of comments because it is read by machines as well as
  -- people: `check-check-vocabularies` parses it to catch a literal nobody
  -- declared, and an inline comment turns the vocabulary into noise.
  kind         TEXT NOT NULL CHECK (kind IN (
                 'avoid', 'prefer', 'industry', 'budget',
                 'harder', 'deeper', 'favour', 'another')),
  -- The bit of it the search uses: the industry named, the amount, the
  -- opportunity favoured. NULL when the kind carries all the meaning.
  subject      TEXT,
  given_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_by TEXT REFERENCES venture_guidance(id)
);

CREATE TRIGGER venture_guidance_guard
BEFORE INSERT ON venture_guidance
BEGIN
  SELECT RAISE(ABORT,'venture_guidance:statement_required')
    WHERE trim(NEW.statement) = '';
  -- And it must be the mandate's own owner: a guidance row naming a different
  -- person would erase with the wrong account, or not at all.
  SELECT RAISE(ABORT,'venture_guidance:mandate_closed') WHERE NOT EXISTS (
    SELECT 1 FROM venture_mandates m
     WHERE m.id = NEW.mandate_id AND m.closed_at IS NULL
       AND m.founder_id = NEW.founder_id);
END;

CREATE TRIGGER venture_guidance_immutable
BEFORE UPDATE ON venture_guidance
BEGIN
  SELECT RAISE(ABORT,'venture_guidance:immutable')
    WHERE NEW.statement IS NOT OLD.statement OR NEW.kind IS NOT OLD.kind
       OR NEW.subject IS NOT OLD.subject OR NEW.mandate_id IS NOT OLD.mandate_id;
END;

CREATE INDEX idx_venture_guidance_live
  ON venture_guidance(mandate_id) WHERE superseded_by IS NULL;

-- A CANDIDATE, AND WHAT IS STILL UNKNOWN ABOUT IT.
--
-- `unknowns_json` is not a caveat section. It is the part that decides whether
-- a candidate may advance: an opportunity whose unknowns include "whether
-- anyone will pay" has not earned a company, however good the rest reads.
--
-- `kill_thesis` is the strongest reason it FAILS, and it is required. A
-- candidate with no stated way to die has not been thought about — and the
-- institution's job is to try to destroy its own theses before capital is
-- requested, not after.
CREATE TABLE venture_opportunities (
  id            TEXT PRIMARY KEY,
  mandate_id    TEXT NOT NULL REFERENCES venture_mandates(id),
  -- Whose it is, carried directly, for the reason above.
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  headline      TEXT NOT NULL,
  who_has_it    TEXT NOT NULL,
  the_problem   TEXT NOT NULL,
  why_it_might  TEXT NOT NULL,
  kill_thesis   TEXT NOT NULL,
  unknowns_json TEXT NOT NULL DEFAULT '[]',
  -- Where every claim came from. Empty means nothing was checked, and an
  -- opportunity with no sources may never be advanced.
  sources_json  TEXT NOT NULL DEFAULT '[]',
  evidence_mode TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  found_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL while it is being investigated. Rejection is the valuable half and is
  -- recorded with its reason rather than by deletion.
  verdict       TEXT CHECK (verdict IN ('rejected','advanced')),
  verdict_why   TEXT,
  decided_at    TEXT
);

CREATE TRIGGER venture_opportunity_guard
BEFORE INSERT ON venture_opportunities
BEGIN
  SELECT RAISE(ABORT,'venture_opportunity:incomplete')
    WHERE trim(NEW.headline) = '' OR trim(NEW.who_has_it) = ''
       OR trim(NEW.the_problem) = '' OR trim(NEW.why_it_might) = ''
       -- A CANDIDATE WITH NO STATED WAY TO DIE HAS NOT BEEN THOUGHT ABOUT.
       OR trim(NEW.kill_thesis) = '';
  SELECT RAISE(ABORT,'venture_opportunity:json_invalid')
    WHERE json_valid(NEW.unknowns_json) = 0 OR json_type(NEW.unknowns_json) <> 'array'
       OR json_valid(NEW.sources_json) = 0 OR json_type(NEW.sources_json) <> 'array';
  SELECT RAISE(ABORT,'venture_opportunity:cannot_arrive_decided')
    WHERE NEW.verdict IS NOT NULL;
  -- The candidate is only ever as real as the mandate that found it.
  SELECT RAISE(ABORT,'venture_opportunity:evidence_mode_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM venture_mandates m
     WHERE m.id = NEW.mandate_id AND m.evidence_mode = NEW.evidence_mode
       AND m.founder_id = NEW.founder_id);
END;

CREATE TRIGGER venture_opportunity_decided_once
BEFORE UPDATE ON venture_opportunities
BEGIN
  SELECT RAISE(ABORT,'venture_opportunity:already_decided')
    WHERE OLD.verdict IS NOT NULL;
  SELECT RAISE(ABORT,'venture_opportunity:verdict_needs_reason')
    WHERE NEW.verdict IS NOT NULL AND trim(coalesce(NEW.verdict_why,'')) = '';
  -- NOTHING ADVANCES WITHOUT SOMETHING TO CHECK. An opportunity assembled from
  -- a model's recollection, with no source anyone could look at, is invented
  -- evidence wearing a research report's clothes.
  SELECT RAISE(ABORT,'venture_opportunity:advanced_without_sources')
    WHERE NEW.verdict = 'advanced' AND json_array_length(OLD.sources_json) = 0;
  SELECT RAISE(ABORT,'venture_opportunity:immutable')
    WHERE NEW.mandate_id IS NOT OLD.mandate_id
       OR NEW.headline IS NOT OLD.headline
       OR NEW.kill_thesis IS NOT OLD.kill_thesis
       OR NEW.evidence_mode IS NOT OLD.evidence_mode;
END;

CREATE INDEX idx_venture_opportunities_open
  ON venture_opportunities(mandate_id) WHERE verdict IS NULL;

-- NO DELETE GUARD ON ANY OF THE THREE, AND THAT IS A DECISION.
--
-- Everything else here that must not be rewritten carries one, and these
-- carried one too until the erasure suite refused them. The rule migration 162
-- established holds: append-only means history is not rewritten; it does not
-- mean a person's records outlive their right to have them removed.
--
-- A COMPANY'S TABLES CAN KEEP THEIR GUARD because `products.erasure_scheduled_at`
-- marks a company on its way out, so the guard can permit exactly that case.
-- A mandate belongs to a FOUNDER and there is no equivalent marker — so a
-- conditional guard would have to invent one, and an unconditional guard blocks
-- the one deletion that must work. The immutability that matters is untouched
-- and lives in the UPDATE triggers above: his words cannot be rewritten, a
-- verdict cannot be re-decided, a closed search cannot be reopened.
