-- =============================================================================
-- AN INSTITUTION THAT READS A REGISTRY DAILY AND SAYS IT CANNOT SEE
--
-- Taking stock found the institution contradicting itself. One part of it reads
-- a public registry every morning, files dated attributed observations, and has
-- earned a reality proof for doing so. Another part, asked to find a business,
-- answers: "I cannot see what is happening outside your companies, so I have
-- nowhere to look."
--
-- Both statements were true of different tables and the pairing was nonsense.
-- The capability fabric knew the institution could read; `research_sources` -
-- the ways of looking a mandate actually consults - was only ever populated for
-- the rehearsal world, because that was the only place anything had connected
-- one by hand.
--
-- SO A PROVIDER NOW SAYS WHAT KIND OF KNOWING IT SUPPLIES, and a proven one
-- becomes a way of looking without anybody remembering to wire it. Nothing is
-- granted by that: these are observe-rung capabilities reading public sources
-- with no credential and no cost, and a way of looking has never been a way of
-- acting. What changes is only that the institution stops denying what it
-- demonstrably does.
-- =============================================================================

ALTER TABLE capability_providers ADD COLUMN supplies_source_type TEXT
  REFERENCES market_source_types(source_type);

UPDATE capability_providers SET supplies_source_type = 'directory'
 WHERE provider = 'npm_registry';
UPDATE capability_providers SET supplies_source_type = 'community'
 WHERE provider = 'hn_algolia';
