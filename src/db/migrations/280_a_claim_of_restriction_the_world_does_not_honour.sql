-- A CLAIM OF RESTRICTION THE WORLD DOES NOT HONOUR.
--
-- The workspace ledger recorded network 'none' and the adapter applied no
-- policy at all, so the institution believed a sprite had no egress while the
-- sprite had whatever its vendor gives it by default — and then ran generated
-- code on it. That is the one direction this must never fail in. A claim of
-- restriction nothing enforces is worse than no claim, because everything
-- downstream trusts the record rather than the world.
--
-- The endpoint that narrows egress has not been read. So the adapter now
-- refuses anything but the network the sprite actually gets, and this is the
-- finding it refuses on: written down so the refusal can be checked against
-- what was read, and lifted by reading more rather than by assuming.
--
-- AND THE COST WAS RECORDED AS ZERO, which made every spending bound
-- unreachable. The per-workshop budget and the owner's monthly ceiling both
-- compare against a number that never moved, so a thousand sprites in his paid
-- account passed a ceiling that said twenty. It is an estimate now, and it says
-- it is an estimate: this institution cannot read the vendor's invoice, and a
-- conservative number that can stop work is worth more than an exact one that
-- arrives next month.

INSERT OR REPLACE INTO substrate_evaluations (id, substrate, property, finding, source)
VALUES
  ('fly_sprites:network_default', 'fly_sprites', 'network at creation',
   'A SPRITE STARTS WITH ITS VENDOR''S DEFAULT EGRESS. The packet-level domain '
   || 'allowlist is documented as a capability of the product; the endpoint that '
   || 'applies one to a sprite has not been read. So this institution can ask for '
   || 'no network and get whatever the vendor gives, which is why the adapter '
   || 'refuses every network but the one it actually gets rather than recording a '
   || 'restriction nobody applied',
   'https://fly.io/sprites/ material read 2026-09-05, and the absence of an '
   || 'egress-policy endpoint in it'),

  ('fly_sprites:cost_basis', 'fly_sprites', 'how cost is known',
   'ESTIMATED, NOT METERED. The adapter cannot read the vendor''s invoice, so it '
   || 'charges wall-clock active time at the recorded per-second rate with a '
   || 'one-cent floor. The floor is what lets a bound bind at all — work that '
   || 'takes a moment must still cost something, or a fast runaway is free. It '
   || 'will differ from the bill; it is deliberately the conservative direction, '
   || 'because a number that can stop work is worth more than an exact one that '
   || 'arrives a month later',
   'src/services/workshop/fly-sprites.ts, and the metering finding recorded in '
   || 'migration 271'),

  ('fly_machines:cost_basis', 'fly_machines', 'how cost is known',
   'ESTIMATED, NOT METERED, and previously recorded as free. A launched machine '
   || 'bills per second; creating one is charged a floor so that making one is '
   || 'never mistaken for costing nothing. This substrate still cannot run a step',
   'src/services/workshop/fly-machines.ts');
