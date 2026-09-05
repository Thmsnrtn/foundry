-- WHAT THE ACCOUNT ACTUALLY SAYS, AND WHAT A REHEARSAL ACTUALLY PROVED.
--
-- Before asking the owner for money, the institution asked the provider what it
-- could legitimately ask. Three things came back, and one of them contradicts
-- something this record already said.
--
--   The Fly platform token this environment holds is a DEPLOY token. It cannot
--   list the organisation's own apps (403) and the Sprites API refuses it
--   outright (401 "authentication failed"). Sprites is therefore a separate
--   provider relationship, not a corner of the one already paid for. That is
--   the difference between "proceed, it is already covered" and "this is a
--   genuine owner boundary", and it was worth one request to settle.
--
--   The organisation is billable and current, which means the owner already has
--   a paying relationship with this vendor. Adding a plan is a new commitment,
--   not a new relationship.
--
--   THE TRIAL CREDIT IS NOT THERE. The credit balance on this organisation
--   reads $0.00. Migration 271 recorded a $30 trial credit from the vendor's
--   public material and correctly said eligibility could not be read from here.
--   It can be read now, and the answer is no. A card that offered him a credit
--   his account does not have would have been the sentence that made him say
--   yes and the one that was not true — which is exactly the failure mode this
--   institution keeps finding in its own records.
--
-- Nothing here was created, changed or bought. Reading an account is a sense.

INSERT OR REPLACE INTO substrate_evaluations (id, substrate, property, finding, source)
VALUES
  ('fly_sprites:trial', 'fly_sprites', 'trial credit',
   'NONE AVAILABLE TO THIS ORGANISATION, and this record previously carried the '
   || 'vendor''s public $30 figure with eligibility unknown. The organisation''s '
   || 'credit balance reads $0.00, so the trial must not appear on any card as '
   || 'money the owner has. The public offer may still exist for someone; it is '
   || 'not his',
   'api.fly.io GraphQL organization(slug:"personal"){creditBalanceFormatted} = '
   || '"$0.00", billable true, billingStatus CURRENT (read 2026-09-05)'),

  ('fly_sprites:relationship', 'fly_sprites', 'credential boundary',
   'SEPARATE FROM THE FLY ACCOUNT ALREADY IN USE. The platform token this '
   || 'environment holds is a deploy token: the Sprites API refuses it with 401 '
   || '"authentication failed", and it cannot even list the organisation''s apps '
   || '(403). So no existing approved budget covers this, and using Sprites '
   || 'means a plan and a credential the institution does not have. The owner '
   || 'already has a paying relationship with this vendor, which makes it a new '
   || 'commitment rather than a new relationship',
   'GET https://api.sprites.dev/v1/sprites and GET https://api.machines.dev/v1/apps '
   || 'with the deployed platform token (both requests made 2026-09-05)'),

  -- ─── WHAT THE REHEARSAL PROVED, WHICH IS NOT WHAT IT LOOKS LIKE ──────────
  --
  -- A chain that runs cleanly on the host is easy to describe as the whole
  -- thing working, and it is not. It proves the CONTRACT: material in, work
  -- run, artifact out, comparison, budget refused before spend, cost including
  -- teardown, teardown happening, publication never reached. Every one of those
  -- is a property of this institution's own code.
  --
  -- IT PROVES NOTHING ABOUT ISOLATION. The isolation property is a claim about
  -- an implementation somewhere else — that the work really ran on a computer
  -- the institution is not, that a real provider really billed for it, that a
  -- real workspace really came back or really went away. Only a real external
  -- substrate can answer that, and until one has, `reality_proven` is the
  -- correct thing for this record NOT to say.
  ('local_process:rehearsal', 'local_process', 'what a rehearsal here proves',
   'THE CONTRACT, NOT THE ISOLATION. Running the whole chain on the host proves '
   || 'the institution''s own machinery: material in, artifact out, comparison, '
   || 'budget enforced before spend, cost including teardown, teardown '
   || 'occurring, publication never reached, and real work correctly refusing '
   || 'when no real isolated substrate is available. It cannot prove that work '
   || 'runs somewhere the institution is not, because here it did not. That '
   || 'property is reality-proven only by a real external workspace',
   'src/services/institution/carrying.ts and its rehearsal, reasoned about '
   || 'rather than read from a vendor');

-- ─── WHAT ACQUIRING SOMETHING ENABLES, AND WHAT IT STILL DOES NOT AUTHORISE ─
--
-- The distinction this institution will meet again and again as it acquires
-- isolated compute, research providers, model providers, datasets, monitoring,
-- licensed tooling and human expertise:
--
--   CAPABILITY ACQUISITION IS NOT AUTHORITY TO USE THAT CAPABILITY FOR ANY
--   PURPOSE.
--
-- The generic card already said so in one sentence. One sentence is enough when
-- the capability is small and nowhere near enough when the owner is being asked
-- for a recurring bill: he is entitled to read the list of what becomes
-- possible beside the list of what does not, in the same words, on the same
-- screen. Kept as two plain lists on the proposal rather than as a procurement
-- framework, because what must be durable here is the DISTINCTION.
ALTER TABLE capability_acquisitions ADD COLUMN enables TEXT;
ALTER TABLE capability_acquisitions ADD COLUMN does_not_authorize TEXT;
