-- =============================================================================
-- STEERING THAT NAMES A DIMENSION
--
-- "I don't want another subscription business." "Something less dependent on
-- Google." "Sell to businesses rather than consumers." "Almost no support
-- burden."
--
-- Every one of those is steering AND a statement about exposure, and until now
-- the two were different vocabularies. Guidance matched words against a
-- candidate's prose; concentration counted exposures on named dimensions. So
-- "less dependent on Google" would have filtered a candidate that happened to
-- say "Google" in its description and missed one whose whole distribution was
-- search - which is the failure of string matching pretending to be
-- understanding.
--
-- Naming the dimension joins them. The steering is now applied against what the
-- candidate DECLARED about how it makes money, and it speaks the same sixteen
-- axes the portfolio is measured on. That also makes superseding right: two
-- preferences are only in conflict when they are about the same axis. "Higher
-- ticket" and "almost no support burden" are both live; a second opinion about
-- pricing replaces the first.
--
-- The column is nullable because steering that names no axis is still real:
-- "try harder to disprove it" is about how hard to look, not about what to
-- look for.
-- =============================================================================

ALTER TABLE venture_guidance ADD COLUMN dimension TEXT
  REFERENCES exposure_dimensions(dimension);
