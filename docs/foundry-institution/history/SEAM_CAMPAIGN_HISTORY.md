# Seam campaign — batch history

HISTORY, NOT INSTRUCTION. This is the narrative record of the seam campaign
batches: what each one looked at, what it found, and why. It is kept because
the reasoning is the valuable part — most of the laws in `CONSTITUTION.md` and
the failure classes in `DEVELOPMENT_INSTITUTION.md` were derived here, and a
future steward re-deriving them from scratch would be paying twice.

Nothing in this file sequences work. Nothing here is a backlog. The live
frontier is `AUTONOMOUS_CAMPAIGN_STATE.md`; current verified reality is
`IMPLEMENTATION_STATE.md`. If this file disagrees with either of those, they
win — this is a record of what was true when it was written.

## Batches 35–41: principal, axis, absence, unit, temporal validity

**An API key satisfied a check for the human owner.** `actingSubject` read a bag
of identity fields that three different authenticators wrote into, so
"who is acting" was answered by whichever middleware had run. Four discriminated
principal kinds now exist — human session, public API key, ingestion credential,
internal service — and ambiguity between two of them fails closed rather than
picking one.

**A rule that grows an axis breaks every hand-copied piece of it.** Migration 145
gave commercial entitlement its own column. Two readers carried
`scp_status <> 'paused'` with a comment explaining why that was complete — and
it had been, when written. Both stopped seeing a cancelled subscription: the
institutional authority read, and the model-spend gate. A fragment is not a copy
of a rule; it is a snapshot, and the rule grows. There is now a gate for it.

**A three-company floor was published as statistical significance.** The owner's
decision is explicit that `MIN_CONTRIBUTORS` and `PEER_SIGNAL_MIN_SAMPLE` are
conservative eligibility floors. The dashboard card said so. The generator told
the model the opposite, twice, and the confidence number the model invented was
stored, used to rank, and rendered beside an "avg impact" that was its estimate
rather than a measured mean. **The place a claim is made is not the place it is
worded — check the prompt, the column name, the ranking key and the injected
context separately.**

**A rule that did nothing reported success every time it fired**, and
**an experiment that could not tell recorded the hypothesis as disproven.** Two
instances of one shape: a vocabulary with fewer names than there are outcomes,
so the outcome nobody named got filed under a neighbour that reads as a result.
Migration 147 added the missing name.

**Erasure could not complete on any company that had ever used the product.** The
erase list was derived from `product_id`, which made it undriftable for the 215
tables that carry it. Fifty-five do not. Twelve are children of erased tables,
seven of those foreign keys are `ON DELETE NO ACTION`, and the connection runs
with `foreign_keys=ON` — so `DELETE FROM chat_sessions` raised for any company
with a single chat message. And the per-product catch its own comment described
did not exist, so one such company blocked every other founder's erasure, daily.
**A derived list is only undriftable along the dimension it derives on.** Every
table in the schema is now classified into exactly one bucket, with a gate that
fails on `UNCLASSIFIED`.

**What the lens is good for next.** Temporal semantics were read and came back
mostly clean — `memory_nodes` orders on `occurred_at`, the judgment observer
deliberately uses record time — so the yield moved elsewhere. `updateResults`
and `validateHypothesis` were unreachable when their tenant scope was fixed:
**the unreachable half of a file is where the conventions of the reachable half
quietly do not apply.**

---

## Batches 42–44: queries that raise, and the tests that agreed with them

**The SELECT column-drift baseline is empty.** Thirty-four single-table queries
selected columns that do not exist. Seven of the twelve company agents failed
on their first data-gathering step and had never completed a run; the founder's
daily briefing has shown no signal score and no MRR growth since the columns
were renamed, inside a catch whose comment reads "signal_history may not exist
yet"; the M&A report scored every company as having no growth history and no
NRR, four of its points, because the comment said "use stored nrr if available,
else derive" and there was no `nrr`, no `else`, and no derivation.

**Then eighteen more that a parser could not see.** The static gate says what
it skips — "anything with a JOIN or an alias" — which leaves the queries most
likely to be wrong outside it. SQLite resolves what a parser cannot, so a gate
now prepares every literal statement against the migrated schema. It found the
public metrics endpoint 500ing on every correction to a submitted date, the
Slack briefing push reading a table that does not exist, and the webhook
cleanup job deleting on a column its table does not have. **A derived list is
only undriftable along the dimension it derives on; a static gate only sees
what its parser can resolve. Both need a runtime check behind them.**

**And the reason none of it was caught.** A third of the test suite built its
own schema. `team-health.test.ts` created eight tables "just enough to test the
computation path", two of them wrong in exactly the way the service was wrong,
and fourteen assertions passed green against a database that exists nowhere.
Converting 22 files to `runMigrations()` surfaced what a stand-in leaves out
every single time — NOT NULL columns, closed vocabularies, foreign keys,
delete ordering — and found two live defects introduced by earlier fixes in
this campaign: a gateway refusal and an unconfigured push each wrote a status
value its table forbids, so both fixes were inert in production and correct
only against the fake.

**The rule this batch earns.** A test that constructs its own reality tests the
code against the test's beliefs. The one thing it can never catch is the two
being wrong together — which is the commonest way this fails, because whoever
writes the fixture reads the query to decide what columns to create.

---

## Batches 48–50: one rule, and the door that was built later

**`checkKillSwitch` had exactly one caller.** Foundry has two paths that produce
outward effects — `outbound_actions` through the gateway, and
`action_executions` through the SCP executor — and only the first checked
whether Foundry may act for the company at all. An approval on the second
posted to Slack, filed Linear tickets and called customer webhooks for
companies whose subscription had lapsed, whose founder had paused them, or
whose data had just been erased. Asking the question of every other effect path
found two more: the customer-facing webhook fan-out (there are two webhook
paths and only the other one was governed) and the Slack daily-briefing push.

The effects inventory had called two of them `control_path` — an honest
description of what they owned (credential, receipts) and a poor description of
what they checked. **`governed` now has to be demonstrable**: the audit proves
the file calls the kill switch or is a gateway-registered capability, and where
the guard genuinely lives in the callers they are named, because "the callers
check" is a claim about other files and that is the kind that stops being true
quietly.

**A rule with an implementation and no edge to it.**
`sender-of-record.ts` says Foundry must never be the From on mail to a
founder's customer, and its own header says "this lights the rule up BEFORE the
live path exists, so it can never regress open". It regressed open:
`assertSenderOfRecord` had zero callers, and the live send handler defaulted to
a Foundry domain. It could not have been enforced, because the "founder's own
connected sender" it presupposes did not exist — every send went through
Foundry's platform key, so no caller COULD satisfy it. **An unsatisfiable rule
is an unenforced rule, and the gap does not show up as a failure.**

Owner decision: build the missing half. Migration 150 gives each company its own
sending identity — the founder's provider credential and the From their
customers see — so third-party mail goes out as them, through their account,
against a domain their provider verified. Foundry cannot verify domain
ownership and does not pretend to; the party who can is the one who does.

**And then the refusal had nowhere honest to land.** The gateway mapped every
handler throw to `execution`, which callers read as "we do not know what
reached the outside world" and answer with a reconciliation window. A message
refused before the provider was touched is the opposite fact. Phase `refused`
now exists, carried by a flag on the error rather than a taxonomy of failure
types nobody would keep accurate.

**What this run of batches has in common.** Every one is a rule that exists,
is believed, and has no edge between it and the thing it governs — a guard with
one caller where there are two doors, a rule with no mechanism to satisfy it, a
classification recording a property nobody checked. **Ask of every stated rule:
what is the path from here to the thing that would break it, and does anything
actually traverse it?**

**Batch 51 is the same lens, applied to a schema instead of a function.**
`team_members` has carried five permission columns since migration 010 —
`can_view_decisions`, `can_vote_decisions`, `can_view_financials`,
`can_view_audit`, `can_trigger_actions` — written by the invite flow and read
by nothing. An `investor_observer` could vote on a company decision, and those
votes feed the co-founder alignment score. The columns were not decoration:
`can_trigger_actions` defaults FALSE while the others default TRUE, which is a
considered position written into the schema and then never asked.

## Batches 53–59: where is the edge?

**Two company authorization models, and the guards read the empty one.**
`account_roles` held a viewer/analyst/admin/owner ladder; `assignRole`, its only
writer, had no callers anywhere, so no row was ever created. `requireRole('admin')`
reduced to the owner check inside it — seventeen routes that read as "an admin
may do this" were owner-only in practice — while `team_members`, what the invite
flow actually writes, carried the real permissions and nothing consulted them.
Owner decision: membership is canonical, ownership is a distinct and stronger
property, a role label grants nothing. Both dead tables dropped (152).

**A member could not arrive.** The dashboard listed companies by `owner_id`, so
a founder could invite a co-founder, have the invitation accepted, and that
person would open the dashboard to nothing. The team feature was a surface you
could be let into and then not reach. Fixing that made the permission columns
urgent rather than decorative — an observer could now open financial pages, the
audit trail and action approval — so all six now have router-level edges, with a
gate that iterates the capabilities and fails on any that is stored, typed,
written by the invite form and read by nothing.

**The alignment score counted votes their caster was never entitled to cast.**
Refusing new ones stops the intake; it does not clean what the intake accepted.
The rows stay — what happened is evidence — and the canonical score now counts
only votes whose caster is entitled *today*. `scripts/audit-unauthorized-votes.mjs`
answers "did it happen" against a real database rather than assuming.

**The governed ratchet let a type-only import through.** Mutation-testing found
it: delete the guard, add `import type … from '…/gateway.js'`, and the file
still proved it was governed. A mention is not a call. It requires
`checkKillSwitch(` or `registerToolHandler(` now, with type imports stripped.

**The public API never asked whether Foundry may act for the company** — no
entitlement check anywhere in `/v1`. Spend and outward effects were refused two
layers down, so an agent run failed in the middle rather than succeeding; but
ordinary writes are neither, and `POST /v1/customers`, `/v1/metrics/snapshots`
and `/v1/experiments` all worked for a lapsed or paused company. Read-only was
true of two layers and false at the surface. MCP needed its own answer, because
`tools/call` is one POST carrying twenty consequences.

**Two things this run proved rather than fixed**, and they belong in the record
as much as the defects: a pause reaches work that was already queued (planned
while operating, executed after — no effect, in all three states), and
reconciliation of an effect that already crossed the provider boundary is not a
new authorization and still runs for a paused company.

---

**Batch 52 found the same shape once more, in the second erasure door.** The
Clerk `user.deleted` webhook deleted by hand — `DELETE FROM products` per
company, then `DELETE FROM founders` — and raises, for the same reason the
erasure path did before batch 41: seven foreign keys into products'
descendants are `ON DELETE NO ACTION`. Account deletion via the identity
provider has never completed for a company that ever had a chat message, and
left no record of having been attempted. Had it succeeded it would have deleted
the evidence that the erasure happened, the financial records that must survive
it, and the idempotency keys that stop a retry re-sending a real message. **When
a path is fixed, look for the other door onto the same room** — this campaign
has now found three: the outward effect, the approval, and the erasure.

**And it surfaced a reachability gap that needs an owner, not a fix.** There are
two role systems with no edge between them. `account_roles` is what
`requireRole` reads, and `assignRole` — its only writer — has no callers, so no
row is ever created and `requireRole('admin')` reduces to the owner check above
it. `team_members` is what the invite flow writes. Nothing bridges them, and
the dashboard lists companies by `owner_id`, so a founder can invite a
co-founder, have the invitation accepted, and that person sees no companies at
all and can reach exactly two endpoints. Per §13 that counts as broken rather
than secure — but what each role should see and do is a product decision, and
widening authorization is the direction where guessing is dangerous. Pinned in
tests so the answer changes deliberately rather than by drift.

---

## Batches 45–47: a value the column cannot hold

**Three defects of one shape arrived together**, and all three were decidable
without running anything: `outbound_actions.status = 'refused'`,
`push_log.status = 'not_configured'`, and `board_packets.status = 'reviewed'`.
Each raised at runtime; each sat inside a catch that treated the failure as
unremarkable; what a founder saw was a button that did nothing, a receipt that
never appeared, an action stuck at `executing`. The third had a further cause
worth naming: `board_packets` was created by migration 011 with one vocabulary
and *redefined* by migration 039's `CREATE TABLE IF NOT EXISTS` with another,
which was a silent no-op — and the code was written against the version that
never ran.

**Then the same lens on reads, which is where it got expensive.** A value that
cannot be written is a value that cannot be found, and a `WHERE` clause looking
for one does not raise — it matches nothing, quietly, forever:

- the voice-approval path looked for `action_executions.status =
  'pending_approval'`, which is `outbound_actions`' spelling. It has never
  approved anything. And the first time it worked it would have approved the
  wrong effect, because it took the most recent pending action and never read
  the `context` naming what the founder was replying to.
- founder-pattern synthesis counted `decisions.status = 'resolved'`, a value
  that vocabulary has never had, so it has never run for anybody.
- Compass read `company_okrs WHERE status='active'`, so its view of the
  company's objectives has always been empty — and an agent with no OKRs in
  context reasons as though the company has none.
- the rapid-override signal counted `IN ('cancelled','rejected')` on a table
  with no `rejected`, so it counted half of what it is named for.

**`action_executions` and `outbound_actions` are the trap.** Two tables with
similar purposes and different status vocabularies — `pending` versus
`pending_approval`, `completed` versus `executed`, `rejected` on one and not
the other. Four of this stretch's defects are that confusion. The gate now
holds the line on all three positions a literal can take: written, compared,
and listed in an `IN`.

**Found by surveying the eighteen places where a write sits inside a catch that
does nothing.** Every defect in this stretch hid behind one. Two more came out
of that survey directly: an automation rule whose action type nothing
implements counted itself as having fired and incremented the number a founder
reads to decide it is working; and the institution chat told a founder it had
recorded a decision it had not, because the model writes "I've recorded that"
before the ledger write it describes.

**Where the lens stops.** A follow-on detector — values a query looks for that
nothing anywhere writes, without a `CHECK` to check against — returns 24
candidates and all of them are noise: schema defaults and parameterised writes
look identical to absent ones from the outside. Recorded as tried, not built.

---

## Batches 60–62: four doors, one consequence

The lens that produced batches 53–59 — *where is the edge between the rule and
the thing it governs?* — turned out to have a sharper form: **how many doors
reach this consequence, and do all of them ask the same question?**

**A standing order was autonomy with a different name.**
`execution_playbooks.auto_execute` is a checkbox labelled "no approval
required", and it meant that literally: the evaluator created an
`action_execution` and approved it in the same breath, under the approver id
`system:playbook`. It reached none of the machinery that governs every other
autonomous act — not the trust ladder, not the platform cap, and not the
consent ledger whose own doc comment reads *"the gate: no autonomous 'act'
without this."* So every lever that stops Foundry acting on its own — turning
the dial down, revoking consent, letting a time-boxed grant lapse, a demotion
after a bad outcome — left a standing order sending exactly as before. A rule
believed by three call sites and unknown to a fourth is not a rule.

The gate reuses the existing categories rather than inventing a permission of
its own: an action that leaves the founder's connected tools is *outreach* and
answers to the outreach dial and cap; everything else answers to a `playbooks`
dial that becomes visible in Controls the moment a playbook exists. A refused
auto-execute leaves the action **pending** rather than cancelling it — the
founder still gets the action, in the queue, where the human eye the refusal
was protecting actually is.

Worth stating because it is a real product consequence rather than a bug fix:
the platform holds outreach at *suggest*, so an auto-executing `send_email`
playbook cannot fire on its own today. That is the rail `outreach.ts` already
documents. Lifting the cap is an operator decision, not a checkbox on a form.

**The gate written to stop that recurring found two more instances the first
time it ran.** `check-autonomous-approval.mjs` fails when a caller of
`approveAndExecute` asks none of the questions that count as asking, and when
an execution status is advanced outside the executor — approval is a status
transition, and a file that writes it has stepped around every check the
executor makes.

- **Voice approvals set a status and stopped there.** Nothing in the system
  ever picks an approved execution up again: the only transition out of
  `approved` lives inside `approveAndExecute`, two lines after its own claim.
  The founder said "yes, go ahead", the row stopped being pending, the effect
  never happened, and the action left the pending queue — the only place the
  dashboard would have let them approve it properly. It did not merely fail to
  act; it *stranded* the action out of reach of the path that works.
- **Three doors reached that routing and one of them asked something.** The
  click path runs through `can_trigger_actions`. The dashboard voice route
  asked nothing. The mobile webhook — an API key, not a human session at all —
  checked only that the key was live and scoped to the product, so a key issued
  with `agents:read` could approve and send. The approver was recorded as the
  constant `'voice:founder'`: not a principal, a category.

A key acts as the person who issued it, bounded by its scopes; both halves
matter and neither substitutes for the other. An empty `created_by` names
nobody and holds nothing, so an approval through such a key becomes a note
rather than an effect.

**Then the same question across the whole dashboard.** 116 mutating routes had
no capability check. Most are ordinary company work an active member should be
able to do; these were not: the agent authority level, assisting-authority
grants, connection grants, the autopilot dial (which raised to `act` records a
consent in the acting founder's name), the digest send, the letter reply send,
a second approval surface for integration actions, scheduling erasure of the
selected company, and storing third-party credentials.

Deliberately left open, and asserted so it stays open: every route that only
**lowers** what Foundry may do — panic, disconnect, grant revocation. Making
the brake harder to reach than the accelerator would be the same defect wearing
a safety label.

**And the guard was looking at a different company than the handler.**
`getLayoutContext` resolves the acting company as: the company named in the
path, then the cookie, then the first company the person can see. The guard's
subject read stopped at the cookie, so a founder with no selection set was
refused on routes whose handlers would have worked, and on `/products/:id/…`
the guard asked about the cookie's company while the handler served `:id`. One
resolution rule now, for both. An id the caller cannot see is passed through
unchanged so the capability check fails on it, rather than being replaced by a
fallback.

**Proved, not fixed.** Two probes returned clean and are recorded rather than
repeated: multi-company work selectors with no state filter (0 — the
entitlement→work-selector edge is total), and the consent edge across the
autonomous departments. Four of five department modules mention no consent
predicate, which looked like the defect class; tracing it showed they consult
`getEffectiveMode` and only *propose* — gate-2 and gate-3 decisions, or
executions created `pending`. `success.ts` is the only one that acts, and it
checks `activeConsent`. The grep was wrong, not the code.

---

## Batches 63–72: the instruments, and the writes that never landed

**Who has a say.** Resolving a decision is the institution's central act, and
`can_vote_decisions` is the permission that exists to say who has a say in one.
The two had never met: the dashboard door scoped on `p.owner_id`, so a
co-founder holding the permission could not resolve, and the MCP door proved the
key's scope and the company's entitlement but never asked whether the key's
ISSUER may decide. Every human door also wrote the same four letters —
`decided_by` is a KIND ('founder' / 'second_self') and has to stay one, because
the shadow ledger and the demotion path read it — so a company with three
founders recorded 'founder' for all of them. Migration 153 puts the identity
beside the kind rather than inside it.

**A ratchet instead of an audit.** The dashboard scan that found 116 mutating
routes asking no capability became a baseline that may fall and never rise.
Deliberately a ratchet rather than a wall: most of those routes are ordinary
company work, and gating them all would be the other defect. Routes that only
LOWER what Foundry may do belong on the list with a comment, not behind a guard.

**Then the instruments turned on themselves**, and this is the part worth
remembering. Two gates had this campaign's own defect class inside them:

- `check-route-guards`'s route-declaration pattern was unanchored, so `const
  founder = c.get('founder')` matched as a route and truncated every handler
  above it to one line — hiding every inline check.
- `check-sql-columns` found `UPDATE products SET a_column_that_does_not_exist`
  perfectly well, printed it, and exited 0. Every time. `lint:columns` chains
  with `&&`, so the line went into a log nobody read and the build went green.

Neither was findable by reading the script. Both took giving it something it
should refuse and watching what it did. Every static gate now has a planted
defect it must catch, asserted on the EXIT CODE, plus the other half of the
mutation — all of them green on a clean tree. The check-vocabulary gate's scan
windows were widened (they stopped reading part-way through 80 statements) and
overruns now fail rather than pass silently; the effects inventory now reports
outward calls its rules cannot see rather than omitting them.

**Writes that never landed.** `check-insert-columns` proves every column an
INSERT names exists; it cannot see the opposite — a column the INSERT does NOT
name, which the table declares NOT NULL with no default. Five instances, all
from a later migration redefining a table with `CREATE TABLE IF NOT EXISTS` (a
silent no-op) while the code was written against the definition that never took
effect. Three of them make a PAID MODEL CALL FIRST, so the founder pressed
Generate, the money went, the narrative was written, and then the write raised:
board packets, investor updates and growth experiments have never produced
anything for anybody. `check-notnull-inserts.mjs` closes the class.

The board packet had a second defect on the same page: "Key Decisions This
Quarter" read `agent_decisions`, a table with no INSERT anywhere in the
codebase, inside a catch that made an empty result and a missing table produce
the same sentence. A document founders send to their INVESTORS has said "No
recent decisions." for every company in every quarter.

**Four owner decisions.**

1. *The outreach cap stays at suggest*, permanently and by decision rather than
   pending a prerequisite. The sending identity makes a send SAFE, not
   SUPERVISED — it puts the founder's domain and CAN-SPAM liability behind the
   message, which is exactly why a human should decide it goes.
2. *`agent_decisions` is deleted*, with the empty inbox tab and the public
   endpoint that could only ever return `{"data": []}`. Same disposition
   `account_roles` got, for the same reason.
3. *A company on its way out stops acting.* A scheduled erasure is a third pause
   axis in `operatingProduct()`, so it reaches all 34 call sites at once. One
   stated exemption: the public API's write gate ignores it, because the window
   exists so the founder can change their mind.
4. *Spending the company's money is not watching.* ~54 routes reaching a paid
   model call now ask `can_trigger_actions`. Baseline 87 → 34. What stays open —
   panic, pause, disconnect, revoke, undo, attention telemetry — is asserted in
   tests, because making the brake harder to reach than the accelerator is the
   same defect wearing a safety label.

---

## Batches 73–79: a rule with nothing on one side of it

By this point the campaign's characteristic finding has a name. It is not a
broken rule. It is a rule with nothing on ONE SIDE of it — a reader with no
writer, an enforcement with no control, a control with no enforcement, a
recording nothing acts on. Four probes, one per side:

**Read but never written (tables).** Eight, and none harmless: `agent_decisions`
(an inbox tab, a public endpoint returning `{"data": []}` forever, and the
investor board packet); `deletion_requests` and `data_export_requests` (a second
Article 17 erasure deleting ~25 tables of ~266 and then writing
`status='completed'`, beside a live and correct one); `cofounder_profiles`
(which made EVERY founder read as solo, so the product told founders with
co-founders they were building alone); `customer_notes`, `chat_webhooks`,
`decision_snooze_log`, `daily_actions`, `ai_usage_log`. All closed, and
`check-writerless-tables.mjs` holds the baseline at zero.

**Read but never written (columns).** `experiments.learnings` was the outcome
column both investor documents read; concluding an experiment writes `winner`,
`results_json` and `early_stop_reason`, never that. `products.cadence_mode` was
the reverse — weekend mode had an enforcement in the scheduler and no way for a
founder to turn it on. The column-level probe returns two dozen false positives
(runtime-assembled column lists, columns maintained by migration triggers) and
was deliberately NOT made a gate: a check that noisy teaches people to ignore
it, which is exactly how two gates came to be trusted while broken.

**Written but never read.** Surveyed, 23 candidates, and recorded rather than
acted on. The class is weaker: an unread recording wastes work but does not lie
to anybody. The one that is a real gap — peer reviews a founder submits that the
reviewee can never see — is an owner disposition, not a defect. `auto_execution_log`
turned out to be a redundant second log beside `action_drafts`, which is read.

**Not named at all.** `check-notnull-inserts.mjs`: a column an INSERT does not
name and the table will not accept as absent. Five instances, three of which
make a paid model call FIRST — so board packets, investor updates and growth
experiments have never produced anything for anybody, and the founder saw a
button that did nothing after the money had gone.

**Three claims to a person, from a source that could not support them**, all in
this stretch: the board packet telling investors the company decided nothing;
the investor documents showing experiments with no outcome; and the insight
telling a founder with three co-founders that they were building alone. The
first two under-report to a third party. The third tells someone something false
about their own life, at the moment it is designed to land hardest.

---

## Batches 80–84: the door beside the rule

**A comment is not a vocabulary.** `decisions.decided_by` was created with its
values in a comment — "founder, system_gate_0, system_gate_1" — and two of the
three have never been written by anything. The comment was not inert: the
Letter, the institution's daily statement to the founder about what it did for
them, asked for `decided_by IN ('system_gate_0','second_self')`, so half of
"what Foundry handled" was a term that could not match. It survived review
because the schema said it was real. Now a CHECK, which makes the database
refuse it AND brings the column under `check-check-vocabularies` — the
difference between a rule that is documented and one that is enforced. Fourth
instance of this exact class after pending_approval, reviewed and resolved.

**The weekly report told the founder nothing had lapsed.** `decisions.status`
has permitted 'expired' since migration 001 and nothing ever wrote it, so the
number of decisions that expired unacted was structurally zero — and those
decisions sat pending forever, indistinguishable from ones still worth making.
A nightly sweep now expires the ones that carry a deadline. Registered in
JOB_REGISTRY, not merely defined: the dead GDPR erasure deleted two batches
earlier was a function nobody called and nothing scheduled.

**The state machine had a door beside it.** Every rule about how a
responsibility may move is enforced BEFORE INSERT on the transitions ledger —
one rung at a time, evidence required, authority required from Assisting up,
shadow proof to enter Assisting, and migration 115's frozen boundary refusing
Operating outright. None of it was enforced on the responsibility row itself:
`UPDATE institutional_responsibilities SET state = 'operating'` skipped all six.
The constitutional invariant is *"Foundry may not silently redefine what Foundry
is allowed to do"*, and a governed column writable directly is exactly that.
Migration 159 requires a state change to be justified by the transition that
recorded it, and refuses birth into the frozen boundary. 160 does the same for
`disposition` — including the quieter attack, editing the REASON for a decision
that was properly made.

**And the fixtures had been going around it.** Seven test files set the state
directly, so each was asserting behaviour in a state the machine might never
have permitted — evidence fabrication at the fixture level, the same class as
the deleted test that inserted rows into `ai_usage_log` to prove `ai_usage_log`
worked. Building the honest helper is what showed how much they skipped:
entering Assisting needs a reconstruction claim, an expectation written while
Understood, a transition to Shadowing, and a comparison written while Shadowing.
The old fixtures wrote `state='assisting'` with no shadow record at all. One
fixture birthed a responsibility as 'operating' — the only place in the entire
codebase a responsibility was ever in the frozen state was a test that did not
need it to be.

**Mutation testing found three gaps in these batches' own tests**, which is the
point of running it: a destination-only justification (letting a demoted
responsibility climb back without earning the rung again), the missing birth
freeze, and `<>` instead of `IS NOT` — the last mattering precisely because the
FIRST write to a NULL justification column is the one that invents a judgement
nobody made.

---

## Batches 85–88: what can never be written at all

The applied-columns gate asks *what can be written around a rule*. Turning the
question over — *what can never be written at all* — found the sharpest defect of
the campaign so far.

**Six more doors beside the rules**, found by the gate on its first run.
`responsibility_candidates.status` could be set to 'promoted' by a plain UPDATE,
with no founder anywhere near a decision the lifecycle guard requires an
authenticated owner for — a missing authorisation, not a missing audit trail. And
the three reference columns on a responsibility — the proof behind its state —
were checked on the transition ledger and nowhere else. Those are guarded
differently on purpose: a re-grant legitimately replaces `authority_ref` without
a state change, so what must hold is not "a ledger moved this" but "the thing it
names is real and still valid".

**And writing that guard broke every migration.** `splitSqlStatements` tracks
BEGIN..END so semicolons inside a trigger body do not split it. A `CASE ... END`
closes with the same keyword the body does, so the CASE's `END` cancelled the
trigger's and SQLite reported "incomplete input" on a well-formed statement. The
function's comment said it respected trigger bodies; it respected the ones nobody
had written a CASE in yet.

**A founder who had ever dispositioned a judgment could not be erased.** Two
rules in direct contradiction: `institutional_judgment_dispositions` is
append-only (migration 118), and the erasure plan classifies it
`erase_by_product`. The trigger aborted, the failure was recorded rather than
swallowed, and because the founder row is deliberately left intact when any
company fails, NOTHING was erased and the person stayed. For as long as both
rules have existed. Append-only means history is not rewritten; it does not mean
a person's data outlives their right to have it removed. The delete guard now
permits exactly one case — the company is marked for erasure — and editing stays
absolutely refused.

The other half was that the immediate erasure path set no marker at all, so an
append-only ledger had no way to tell a genuine erasure from an attempt to
rewrite history and refused both.

**And NOT_COMPANY_DATA decided nothing for the one table that needed it.**
`tablesToErase()` never consulted that list — it was only reachable for tables
WITHOUT a `product_id` — and `classifyTables()` tested `byProduct` first, so it
reported `erase_by_product` for a table its own list said was not company data.
Declared in one place and contradicted in another, inside the erasure classifier
built during this campaign. The immutability trigger on `system_identities` had
been doing the work the classification should have done.

Two properties now hold as tests: no table the erasure plan must clear may carry
a trigger refusing every delete, and every table carrying a `product_id`
accounts for itself in one of three ways with a written reason — erased,
retained for a purpose, or not a customer's data.

---

# BATCHES 89–92 — ABSENCE, COMPLETENESS, AND WHERE THE GATE WAS LOOKING

The lens for this stretch: **the system has no observation of X, so the system
asserts X does not exist.** It turned out to be one defect wearing five
costumes, and one of them was a gate.

## Erasure was not complete, and the classification could not have known

The proof changed shape. Every earlier erasure test asks a question about the
PLAN — is each table classified, is the plan ordered, does it converge. That
cannot answer the only question a founder has, so a new test seeds a company
into every table carrying a product id or a founder id, erases it, and then
sweeps EVERY COLUMN OF EVERY TABLE for the product id, the founder id and the
email. Hand-picking seven tables and sweeping two hundred proves almost
nothing: an empty table passes for free, so a forgotten table looks exactly
like a handled one. Seeding is asserted against a floor for the same reason.

It found two things a classification structurally could not.

**Twelve founder-scoped tables survived an account erasure untouched.**
`eraseFounderAccount` erased every company the person owned, redacted the
`founders` row, and stopped. `FOUNDER_SCOPED` listed these tables with a
sentence each explaining why they survive erasing ONE OF TWO COMPANIES — which
is right, and which is only half the question. Nobody had asked the other half.
So after Foundry reported an account erasure complete, the founder's health
circumstances, their voice, their devices, their Slack workspace token, their
peer-network profile and their referral history were all still there, keyed to a
founder id that still existed. Being out of scope for a product erasure had been
read as having been decided about.

Two of the fifteen ops are deliberately not deletes. An introduction names a
SECOND founder and a referral conversion is the REFERRER's attribution; both
sever the erased person's linkage and clear what they themselves wrote, leaving
the other party's record whole. Deleting those would erase somebody who never
asked for anything.

**And the daily spend rollup carried both ids under another name.**
`ai_daily_spend` keys on `scope_id` — a product id when scope='product', a
founder id when scope='founder'. It sat in NOT_COMPANY_DATA under the reason
*"keyed by scope, not by company row"*: a negative claim about a table that
names both the company and the person, and one nothing could contradict, because
the classification finds company data by looking for a `product_id` column. It
is a derived summary written by an AFTER INSERT trigger, so a company's per-day
activity trace outlived the company. Erased on both axes; the scope='global' row
names nobody and stays, so an erasure cannot hand back budget that was spent.

The sweep now derives its allowed survivors from the erasure's own retention
dispositions rather than a list in the test file. A new table that quietly keeps
a company id cannot be made green from inside the test.

## Identity had been standing in for purpose

`companyMayBeChanged` returned `allowed: true` for the whole API write surface
whenever the only thing stopping a company was a pending erasure — because the
thirty-day window exists so the founder can change their mind, and refusing
their writes for a month punishes a reversible click.

The reasoning is right and the exemption did not serve it. The write that
changes their mind is `POST /privacy/delete/cancel` on the dashboard, and
`requireOperatingForWrites` is mounted on the v1 API alone, so the reversal
never passed through the gate opened for it. What the exemption actually reached
was creating customers, recording metrics, opening experiments, running agents,
and — through the voice webhook — APPROVING AN ACTION FOR EXECUTION.

The verdict reports the axis now instead of waiving it, and the three reasons a
company may be unwritable stay three. Permitted purposes are not empty:
disconnecting an outbound webhook reduces what Foundry can do to the world, and
a company being deleted should not wait thirty days for it. Anything not on that
list is refused, so a route added later joins the refused set by default.

## An unread source is not an empty one

The morning audio brief's fallback segments — used whenever the model call did
not return — said *"No significant signals detected in the last 24 hours"*,
*"Your agents are running and monitoring your business"*, and *"No immediate
action items require your attention right now"*, and the catch that produced
them swallowed the error without a word. The one case in which Foundry had
observed nothing at all was the case in which it told the founder, out loud,
first thing in the morning, that there was nothing to see. The stated window
made it worse rather than better: "in the last 24 hours" is the sound of a
search that happened.

Three situations were being described with one set of words. They get three now
— nothing connected, could not be written, looked and reported — and only the
third makes claims about what is there. No epistemic enum was created for this.

The investor update and the board packet had the same shape with higher stakes:
each section initialised to its own negative claim and wrapped in a catch that
discarded the error, so a query that threw sent the confident sentence to an
investor or a board. "No active risks" and "we could not read our risks" are
materially different statements and only the first was ever sent.

## A bounded queue that selects work it cannot do stops being a queue

`redTeamSweep` took the five oldest uncontested gate-3 decisions with no filter
on whether Foundry may act for the company. The pre-mortem spends money, so the
AI client refuses it for a company that is paused, unpaid or being erased — and
the `red_team_reviews` row marking a decision handled is written only after that
call returns. The refusal left no trace, `NOT EXISTS` stayed true, and
`ORDER BY created_at ASC LIMIT 5` picked the same five rows forever. Five old
decisions belonging to companies Foundry may not act for were enough to occupy
the whole window permanently. Each run logged five errors and reported itself
complete, while "no gate-3+ decision sits uncontested" was false for every
company at once. `scenarioAccuracy` had the same shape.

The action verifier deliberately keeps no such filter and now says why: the
effect has already gone out, nothing there spends, and a founder whose
subscription lapsed the day after Foundry emailed their customer is owed the
outcome more than anyone.

## Peer review is retired, and the gate that should have caught it was blind

`peer_reviews` had a live writer and no reader anywhere — no page, no API
response, no prompt, no report. A founder who submitted a review wrote it into a
table nobody has ever looked at, and got a `review_id` back as though something
had happened. No reader, no promise, no responsibility, no unique semantics: no
contract, and the reader was what the owner ruled out. The rows go because
keeping them is the defect — one founder's written assessment of another
founder's company, collected for a purpose that does not exist, held where
nobody can see it or ask for it back.

The route took a `product_id` out of the request body and wrote against it
asking nothing at all, so any authenticated founder could file a review against
any company. Survivable only because nothing read it.

**And `check-route-guards` scanned `src/routes/dashboard` and nothing else.**
It printed "unguarded mutating routes: 34" — a statement about one directory in
the voice of a statement about the system. `src/routes/api` holds eighty-one
more on the same session-authenticated surface. The gate's silence read as their
absence: the same defect as the product copy, the report that could not read its
source, and the table classified as naming nobody. The population is every
founder-authenticated route surface now and the baseline is 114, which is a
correction of measurement and not a relaxation — nothing is permitted that was
refused before. Token surfaces stay out because "which capability does this
member hold" cannot be asked where no member is present, and that exclusion is
tested in both directions.

## Yield

Still high, and the highest-yield probe of the stretch was turning an instrument
on itself — the route gate had been reporting a quarter of its own subject.

Twelve mutations planted across the new guards, eleven caught. Counted: seven
against the erasure dispositions (sever turned into delete, one party column
dropped, the whole founder-scoped sweep skipped, the erased party's own words
left in place, the named-key entry removed, the marker nulled, the scope
narrowing dropped); one against the bounded-queue filter; two against the audio
brief; two against the widened route gate.

The single survivor is recorded in the code rather than papered over: the
`where` narrowing `ai_daily_spend` by scope is defence in depth, not the
mechanism, because what actually separates the scopes is that `__global__` is a
literal no product or founder id can equal. Removing the clause changes no
behaviour today and no test catches it. It stays so the scope a delete means is
written down at the delete, and it becomes load-bearing the day a scope keys on
something an id could equal.

---

# Tranche: the first whole-system reassessment

*Moved out of the live frontier, which is for what a steward needs today.*

An independent whole-system reassessment replaced the seam-reading mode, and
it was the right change: the findings came from asking what Foundry can
OBSERVE and what it does with what it learns, not from reading subsystem
pairs.

**No gate in this repository had ever run in CI.** The trigger named `master`
and `main`; all development happens on a branch deliberately never merged,
with no PR open. Every gate was enforced by somebody remembering. And `npm run
check` — cited everywhere as THE composite and the evidence validation is
green — omitted thirteen gates, including the one ensuring every model call
names the company paying for it. A test derives the gate list from `scripts/`
now, so a gate nobody wires up fails rather than sleeps.

**Two evidence levels were inflated and are corrected down.** Two modules
carrying E2 claims have zero importers in `src/` — only their own tests reach
them. E2 means local runtime through production-facing services and there is no
production-facing service. Both are E1. An evidence level that only moves
upward is not a ladder.

**THE INSTITUTION HAD NO SENSE OF TIME.** The vocabulary it offers the founder
is date-shaped — "Something we owe someone by a date" — and the schema could
not record one. The code said so twice, unprompted: every judgment emitted
`deadline unknown` because `Demand.deadline` had no supply, and the judgment
observer records that it can never report `contradicted` without an observer
that can see a deadline pass. Time is also the only company fact Foundry can
establish with no founder, provider or integration — a clock is all it needs —
which makes it the first sense the institution supplies itself. The date comes
from the company, never from Foundry, on the same constitutional line
migration 137 draws for outcomes.

**Outcomes were recorded and read by nothing.** The sharpest instance was the
moment Foundry asks for MORE AUTHORITY: it counted how many checks it had run,
weighing `matched` and `deviated` equally, and never consulted whether its
previous assisted actions had failed. The founder now sees both while deciding.

**A paid frontier call bought nothing** — Opus classifying an outcome the
database already recorded as `outcome_valence`, filed in a column no SELECT
reads. Deleted; the deterministic fact does the work.

**An adversarial security review of twenty routes found no exploitable
cross-tenant flaw** — a useful negative result — but did find that the
platform-admin boundary was made of array order: `founders.email` decides who
reaches an unscoped cross-tenant surface, and both provisioning paths wrote it
from `emailAddresses[0]`, neither necessarily primary nor verified.
