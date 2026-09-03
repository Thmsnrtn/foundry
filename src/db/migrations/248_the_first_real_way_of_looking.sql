-- =============================================================================
-- THE FIRST REAL WAY OF LOOKING
--
-- Every observation in this institution so far has been invented. The research
-- machinery is built, falsifiable and controlled-proven, and it has never once
-- seen the world. This is the first source that has.
--
-- WHY A PACKAGE REGISTRY, AND NOT SOMETHING EASIER. The test is not technical
-- convenience, it is whether the source teaches something materially useful
-- about a real opportunity space. A registry answers the questions that
-- actually kill or save a digital venture: does a solution to this already
-- exist, how used is it, is anybody still maintaining it, and how many things
-- depend on it. Those are the substitutes, and a candidate that has not looked
-- at its substitutes has not been researched.
--
-- AND IT IS THREE KINDS OF KNOWING, NOT ONE, which is the whole reason a market
-- is a family of senses rather than a provider:
--
--   the registry's record of a package - that it exists, when it was last
--     published, how many versions - is something the registry OBSERVED, and it
--     is filed as a directory listing;
--   the package's own description is what its publisher SAYS ABOUT ITSELF, and
--     it is filed as a vendor page, self-reported, worth exactly what that is;
--   the download count is a number from a system of record, filed as such.
--
-- Three source types, one provider, genuinely different standing. An
-- institution that filed all three as "npm said so" would have learnt nothing
-- about how sure it should be.
--
-- IT ARRIVES DECLARED. Not available, not proven. A provider becomes available
-- when an adapter exists and is exercised, and reality-proven only when it has
-- actually performed its work and the result was independently observed - which
-- is a witnessed change with a name on it, and has not happened yet.
-- =============================================================================

DROP TRIGGER capabilities_constitutional_insert;

INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('read_package_registry', 'research',
   'see what software already exists for a problem, how used it is, and whether '
   || 'anybody is still maintaining it', 'observe', 9);

CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_npm_registry', 'read_package_registry', 'npm_registry', 'api', NULL,
   'nothing - public, no credential, no account', 'declared', 1);
