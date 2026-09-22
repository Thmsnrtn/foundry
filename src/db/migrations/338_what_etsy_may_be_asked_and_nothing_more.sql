-- =============================================================================
-- WHAT ETSY MAY BE ASKED, AND NOTHING MORE.
--
-- The owner has an Etsy seller shop, renamed to ApexMicro, with no listing
-- published yet. He has authorised nothing about it: not access, not
-- publication, not fees. This migration does not grant any of those. It
-- declares the three READ scopes an Etsy connection would be allowed to ask
-- for if he ever chooses to make one, so that the request he is eventually
-- shown is bounded by a row rather than by an adapter's good intentions.
--
-- READ-ONLY, EVERY ONE OF THEM, and that is the point rather than a detail. A
-- sense is not a hand. Creating a draft, uploading a file and activating a
-- listing are `listings_w`, and none of them is here — they belong to the
-- capability registry and the outbound door, where an act is judged by its
-- consequence and approved one at a time. A credential that could publish
-- would make the door's judgement optional.
--
-- WHY `revenue` CARRIES ALL THREE. Etsy reports the money and the thing that
-- earned it through one account, and the question these scopes exist to answer
-- is a single economic one: is the listing still up, what has it sold, and
-- what did the venue keep. Splitting that across invented sense keys would
-- describe Foundry's internal filing rather than the owner's question.
--
-- Constitutional, so seeding it is a migration act and not a runtime one: the
-- guard comes off for these statements and goes straight back on.
-- =============================================================================

DROP TRIGGER sense_provider_scopes_constitutional_insert;

INSERT INTO sense_provider_scopes (provider, sense_key, mode, scope, because) VALUES
  ('etsy', 'revenue', 'real', 'shops_r',
   'to confirm which shop this is, by name and address, so nothing acts on the wrong one'),
  ('etsy', 'revenue', 'real', 'listings_r',
   'to see whether the listing is still up, and what it says'),
  ('etsy', 'revenue', 'real', 'transactions_r',
   'to read the orders and the fees Etsy kept, so what it earned can be reconciled');

CREATE TRIGGER sense_provider_scopes_constitutional_insert
BEFORE INSERT ON sense_provider_scopes
BEGIN SELECT RAISE(ABORT,'sense_scope:constitutional'); END;
