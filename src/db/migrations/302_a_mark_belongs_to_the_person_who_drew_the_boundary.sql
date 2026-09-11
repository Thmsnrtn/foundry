-- =============================================================================
-- FOUNDRY — a mark belongs to the person who drew the boundary
--
-- `owner_exclusion_marks` was classified as founder-scoped data, which it is:
-- the marks of a business one person said never to contact are his, and erasing
-- his account must take them with it. But the table had no `founder_id`, and
-- founder-scoped erasure deletes by exactly that column. The result was an
-- erasure that did not fail safe — it failed loudly, taking thirty-two tests
-- with it, which is the good outcome of the two available.
--
-- The alternative was to teach the erasure to walk from a mark to its exclusion
-- to a founder. That is a more general mechanism and this is not the moment to
-- build one: every other founder-scoped child in this schema carries the column
-- directly, and a table that is the odd one out is the table somebody gets
-- wrong later.
--
-- SO THE COLUMN IS ADDED AND THE DATABASE KEEPS IT HONEST. It is denormalised,
-- which means it can disagree with the parent, which means a trigger must make
-- that impossible rather than a convention asking nicely.
-- =============================================================================

ALTER TABLE owner_exclusion_marks ADD COLUMN founder_id TEXT REFERENCES founders(id);

-- Anything already written belongs to whoever owns its exclusion.
UPDATE owner_exclusion_marks
   SET founder_id = (SELECT x.founder_id FROM owner_exclusions x WHERE x.id = exclusion_id)
 WHERE founder_id IS NULL;

DROP TRIGGER owner_exclusion_mark_guard;
CREATE TRIGGER owner_exclusion_mark_guard
BEFORE INSERT ON owner_exclusion_marks
BEGIN
  -- A MARK IS ITS PARENT'S. Denormalised and therefore capable of lying, so
  -- the row may not be written at all unless it agrees with the exclusion it
  -- hangs from. An erasure that deletes by this column has to be able to trust
  -- it completely; "usually correct" is not a property erasure can be built on.
  SELECT RAISE(ABORT,'owner_exclusion_mark:founder_must_match_the_exclusion')
    WHERE NEW.founder_id IS NULL
       OR NEW.founder_id IS NOT (SELECT x.founder_id FROM owner_exclusions x WHERE x.id = NEW.exclusion_id);
  -- A mark that was not normalised cannot be matched against, so it is not a
  -- boundary — it is a boundary-shaped row that lets the business through.
  SELECT RAISE(ABORT,'owner_exclusion_mark:not_normalised')
    WHERE NEW.value <> trim(lower(NEW.value)) OR trim(NEW.value) = '';
  SELECT RAISE(ABORT,'owner_exclusion_mark:source_required')
    WHERE trim(coalesce(NEW.source,'')) = '';
  -- A NAME TOO SHORT MATCHES BUSINESSES HE NEVER MEANT. Name marks are matched
  -- as substrings, so "abc" would silently suppress every business whose name
  -- happens to contain it.
  SELECT RAISE(ABORT,'owner_exclusion_mark:name_too_broad')
    WHERE NEW.kind = 'name' AND length(NEW.value) < 6;
END;
