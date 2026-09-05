-- THE ADAPTER NOW EXISTS.
--
-- Migration 268 recorded that `fly_sprites` could not run a step because there
-- was no adapter in this repository at all. That was true when it was written
-- and stopped being true in the same session, and nothing noticed until the
-- chain refused to choose a computer for a reason that no longer held.
--
-- Which is the mechanism working rather than failing: what the institution
-- believes about the world is a record with a source, and a record that nobody
-- revisits becomes a claim about the past presented as a fact about the
-- present. This is the second such correction today. Both were mine.

INSERT OR REPLACE INTO substrate_evaluations (id, substrate, property, finding, source)
VALUES
  ('fly_sprites:adapter', 'fly_sprites', 'can run a step',
   'yes — an adapter exists and is registered, implementing create, run and '
   || 'destroy against the published endpoints. Checkpoint, restore and the '
   || 'network allowlist refuse rather than guess, because their endpoints have '
   || 'not been read. It has never run against the real service: there is no '
   || 'credential and no plan',
   'src/services/workshop/fly-sprites.ts');
