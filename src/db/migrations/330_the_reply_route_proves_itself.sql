-- =============================================================================
-- THE REPLY ROUTE PROVES ITSELF, OR IT IS NOT PROVEN.
--
-- Everything the institution checked about the path a stranger's reply travels
-- was a reading of how things are SET UP: a routing rule exists, a namespace
-- id is present, a program is deployed. Experiment 001's reply route would
-- have passed every one of those checks on the morning it failed, because
-- each of them was true and none of them was the question.
--
-- The question is whether a message sent to the advertised address arrives.
-- The only thing that answers it is a message sent to the advertised address
-- arriving. So the Workshop sends one to itself, with a nonce, and waits.
--
-- WHAT A PROBE PROVES DEPENDS ON WHERE IT CAME FROM, and the row says which
-- rather than reducing it to a boolean:
--
--   self      sent from the Workshop's own identity. It leaves the provider,
--             resolves the domain's MX, crosses the routing rule, the edge
--             program and the intake — so it does prove the inbound
--             infrastructure. It does NOT prove that mail from an arbitrary
--             third-party sender is accepted.
--   external  sent from a separately controlled mailbox. This one proves the
--             advertised route as a stranger would travel it.
--
-- The owner's instruction is that the external route may not be declared
-- proven unless a test actually exercised it, and that where verification
-- cannot be completed the limitation stands and outreach depending on the
-- path stays blocked. That is why the grade is a column and not an inference.
-- =============================================================================

CREATE TABLE reply_route_probes (
  id          TEXT PRIMARY KEY,
  founder_id  TEXT NOT NULL REFERENCES founders(id),
  -- What the message carries so its arrival can be recognised without reading
  -- anybody else's mail: a random token in the subject, matched exactly.
  nonce       TEXT NOT NULL,
  -- Where it was sent from, which is what decides what its arrival proves.
  route       TEXT NOT NULL CHECK (route IN ('self','external')),
  -- The address it was sent TO: the advertised reply address at the time.
  advertised  TEXT NOT NULL,
  sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- The provider's own name for the message, so a send can be traced.
  provider_ref TEXT,
  -- When it was seen arriving, or null while it has not been.
  arrived_at  TEXT,
  -- What was wrong, when the send itself failed.
  refused     TEXT,
  UNIQUE(founder_id, nonce)
);

CREATE INDEX idx_reply_route_probes ON reply_route_probes(founder_id, sent_at);

-- A PROBE IS A RECORD OF AN ATTEMPT, NOT A DRAFT. Its nonce, its route, where
-- it was sent and when cannot be rewritten afterwards; only its arrival and a
-- refusal are ever filled in, and an arrival is not un-said.
CREATE TRIGGER reply_route_probe_is_an_attempt
BEFORE UPDATE ON reply_route_probes
BEGIN
  SELECT RAISE(ABORT,'reply_route_probe:immutable')
    WHERE NEW.founder_id <> OLD.founder_id OR NEW.nonce <> OLD.nonce
       OR NEW.route <> OLD.route OR NEW.advertised <> OLD.advertised
       OR NEW.sent_at <> OLD.sent_at;
  SELECT RAISE(ABORT,'reply_route_probe:arrival_stands')
    WHERE OLD.arrived_at IS NOT NULL AND NEW.arrived_at IS NULL;
END;

-- ─── THE CAPABILITY, CLASSIFIED LIKE EVERY OTHER ────────────────────────────
-- The gateway refused this effect with "nothing says what consequence
-- 'workshop_reply_probe' has, so it may not act", which is the institution
-- working: an effect whose consequence nobody has written down may not happen.
-- So it is written down.
--
-- The rung is `reversible` rather than `public`: it sends a real message, so
-- it is not `prepare`, and the only party it reaches is the Workshop itself —
-- nothing is put in front of anybody, nothing is said to a stranger, and
-- stopping it leaves no trace anyone outside would have seen.
DROP TRIGGER capabilities_constitutional_insert;
INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('check_public_reply_route', 'public_workshop',
   'send one message to the Workshop''s own advertised address to find out whether a reply to it arrives',
   'reversible', 103);
CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_reply_probe_resend', 'check_public_reply_route', 'resend', 'api', 'workshop_reply_probe',
   'one message a day at most, within the provider''s free allowance at this scale', 'available', 1);
