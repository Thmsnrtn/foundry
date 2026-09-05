-- THE REQUEST SHAPES WERE WRONG, AND THE MONEY IS MORE THAN ONE FACT.
--
-- ─── THE CORRECTION ────────────────────────────────────────────────────────
--
-- This adapter posted to the collection with the name in a body, and sent exec
-- an argv as repeated `cmd` parameters. Both are the shapes most APIs use.
-- Neither is this one's: it creates with PUT on the name, and exec takes a
-- single `command` string in the body.
--
-- WHY NOTHING CAUGHT IT. A request with no credential never gets far enough to
-- be told its body is wrong. The 401 arrives first — so a real 401 from a real
-- host proves the service exists and the auth header is right, and nothing
-- whatever about what is being sent. That distinction was recorded as
-- "reached the real provider", which is true, and was then carried in the
-- column marked "proven request shape", which was not.
--
-- The fourth correction to this record in two days. Every one was found by
-- re-reading a primary source rather than by anything failing, which is the
-- argument for re-reading them.

INSERT OR REPLACE INTO substrate_evaluations (id, substrate, property, finding, source)
VALUES
  ('fly_sprites:shapes', 'fly_sprites', 'request shapes',
   'PUBLISHED, NOT EXERCISED. Create is PUT /v1/sprites/{name}; exec is '
   || 'POST /v1/sprites/{name}/exec with {"command": "..."} in the body; the '
   || 'credential is SPRITES_TOKEN on an authorization: Bearer header. The '
   || 'adapter first used POST-to-collection and repeated cmd parameters and '
   || 'nothing caught it, because a 401 arrives before a body is ever judged. '
   || 'Written to the published shapes now, and still never exercised',
   'https://sprites.dev quickstart (read 2026-09-05), correcting shapes '
   || 'recorded from a narrower reading the same day'),

  -- ─── WHAT $20 A MONTH ACTUALLY INCLUDES ─────────────────────────────────
  --
  -- The question this answers is whether ordinary work fits inside the plan or
  -- spills into metered overage, which is the difference between a predictable
  -- bill and an open one. It fits, by a very wide margin: the responsibility
  -- that raised this runs one workspace alive for seconds. A hundred runs a day
  -- at thirty seconds each is about twenty-five CPU-hours a month against four
  -- hundred and fifty included, and storage is nil because workspaces are torn
  -- down rather than kept.
  ('fly_sprites:plan', 'fly_sprites', 'plan required',
   'entry plan "Adventurer" at $20/month, which INCLUDES 20 concurrent active '
   || 'sprites, 450 CPU-hours, 1800 RAM-hours and 50 GB-months of storage per '
   || 'month, with community support. Usage beyond the included amounts is '
   || 'billed at standard usage rates. Seven higher tiers exist up to $2000; '
   || 'all but the top two are self-service. No free tier for creating sprites '
   || 'was found',
   'https://community.fly.io/t/more-sprites-plans/26857 plan table '
   || '(read 2026-09-05)'),

  ('fly_sprites:headroom', 'fly_sprites', 'does the plan cover ordinary work',
   'YES, WITH ROOM TO SPARE, for the responsibility that raised this. Keeping '
   || 'the schema description true is one workspace alive for seconds; even a '
   || 'hundred runs a day is roughly 25 CPU-hours against 450 included, and '
   || 'storage is nil because every workspace is destroyed. Expected overage '
   || 'is zero. That is a statement about THIS responsibility and not a '
   || 'licence for whatever asks next, which is why a separate ceiling on '
   || 'metered spend exists rather than the plan standing in for one',
   'the included allowances above, against the measured shape of the work in '
   || 'src/services/institution/carrying.ts'),

  ('fly_sprites:subscribe', 'fly_sprites', 'how a plan is taken',
   'self-service at https://sprites.dev/account/{org}/plan, which shows the '
   || 'plans table when there is no subscription and the current subscription '
   || 'when there is. Changing tiers was not yet available when this was '
   || 'written. The credential is issued in the vendor''s own surfaces and set '
   || 'in the deployment''s secret store — it is never typed into Foundry',
   'https://community.fly.io/t/more-sprites-plans/26857 replies 5-7 '
   || '(read 2026-09-05)');

-- ─── THE MONEY IS THREE FACTS AND A POLICY, NOT ONE SENTENCE ───────────────
--
-- A single cost note let a $0.25 first-proof ceiling sit beside a $20/month
-- recurring commitment as though they were the same kind of thing. They are
-- not, and the small number is the reassuring one, so running them together
-- reads as cheaper than the truth.
--
-- AND SUBSCRIPTION AUTHORITY IS NOT VARIABLE-SPEND AUTHORITY. A yes to a plan
-- must not become an unlimited-compute grant. Each fact is carried separately
-- so the card can show them separately and so the variable ceiling is a number
-- something can actually enforce.
CREATE TABLE acquisition_economics (
  id             TEXT PRIMARY KEY,
  acquisition_id TEXT NOT NULL REFERENCES capability_acquisitions(id),
  -- WHOSE MONEY THIS DESCRIBES, NAMED HERE EVEN THOUGH THE PARENT KNOWS.
  --
  -- Erasing an account deletes founder-scoped tables by this column and does
  -- not descend into children — that descent exists for the product tree and
  -- nowhere else. So a child of a founder-scoped table that does not name the
  -- founder is a row that quietly outlives the person, and what would have
  -- outlived them here is a record of what they were asked to pay.
  --
  -- A copied fact can disagree with the fact it was copied from, so the trigger
  -- below makes that impossible rather than unlikely.
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  kind           TEXT NOT NULL CHECK (kind IN (
                   'fixed_recurring','trial_credit','included_allowance',
                   'first_proof_ceiling','variable_usage')),
  -- What the owner reads on the left of the row.
  label          TEXT NOT NULL,
  -- NULL where the fact is not a number, which is most of the allowances.
  amount_cents   INTEGER,
  period         TEXT CHECK (period IN ('month','once','per_piece_of_work')),
  -- The sentence that makes the number mean something.
  note           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (acquisition_id, kind)
);

CREATE TRIGGER acquisition_economics_guard
BEFORE INSERT ON acquisition_economics
BEGIN
  SELECT RAISE(ABORT,'acquisition_economics:incomplete')
    WHERE trim(NEW.label) = '' OR trim(NEW.note) = '';
  -- A MONEY FACT WITH A NUMBER HAS TO SAY OVER WHAT. "$20" is not a fact; "$20
  -- a month" is, and the difference is the whole point of this table.
  SELECT RAISE(ABORT,'acquisition_economics:amount_without_period')
    WHERE NEW.amount_cents IS NOT NULL AND NEW.period IS NULL;
  SELECT RAISE(ABORT,'acquisition_economics:negative')
    WHERE NEW.amount_cents IS NOT NULL AND NEW.amount_cents < 0;
  -- The copy may not disagree with the original.
  SELECT RAISE(ABORT,'acquisition_economics:wrong_founder')
    WHERE NOT EXISTS (SELECT 1 FROM capability_acquisitions
                       WHERE id = NEW.acquisition_id AND founder_id = NEW.founder_id);
END;

-- ─── WHAT A YES TO A PLAN DOES NOT BUY ─────────────────────────────────────
--
-- The bounded variable grant, written when he approves and read where the
-- spending happens. Without this the plan approval would be the only gate, and
-- the only thing standing between a runaway responsibility and a metered bill
-- would be a per-workspace ceiling that resets every time a new workspace is
-- made.
CREATE TABLE workshop_spend_ceiling (
  founder_id      TEXT PRIMARY KEY REFERENCES founders(id),
  cents_per_month INTEGER NOT NULL,
  -- Which decision of his this came from, so it can be traced and withdrawn.
  acquisition_id  TEXT REFERENCES capability_acquisitions(id),
  authorized_by   TEXT NOT NULL,
  authorized_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER workshop_spend_ceiling_guard
BEFORE INSERT ON workshop_spend_ceiling
BEGIN
  SELECT RAISE(ABORT,'workshop_spend_ceiling:not_a_ceiling')
    WHERE NEW.cents_per_month < 0;
  SELECT RAISE(ABORT,'workshop_spend_ceiling:unattributed')
    WHERE trim(NEW.authorized_by) = '';
END;
