-- A FINDING THAT WAS WRONG, AND WHAT THIS ACTUALLY COSTS.
--
-- Migration 268 recorded that credential isolation was NOT ADDRESSED by the
-- pages read. That was true of those pages and false about the product, and a
-- finding recorded as an absence is exactly the kind that ages badly: it looks
-- like knowledge and is really the shape of where somebody stopped reading.
--
-- Sprites Connectors are documented. The credential lives in Fly's control
-- plane; a gateway proxies each request and attaches the credential on the way
-- out; the raw token never lands inside the sandbox. Documented for OpenRouter,
-- GitHub, Slack, Discourse, and any HTTP API through a custom connector — and
-- the Discourse one brokers a SCOPED IDENTITY rather than injecting a static
-- key, so a sprite acting on somebody's behalf can only do what they can do.
--
-- The correction is written into the finding rather than replacing it quietly,
-- because how the institution came to believe something is part of what it
-- knows.
--
-- AND IT CHANGES NOTHING ABOUT THE FIRST RESPONSIBILITY. Connectors existing is
-- not a reason to put repository authority inside generated-code execution. The
-- first acceptance chain keeps the stronger separation: trusted Foundry
-- supplies material, the workspace produces and verifies a change, and
-- publication is a separate hand outside it. That proves the property worth
-- proving — the workshop can produce a change without possessing the authority
-- to publish it — and connectors remain available for later responsibilities
-- where they are the right answer.

INSERT OR REPLACE INTO substrate_evaluations (id, substrate, property, finding, source)
VALUES
  ('fly_sprites:credentials', 'fly_sprites', 'credential isolation',
   'ADDRESSED, and this record previously said otherwise. Connectors keep the '
   || 'credential in Fly''s control plane; a gateway attaches it to the outbound '
   || 'request and the raw token never lands in the sandbox. Documented for '
   || 'OpenRouter, GitHub, Slack, Discourse and custom HTTP APIs. The Discourse '
   || 'connector brokers a scoped identity rather than injecting a static key. '
   || 'The earlier NOT ADDRESSED was the shape of where reading stopped, not a '
   || 'property of the product',
   'https://fly.io/sprites/ connectors material (read 2026-09-05, correcting the '
   || 'finding recorded from a narrower page the same day)'),

  -- ─── WHAT IT COSTS, WHICH IS THE ACTUAL OWNER BOUNDARY ───────────────────
  ('fly_sprites:plan', 'fly_sprites', 'plan required',
   'eight tiered plans, entry "Adventurer" at $20/month for 20 concurrent '
   || 'sprites with included CPU, RAM and storage allowances; usage beyond the '
   || 'included amounts is billed at usage rates. No free tier for creating '
   || 'sprites was found on the material read',
   'https://community.fly.io/t/more-sprites-plans/26857 (read 2026-09-05)'),
  ('fly_sprites:metering', 'fly_sprites', 'metering',
   'billed hourly on actual usage, compute per second and only while a sprite '
   || 'is active. Storage: cold $0.02/GB-month, hot $0.5/GB-month. Bandwidth '
   || 'not metered today',
   'https://community.fly.io/t/cheaper-sprites-storage/26889 and Fly pricing '
   || 'material (read 2026-09-05)'),
  ('fly_sprites:trial', 'fly_sprites', 'trial credit',
   '$30 trial credit exists, at most one per organisation, and it applies to '
   || 'USAGE only — the monthly subscription is billed separately and is not '
   || 'covered. Whether this organisation is eligible or has already used it is '
   || 'an account fact that cannot be read from here',
   'Fly community pricing material (read 2026-09-05)');

-- ─── THE ADAPTER EXISTS, WHICH IS NOT THE SAME AS BEING AVAILABLE ──────────
--
-- `run_in_workspace` had no provider at all, so the capability existed and
-- nothing claimed to carry it. Sprites can: the exec endpoint is published and
-- the adapter is written to it. Recorded as DECLARED, because an adapter that
-- has never run is a claim about code rather than about the world — and because
-- there is no credential, no plan, and therefore nothing it could run against.
INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
VALUES
  ('cp_run_in_sprite', 'run_in_workspace', 'fly_sprites', 'api', NULL,
   'metered per second while active, on a plan from $20/month', 'declared', 1);
