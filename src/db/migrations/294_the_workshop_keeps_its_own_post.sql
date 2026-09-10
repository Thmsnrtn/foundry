-- THE WORKSHOP KEEPS ITS OWN POST.
--
-- Migration 293 gave the Workshop a forwarding address of its own, so that
-- giving it ears would stop reaching for the owner's private mailbox. That was
-- the right correction to the wrong thing. Forwarding was never the point: it
-- was how the edge kept a message somewhere that is not Foundry, so that
-- Foundry being down could not silently lose it. A mailbox was one way to have
-- somewhere. A store the Workshop already owns is another, and it does not
-- make anybody's private account load-bearing.
--
-- So the edge writes every message into a store of its own before it tells
-- Foundry anything, and Foundry reads from that store — at the time, or later,
-- or again after an outage. The forwarding address is dropped rather than left
-- as a second way of doing the same job: one canonical path, not a live one
-- and a spare.
--
-- The store is deliberately NOT the page store. That one is served to the
-- public internet by the site program, and a message written into it would be
-- a message on the web.
ALTER TABLE public_workshop ADD COLUMN mail_kv_namespace_id TEXT;

DROP TRIGGER IF EXISTS public_workshop_forward_guard;
ALTER TABLE public_workshop DROP COLUMN mail_forward_to;

CREATE TRIGGER public_workshop_mail_store_guard
BEFORE UPDATE ON public_workshop
BEGIN
  -- The Workshop's post is not kept where the world can read it.
  SELECT RAISE(ABORT,'public_workshop:mail_store_is_not_the_page_store')
    WHERE NEW.mail_kv_namespace_id IS NOT NULL
      AND NEW.mail_kv_namespace_id = NEW.kv_namespace_id;
END;

-- ─── The catalogue stops describing a capability the Workshop no longer has ──
--
-- `route_public_mail` said "forward mail sent to the Workshop's address to the
-- owner". That is what it used to do and is now false in two ways: nothing is
-- forwarded, and there is no owner mailbox in the path. An institution whose
-- own catalogue of what it can do is out of date is an institution that cannot
-- be reasoned about from its rows.
--
-- And one capability is added, because retiring the old path is itself an act
-- with a consequence and belongs at the same door as everything else:
-- `retire_public_mailbox` removes a verified destination address from the
-- provider account once nothing routes to it. It refuses while any enabled rule
-- still forwards there, so the order is always stop routing, then retire.
DROP TRIGGER capabilities_constitutional_update;
UPDATE capabilities
   SET what_it_does = 'point mail sent to the Workshop''s address at the program that keeps it'
 WHERE capability_key = 'route_public_mail';
CREATE TRIGGER capabilities_constitutional_update BEFORE UPDATE ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

DROP TRIGGER capabilities_constitutional_insert;
INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('retire_public_mailbox', 'public_workshop', 'remove a mailbox the Workshop no longer delivers to from its provider account; refuses while anything still routes there', 'reversible', 103);
CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_public_mailbox_off_cf', 'retire_public_mailbox', 'cloudflare', 'api', 'cloudflare_email_destination_delete', 'none', 'available', 1);
