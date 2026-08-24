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

## The owner answered §10, §14 and §12

*Moved out of the live frontier when it stopped being what a steward
needs to start working today. The decisions remain load-bearing and are
recorded in the migrations that implement them.*

**The owner answered §10, §14 and §12, and all three are implemented.**

**§10 — split by kind.** Five tables sat marked `owner_decision`, holding an
erased person's identity inside companies they did not own. The answer:
authority and artefact are different things. `api_keys` and `mcp_grants` are
**revoked and removed** — an authority held by a principal that no longer exists
must not act, and handing it to the company owner would be inventing a grant
nobody made. `webhooks`, `deal_rooms` and `decision_votes` are **preserved and
their author severed**: the integration keeps delivering, the room stays open,
the vote still says which way it went, and NULL says NOBODY rather than naming
somebody who did not do it. Migration 175 made those three columns nullable,
which is the whole reason this was stuck — not indecision, an absent column
state. Revocation is not silent: each one writes into the company's own audit
trail, naming no person, because naming one would undo the erasure that caused
it. The disposition `owner_decision` no longer exists and a test asserts it
cannot return.

**§14 — split analytics.** The funnel recorded a NAMED founder's whole
progression whether "Help Improve Foundry" was on or off. It is two paths now:
service state (signup, repo connected, trial, paid) stays ungated and is
**disclosed in those words**, and the usage half is recorded **only with
consent** and then against a contributor hash. Minimisation first — no consent
means no row, not a row filtered out at read time, which would make the toggle a
display preference rather than a control. A step in neither list fails closed to
telemetry. The readout carries which population each count is over, because the
telemetry half is a smaller denominator by construction and a rate crossing that
boundary compares two different groups — the same provenance error the wisdom
network made. `product_telemetry_events` entered the erasure map in the commit
that created it: a pseudonym is not anonymity, and a table the erasure has never
heard of survives forever.

**§12 — a portfolio principal, not a global secret.** Possession of one
process-wide key read any company's entire operating picture by arbitrary
`product_id`. The two `/internal` routes that touch company data now resolve the
credential to a **principal with enumerated company membership** — no wildcard,
so a company outside the scope is a row that does not exist rather than a check
that could be written wrong. A principal may only be scoped to companies its
issuer OWNS, enforced at issuance and again by a database trigger, which is what
keeps a private portfolio principal from becoming a route into a commercial
customer's data. It fails closed today: until one is issued, those routes serve
nobody. **Rotating the deployed secret is the owner's own act and is recorded as
outstanding rather than reported as done.**

**Three interim positions are now in force** pending counsel, and they bind like
decisions: keep the shorter retention rather than lengthening by guess and never
call a redacted shell proven anonymous (a test holds that claim out of the
disposition strings); audit logs stay at 180 days as the interim default; and
**k = 5 is not a safe harbour** — cross-company benchmarking is counsel debt and
external proof debt before broad release, not something the local floor
demonstrates.



*One paragraph, deliberately. The narrative record is
`history/SEAM_CAMPAIGN_HISTORY.md`; this file is what a steward needs today.*

**The owner's direction on ethics, legitimacy and the private frontier landed
and was implemented rather than filed** — into the existing canonical artifacts,
no second ethics universe. The repository was then read for where the doctrine
had outrun the code. `ARCHITECTURE.md` names seven terms of the legitimate
action envelope; the **external-permission term is deliberately still absent**,
because it is counsel debt rather than a mechanism, and naming it before it
exists would be the claim this institution refuses to make.

**One vocabulary for who allowed it**, closing the two-ledger seam: four
spellings of `approved_by` became one principal reference
(`outbound/acting-principal.ts`), so a founder, a voice session, autopilot, the
institution and the system are told apart by kind rather than by string.

**A company that integrated properly was invisible to the departments that act
on customers.** `POST /api/v1/customers` — the documented external surface —
writes `customer_intelligence`, while success and outreach read `customers`.
`institution/company-customers.ts` is now the one accessor over both, and it is
the ONE place the at-risk and champion predicates are stated. See opportunity 5
for the cutover criterion.

**A failed reading looked exactly like a calm one.** `analyzeTranscript` ended
in a `catch` that logged and returned, so a week where every transcript failed
to parse rendered as a week with nothing to say. Migration 178 gives the failure
a durable place and the page renders it.

**One rule, two implementations, one enforced.** Contact refusal lived in the
outreach department only, while the governed email path — the one that actually
reaches a customer — never consulted it, and nothing could get onto the list.
It is now checked at the boundary where every outward effect converges;
migration 179 retired the third, inert do-not-contact column.

**A process failure worth keeping.** A commit went out with five red tests
because the exit code was read from a wrapper rather than from the run that
produced the log. And a killed validation run left `_gate_fixture_agent.ts` in
the working tree, where it was committed and then caught by the public-claims
audit as a thirteenth AI agent against "All plans include 12 AI agents".
`.gitignore` and a `beforeAll` sweep now handle the fixture; nothing but
discipline handles the exit code.

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

---

## One page, read line by line

**One page, read line by line, and almost every number on it was a claim
nothing measured.** `founder/intelligence.ts` is what the operator of Foundry
looks at. The lens was the plainest available — read the number, then find the
query that produced it — and it held for eleven consecutive findings. They are
worth listing together because the SHAPES repeat, and a steward who recognises
the shapes will find them faster elsewhere than by reading files.

**The constant wearing a measurement's name.** `total_jobs: 30, jobs_healthy:
30` under the comment "From job registry", when the registry has ninety and
nothing was read. `runway_months: 999` under "SaaS with low burn" —
eighty-three years, asserted by a comment, where nothing records burn at all.
`churned_this_month: 0`, `expansion_revenue: 0`, `override_count_7d: 0`,
`days_since_break: 0` under "Would track from activity gaps",
`top_acquisition_channels: []`. Each read as a measured absence.

**The quotient with an empty denominator, answered anyway.** The same mistake
twice over, and worth seeing in both directions: `auto_execute_rate` fell back
to **100** — the most reassuring number on the automation panel, printed
precisely when no decision had been made — and `avg_health_score` fell to **0**,
the worst possible score, printed for having scored nobody. Whether the fallback
flatters or alarms is an accident of which digit was typed. The same shape wrote
`?? 1` as a denominator, turning "no founders" into a real division.

**The default that makes an unobserved subject scoreable.** The Founder
Wellbeing card is colour-coded green above 60. A founder with no health record
took `motivation ?? 50` and `engagement ?? 'stable'` and scored **70** — a green
card about a person Foundry had never observed once. This is the one to
remember: it is about a person, a person reads it, and the reassurance is the
harm. Note the second-order trap found while fixing it — `engagement_trend`
carries `DEFAULT 'stable'` in migration 006, so a row written for any other
reason *looks* like an observation. A written default is not evidence.

**The page limit that became the measurement.** At-risk companies were read with
`LIMIT 20` and then every number derived from `rows.length`. The headline card
read "At Risk: 20" for any portfolio with twenty or more, and the rate divided
that capped numerator by an uncapped denominator, so it FELL as the real problem
grew.

**Two labels over one expression.** "Activation Rate" and "Trial → Paid" sat
side by side on the growth card as two measurements; they were the same line of
code twice. Two numbers that can never disagree are one number, and a reader
comparing them believes they have corroborated something.

**The name that belongs to someone else's money.** `PulseData.mrr` summed
`metric_snapshots` across all products — the operated COMPANIES' reported MRR
movement — and went out of the executive dashboard beside `mrr.current_mrr`,
Foundry's own subscription revenue. An alert read "MRR declined 14% this month"
about whichever the reader assumed. `mrr_history` was the same portfolio series
plotted as Foundry's own history. Not the same quantity, not the same company,
not even the same KIND: one a level, one a sum of movements.

**Revenue counted before anyone paid.** The Stripe webhook sets `founders.tier`
on `customer.subscription.created` *including* while status is `trialing` — that
is the branch that records `trial_ends_at`. Every trialist counted at full list
price in `current_mrr`, `arr`, `by_tier` and every forecast compounded from them.

**The label that is not the thing.** `churn_rate_30d` had no 30-day window and
was computed entirely from companies that were still active. `churn_this_month`
counted founders who signed up over a week ago and never subscribed — they never
paid, so they cannot have left. `activation_rate` rated an activation event that
does not exist.

**And the mirror image, which is the one a steward will miss.**
`last_audit_run: null` was hardcoded while `audit_scores` has a real writer and a
`created_at`. The fact existed and was thrown away, leaving the operator unable
to tell "never audited" from "not looked up". Discarding a fact is the same
failure as inventing one, and it does not look like a defect on the page.

**What could NOT be fixed, and why that matters more than what could.** Several
of these are null now rather than computed, and each null carries its reason in
the type: no tier-change history exists, so Foundry's own expansion revenue
cannot be derived; nothing records when a company churns, and the only archive
path that leaves a timestamp is ERASURE — a person exercising a deletion right
is not a customer leaving, and counting the first as the second would have been
the worst guess available; nothing records burn; nothing records founder
activity gaps. `override_count_7d` would still be null if it were wired up,
because `decision_quality_scores` has no writer at all —
`recordDecisionContext` is exported from `scp/founder/decision-tracker.ts` and
called from nowhere, which is why the override rates over there are permanently
zero too. A test now watches for a caller appearing.

**Then the same lens on the surfaces beyond it, where the stakes are higher.**
The operator page was read first because it was there; nothing about it was
special. Carrying the lens outward found the same shapes pointed at people
making bigger decisions, and one shape that had nothing to do with numbers.

**Fabricated numbers handed to a model told not to hedge.** Five agents read a
company's `metric_snapshots` into a prompt through
`(Number(x) || 0) * 100`, so a company that had reported nothing produced
`Churn rate: 0.0%. NPS: 0.0.` — a claim of excellent retention. Harbor's system
prompt then says, in these words, *"You do not hedge when customer data is
clear"*, and asks for named accounts and dollar amounts. The output reaches a
founder as advice about their own company. It crossed thresholds too:
`if (activationRate < 30)` fired a "Low activation rate (0.0%) — acquisition
quality concern" message at companies with no metrics at all.

Forge was the sharpest. `mrr_health_ratio` is defined by migration 001 as
churned/new, *"null if new is 0"* — the null is documented as meaning the
division could not be done — and the prompt explains the scale as
`>1.0 = churn exceeds new MRR — critical`. So `|| 0` mapped "no new MRR at all"
to the single most favourable value available.

The rule already existed: `jobs/index.ts` writes `!= null ? … : 'unknown'` for
the same columns from the same table. `ai/measured.ts` states it once, and a
zero reaching a prompt through it means a snapshot really recorded zero.

**The same defect inverted, condemning instead of flattering.**
`computeFundingReadiness` has a neutral 50 branch for every null input, and it
never ran: the row is read as `rows[0] ?? {}`, so a company with no snapshot
produced `undefined`, the `=== null` check missed, and every comparison fell
through to the final `: 10` / `: 20`. Then the gap list tested those against
thresholds of 60, and told a company that had reported NOTHING — in a document
it would fundraise on — that its churn was above threshold, its activation below
benchmarks, its MRR health indicating churn exceeds new revenue, and its
technical audit below threshold. Four findings about numbers that did not exist.

Which direction a fabricated unknown lands is an accident of where somebody put
a threshold. That is the transferable point: it is not that fallbacks flatter,
it is that they *decide*, and nobody chose.

**Statistics applied to an invented input.** `/scenarios` renders a Monte Carlo
runway — median, P10–P90 band, probability of surviving eighteen months — and
cash on hand was defined as `monthlyBurnCents * 12`, where burn was
`products.operating_budget_monthly_usd`: the AI SPEND CAP, defaulting to fifty
dollars a month. A founder who never touched it was modelled as a business
burning $50 against $600 of cash, with the identity making base runway exactly
twelve months. A second implementation in `financial/simulator.ts` invented cash
as `revenue * 6`, so a company got two different runways depending which page it
opened.

This is worse than the bare `runway_months: 999` on the operator page, and the
reason is worth carrying: **nobody mistakes a constant for a finding, and
everybody reads a confidence interval as one.** Statistical machinery over a
guess does not report uncertainty — it disguises the guess as measurement.

Migration 181 lets the founder state cash, burn and the date they were true;
`financial/position.ts` is the only way either path may learn it and has no
default anywhere; both return null until a position exists, and the page asks
in the founder's own terms. **Do not add a default here.** A default cash
balance is a claim about a bank account, and no amount of modelling downstream
makes it less of one.

**And a statement that had never once run.** `forecast_scenarios` was written
with seven placeholders and six arguments. `generated_by` is NOT NULL, so every
insert raised — since it was written. Both callers swallow it: the refresh job
catches per product, the route logs and redirects. So the page never showed a
scenario that function produced, the nightly log read "Generated scenarios for
0 products", and nobody found out. Every gate here passed it: the SQL is valid,
the columns exist, the types check. It surfaced only when a test called the
function for the first time.

`check-query-arity.mjs` now counts placeholders against arguments (1,886
statements) and INSERT columns against values (377), chained into
`lint:columns`. Writing it taught the same lesson twice: the first counter
toggled string state on every apostrophe, so a SQL comment reading "Migration
178's trigger" opened a string that never closed — five false positives against
correct code. The same bug in the argument splitter, on a TypeScript comment
containing `'system'`, inflated a count by one. Both are tests now. **A noisy
gate gets baselined, and a baseline is where a gate goes to stop working.**

**And the mirror image, which is where the reading went next.** Every finding
above is a claim made without a source. Turning the lens around — a fact
RECORDED and read by nobody — found four more, and the last of them was the
most valuable of the whole cycle.

**Foundry's own AI spend, from two ledgers, both wrong.** The founder-ops badge
read `cost_events`, under a comment written earlier in this same campaign
calling it "the canonical spend ledger: real amounts, every cost type". It is
not: `cost_events` has one writer, `scp/agents/base.ts`, fire-and-forget, agent
sessions only. `ai/client.ts` reserves and settles EVERY call into
`ai_daily_spend`, which is also the ledger the daily ceiling is enforced
against — the one that decides whether Foundry may act. Meanwhile the Letter
read that ledger and summed it across all scopes, and migration 099's finish
trigger writes the same amount to the global, product and founder rows, so "AI
spend today is X USD" counted every call up to three times.

Correcting my own comment is the part to carry: **a wrong claim about which
store is canonical outlives the number it justified**, and the next person to
touch it would have believed it.

**Quiet is not broken.** `integration_health.last_successful_sync` was written
on every successful event and selected by nothing. The page showed
`last_event_at` — when data last ARRIVED — so for a webhook source a quiet
fortnight and a dead connection produced the identical line, "No data in 14
days". `institution/loop-health.ts` already says exactly this about the
scheduler: *"Nothing happened" and "nothing ran" are different facts.* One rule,
stated in one place and not the other, over a column that had held the answer.

**A forecast nobody ever scored, with three broken links in one loop.** The
checkpoint was dated TODAY holding today's prediction, so the only actual it
could match was one recorded the same day — the prediction compared against
itself. `recordCheckpointActual` had no caller anywhere. And `variance_pct` was
read by nothing. On top of which the insert creating the rows had never run at
all. Predictions are now dated when they come due (1, 3, 6 months, base case
only — scoring a bear case scores a question rather than an answer), reconciled
in the ingest path where a company's real MRR arrives, and the founder is told
the median variance AND ITS DIRECTION above the forecasts it judges.

This one is worth the work rather than a curiosity for a specific reason:
**Foundry asks companies to state what they expect and compares it against
reality, and its own forecasts were exempt from that.**

**Then the same reading found the two things underneath every number on those
surfaces: what the words mean, and what the units are.**

**MRR the level and MRR the movement, under one name.** The founder's own
ingest endpoint mapped the field `mrr` to the column `new_mrr_cents`. A company
POSTing `{"mrr": 50000}` — meaning "our MRR is fifty thousand dollars", which is
what the word means — had that recorded as NEW BUSINESS WON THIS PERIOD,
alongside its real expansion, contraction and churn. `mrr_health_ratio` is
computed at ingest as churned/new, so a level in the denominator made the
company look healthy; the operator's portfolio figure was adding a level to a
sum of movements; Forge and Oracle put `new=$50,000.00` into their prompts.

Meanwhile `metric_snapshots.mrr_cents` — the column that MEANS the level, and
the one every investor-facing surface reads — had no writer on that door at all,
so those companies read "N/A" for MRR everywhere. `POST /api/v1/metrics`, the
public API, has always written the level correctly. **The same company got a
different answer depending which door it used.**

**A fraction compared against a percentage.** `activation_rate`, `churn_rate`,
`day_30_retention` and `mrr_health_ratio` are stored as 0–1 fractions — the
ingest validates that range and `ux/fluency.ts` says so in words. Five readers
treated them as percentage points, and the failure mode is the thing to
remember: **every "higher is better" test fails (`0.68 >= 40`) and every "lower
is better" test passes (`0.02 <= 3`)**. A company scored zero for excellent
retention and full marks for catastrophic churn, and nothing looked broken from
either side.

In `fundraising-readiness.ts` six of the ten points in `scoreTraction` were
unreachable by anybody. Two of those were unreachable twice over:
`mrr_growth_pct` and `customer_count` are NOT COLUMNS on `metric_snapshots`,
read off a `SELECT *` row and `undefined` forever, and `d30_retention` is not
one either — the real column is `day_30_retention`, sitting there with the data
in it. In `network/failure-library.ts`, `{ churn_rate_gt: 8 }` means eight per
cent, so no failure pattern keyed on churn could match for any company; the
library kept matching on its other criteria and simply never fired on that one.
And both briefings and the investor update told a company churning 2% a month
that its churn was 0.0%.

`ratePoints()` states the conversion once. It converts the VALUE, not the
threshold: `>= 40` reads as forty per cent to a person and `>= 0.4` reads as a
bug waiting to be "fixed". `nps_score` is left alone — already on its own
-100..100 scale, and scaling it would be this same mistake reversed.

**A product telling its customer it delivered nothing.** `/roi` is mounted and
authenticated and headlined "Value Delivered This Month". It reported **$0** and
a 0% action rate for every company, always, because `recommendation_outcomes`
has no writer — `recordRecommendation` and `markActedOn` are exported from
`roi/outcome-tracker.ts` and called from nowhere. The line underneath read
"Foundry is tracking recommendations — value will appear as outcomes are
measured", and nothing was tracking anything.

**It is deliberately still not wired, and that is the interesting part.** The
obvious move is to call `recordRecommendation` from every agent run. It would be
worse than doing nothing: recommendations would accumulate while `markActedOn`
still had no caller, turning an UNMEASURED action rate into a MEASURED 0%. **A
loop that records its denominator and never its numerator produces a confident
wrong answer, which is harder to notice than an honest blank.** Wiring the other
half needs a real answer to "what counts as acting on a recommendation"; a test
now fails if a caller appears for one without the other.

**And the sharpest instance of all of it: a rule Foundry had already written
down, and obeyed once.** `SignalResult.hasData` is declared in
`services/signal.ts` with the Honesty Law and this sentence: *"the score is a
default, not a measurement. First-run surfaces must say 'not enough data yet'
rather than present a falsely-confident number."*

Ten places compute a Signal. **One honoured it.** The other nine printed the
default, so a company Foundry had never measured appeared as a confident 85 out
of 100: on a public share link under a badge reading "LIVE SIGNAL"; spoken aloud
in the voice briefing, where there is no colour and no second glance; twice into
a model, which reasons from it and repeats it back; in Fleet Triage, where it
sorted among real companies and pulled the fleet average on a page whose whole
purpose is choosing what to look at first; over the mobile API; and as the
baseline for a drop alert.

That last one had teeth. The default was written into `signal_history` like any
other score, so the first day a company actually reported something, the real
score landed against a default baseline and the founder was told their Signal
had fallen thirty points **from a number their company was never at**. The same
history feeds the share page's sparkline and the 7-day trend in conversation
context.

**A default no longer enters the record at all**, and not-writing beats writing
a flag: every reader of `signal_history` gets the guarantee for free instead of
having to remember it, and a gap means nothing was known that day, which is what
a gap should mean.

**The lesson is about instruments, not about Signal.** The rule did not need to
be discovered — it was already written, in the codebase's own words, in the type
itself. What was missing was ONE WAY TO OBEY IT and something that notices when
a caller does not. Writing a rule into a comment protects the file it is in.
`signalText`/`signalNumber` plus a test that enumerates every caller of
`computeSignal` protects the other nine. **When a doctrine sentence appears in a
type, check every consumer before believing it.**

**The same shape on a consent boundary, which is where it bites hardest.**
`preferences.max_channel` is declared as *"Interruption ceiling: the loudest
channel Foundry may ever use. The policy can only quiet below this, never exceed
it"*, and `ux/interruption.ts` opens with *"this module alone decides HOW LOUDLY
to deliver"*. `intelligence/risk-state.ts` called `notifyFounder` directly,
consulting none of it: a founder who set `letter` — do not interrupt my life —
got a push on every risk-state change.

Its comment said the send was "governed like every other outward effect", and
that was TRUE AND BESIDE THE POINT. **The gateway governs whether an effect may
LEAVE; the ceiling governs how loudly Foundry may interrupt THIS PERSON.**
Passing the first says nothing about the second — and the comment treating them
as one thing is how a control that WAS working became the reason nobody looked
for the one that wasn't. Worth watching for generally: a satisfied guard cited
in place of an absent one.

**And then the same lens on sentences I had written myself.** Two commits after
wiring the forecast reconciliation into the ingest route, under a comment of
mine reading *"This is the only path by which a company's real MRR reaches
Foundry"*, it turned out not to be: `POST /api/v1/metrics` — the documented
public API with issued scoped credentials, the path this very file calls the one
a real company integrates against — also writes `mrr_cents`. So a company
integrating the DOCUMENTED way had forecasts recorded and never scored. Same
shape as the customer-store split, introduced while closing that very loop.

**And on the interruption module's own justification**, after using it to find
the module's bypass. Its quiet rungs write nothing, excused by *"the Letter
composes from the ledgers, so the event will appear there"*. The Letter composes
from a SPECIFIC LIST — completed executions, gate-0 decisions, the top pending
decision, falsified premises, the memory digest, peer-radar warnings, the trust
ledger, dissent. An event in that list survives being quieted; one outside it
(a Signal drop, a wellbeing pulse, drafts awaiting approval, a milestone, a
billing failure) would be **dropped silently by a founder setting a lower
ceiling than they realised they were setting**.

That is why the eleven direct notification calls were not converted wholesale,
and the rule now sits where somebody would read it before doing exactly that:
route through `deliver()` only when the Letter already carries the fact. The
peer-radar bell is converted as proof and as the unambiguous case —
`letter/composer.ts` calls `scanForWarnings` itself.

**The rule for the whole cycle, stated plainly:** a claim in a comment is
evidence of what somebody believed when they wrote it, and nothing else — and
that includes claims written five minutes ago by whoever is reading. Three of
this cycle's findings came from checking such sentences against their consumers;
one of them was mine.

**A gate that was measured and rejected.** The ghost-column class —
`mrr_growth_pct` read off a `SELECT *` — is invisible to every column gate here,
and looked like the next ratchet. Two attempts were measured: matching property
casts against the file's single starred table gave 48 findings, mostly
properties belonging to other queries in the same file; binding variables to
their query through `.rows[0]` gave 108, still leaky because generic names like
`r` and `row` are reused across queries. **Real scope analysis is the price of
this one**, and a gate that cries wolf gets baselined into uselessness. Not
built. The specific findings were verified by hand against the built schema
instead.

**The write-only list is a question-asker, not a work queue** — measured, not
asserted. Of the 84 entries, 47 are reachable by a mechanism that ratchet
cannot see: 22 through a literal `SELECT *`, 16 through a SQL trigger, 9
through the export's dynamic `SELECT * FROM ${table}`. `ai_spend_reservations`,
`gate_events` and `anomalies` each looked like findings and each turned out
reachable by a different one of those three. The gate's own header says it is a
false positive in the safe direction; believe it. **35 entries remain genuinely
unread**, and the two taken from them this cycle were both real.

**Checked and found correct — worth as much as the findings.**
`scp/investor/fundraising-readiness.ts` awards no points for unknowns and prints
`N/A`. `scp/investor/investor-update.ts` handles every null. Both briefing
surfaces already say "unknown" — though both used truthiness, so a company
recording exactly $0 of MRR, which is most pre-revenue companies, reported as
unmeasured. Read the code before writing the finding: this cycle's frontier
entry named five suspect files and two of them were already right.

**Method note that paid for itself twice.** Two findings were wrong on first
read and were caught by checking rather than by writing them down. The tier
price map `{solo: 79, growth: 199, investor_ready: 399}` looked like it could
never match migration 001's `('founding_cohort','growth','scale')` CHECK —
migration 080 had already fixed that, and the map is correct. And a wellbeing
test failed on the `DEFAULT 'stable'` column rather than on the code, which is
what surfaced the second-order trap above. Read the migration before writing the
finding.

---

## Twelve tables that nothing read

**Twelve tables that nothing read, followed one at a time, and eight of the
twelve led somewhere worse than the table.** The unread-tables gate is a
starting point, not a verdict: in every case the row itself was the least of it.

**The shape that repeated most: a shadow copy that was wrong, and could not be
found to be wrong because nothing read it.** `auto_execution_log` duplicated
`action_drafts`. `agent_positions` duplicated `debate_sessions.positions_json`,
and duplicated it badly — the challenger inserted a SECOND row carrying the
challenged assertion instead of marking the original, so the columns the schema
existed for were never once populated. A copy nobody reads cannot be caught
drifting; both were wrong for as long as they existed.

**A word that outranked the execution path.** A debate that THREW was stored
`status = 'complete'`, and the page paints 'complete' green beside a conflict
count that a crashed run leaves at zero — the same row a debate where everyone
agreed produces. The failure text existed; it was rendered as the executive
summary inside the card headed "Unified Synthesis".

**An estimate with no company in it.** Four investor-tier functions were given a
product's NAME and SECTOR, asked a model for numbers, and returned them as
analysis: a moat strength, an erosion rate, a switching-cost ratio. The numbers
stay — an estimate is a legitimate thing to offer — and now carry
`estimated_from`, the same shape and the same word as `Forecast.projected_from`.
**The not-found branches were the worst of it**: `risk_score: 0` (no risk),
`probability: 0` (the incumbent will certainly not respond), a switching-cost
ratio of exactly 1, portability and depth of 50. Reassurance and midpoints
invented about nothing.

**And the same absence scoring as opposite extremes.** One co-founder
respondent returned alignment 100/100/100/100; none returned 0/0/0/0. A
portfolio company with no lifecycle state was counted GREEN. A benchmark metric
the company had not reported was read as 0 — for churn the best possible value,
for NPS among the worst.

**The single sharpest finding was a direction, not a number.** Portfolio
benchmarking scored `product_percentile` as the share of peers with a LOWER
value and read a low percentile as poor performance. For churn that is exactly
backwards: the company with the least churn in the portfolio scored 0 and was
told to prioritise retention. Each metric declares its own direction now, in one
place, instead of the direction living implicitly in whoever reads the number.

**Two operational findings worth more than the tables that led to them.** A
failed integration sync set `status = 'error'` and the hourly job selected
`status = 'active'`, so ONE failure removed an integration from sync
permanently — no retry, no limit, no notice; the stop was a side effect of a
WHERE clause. And `graph_rebuild` paid Opus weekly for causal chains it used for
a log line, while the route that serves chains paid Opus again on every request.

**METHOD NOTE THAT NEARLY COST A COMMIT.** The first causal-chains test asserted
the SHAPE OF THE INSERT and the ORDER OF TWO CALLS in the route source. Both
mutations survived it. **A test that reads code rather than running it will
believe anything the code says about itself** — including the comments I had
just written explaining what the code now does. Rewritten to stub the model and
exercise the write path and the route for real, it caught three mutations.
Prefer behaviour; use source assertions only for absence (a name that must not
come back), and strip comments before asserting absence, because the explanation
of the old name contains the old name.

**A boundary I crossed, caught by a gate rather than by me.** The
stopped-integration notice was first announced through `emitSignalEvent` — the
single door into responsibility discovery, which has exactly one caller by
design: the company reporting something about itself.
`discovery-is-not-reachable-from-integrations.test.ts` failed on the first full
run. The test was right; the code was wrong. It goes through the interruption
ladder now.

**THE SHARPEST FINDING OF THE CYCLE CAME FROM A COLUMN NOBODY READ.**
`responsibility_shadow_expectations.observation_source_evidence_ref` was on the
write-only list. Entering Shadowing writes a transition whose reason is "A
current independent observation channel can test a bounded expectation" — the
entire justification for the state — and that rule was enforced three times,
each keyed on the SHAPE OF THE EXPECTATION: two triggers matching
`expected_event_type LIKE 'development_verified:%'` and `'external_metric:%'`
with the source hardcoded, plus each caller filtering its own query.
`beginResponsibilityShadowing` accepts any event type. **A rule enforced N times
by special case has no floor: the (N+1)th case has nothing at all.** FOUR places
in this repository — including the fixture fourteen test files reach Shadowing
through — created expectations that neither trigger would match. Migration 191
makes the caller name the channel and enforces it generically.

**AND THE OBVIOUS FORM OF THAT FIX WAS WRONG, which is the part to carry.** The
natural rule is "the observation must come from the same source as the signal in
`observation_source_evidence_ref`". That column does not mean one thing: in
external shadowing it holds a signal FROM the ingest channel, in development
shadowing a `repository` signal recording the NEED. The first version refused
every development comparison. **Before generalising a rule from a column, check
that the column means the same thing at every writer.**

**Fifty was in the schema, not only in the code.** Four agents wrote
`parsed.domain_health_score ?? 50` into a field their own type declares optional;
six layers read it; and underneath all of them
`agent_instances.domain_health_score INTEGER DEFAULT 50`, with the provisioner
writing the literal 50 for twelve agents of every company at creation.
`products.health_score INTEGER DEFAULT 0` started every company at the worst
health there is. **When one substitution appears in several files at once, read
the schema before fixing any of them** — the application code was keeping faith
with a column that already lied.

**And the same silence scored twice, differently, in one file.** The Value
Delivery Index substituted 0 for four components and 100 for the fifth, so a
company reporting nothing scored 15/100; eighty lines away the same missing
breadth was read as 100 and could never raise a stressor. `if (!m) return 0` gave
a company with no snapshot a flat zero on "how effectively the product delivers
value", and `assessTimeToFirstValue` read a missing measurement as 0 hours,
which falls in its first branch: "Excellent — users get value within minutes."

**AND THE SAME LENS, ONE LAYER UP, FOUND THE MOST SERIOUS DEFECT OF THE
CYCLE.** `middleware/tenant.ts` was on the unreachable-modules baseline: the
module that states tenant ownership ONCE, including the deliberate 404-rather-
than-403, mounted nowhere. Eight idioms are in use instead. A rule with eight
implementations has no floor, and `GET /packet/:id` was the route with nothing —
**any authenticated founder could read any company's board packet**, the most
sensitive document Foundry produces, while three of its neighbours in the same
file scoped correctly and one carried a comment saying why. On the same surface
sweep, two operator routes resolved a company's decisions and recorded
`decided_by = 'founder'` about somebody else.

**`check-tenant-scope.mjs` is the floor**, baseline 2, both entries earned. The
body-and-query door was checked in the same pass and holds — recorded because a
sweep that reports only what it broke tells the next reader nothing about where
not to look.

**A THIRD KIND OF SELF-INFLICTED SCANNER CONFUSION, and the pattern is now
clear enough to name: PROSE THAT QUOTES CODE IS READ AS CODE.** Earlier this
campaign my own scanners read SQL comments and TS comments as statements. This
time it was the repository's scanner reading MY comment: a note explaining the
statement it had just removed, quoted verbatim, was extracted by
`sql-prepares-against-schema` and failed to prepare. Describe the statement, or
expect the tools to believe you.

**A flake that read as a security regression.** `encryption.test.ts` overwrote
the first two hex characters of a ciphertext with the constant `'ff'`. One
ciphertext in 256 already starts with `ff`, so one run in 256 tampered with
nothing, decrypted cleanly, and failed. Both tamper tests flip a bit now and
assert the tampering landed. Same discipline as mutation testing, applied to a
test that was itself the mutant.

## The rest of the 32-agent sweep

**The rest of the 32-agent sweep, read in full and worked to the end.** The
previous cycle acted on the findings it had read; this one read the remaining
report and closed every one. Twelve batches, each mutation-tested, each with the
defect replanted to prove the test would have caught it.

**THE SHAPES, in the order they cost the most:**

**A credential that authenticated nothing, handed to a customer.** RT02-10 asked
for the `pfk_` portfolio key to be hashed like the main API keys. Reading the
code for that fix found what the ticket had not: `authenticatePortfolioKey` HAD
NO CALLER — imported by the routes file and never invoked. So the key was
minted, stored in the clear, returned to the portfolio owner, and opened
nothing. Hashing it would have shrunk the blast radius of a leak and left the
worse half standing: AN API KEY HANDED TO A CUSTOMER SAYS A DOOR EXISTS. The
mint is gone, the reader is gone, and migration 200 nulls what was already
written — the half a code change cannot do.

**Two identifiers, one checked, and the unchecked one deciding everything.**
`POST /api/products/:id/integrations/:integrationId/sync` verified ownership of
`:id` and passed `:integrationId` to `runSync`, which resolved the integration
by id alone. Any founder could name another company's integration and make
Foundry call a provider with that company's credentials, write into that
company's metrics, and read the record count and error text out of the response.
The ownership rule lived in the route and the row it governed was fetched two
files away. A RULE THAT DECIDES AUTHORITY MUST HAVE EXACTLY ONE HOME: the scope
now travels with the call, and there is no default.

**A judge that could not answer, recorded as a pass.** The voice gate met an
unreachable judge with `score: threshold, in_voice: true` and four fabricated
dimension matches — so an outage SHIPPED the customer-facing artifact the judge
exists to hold back, while the neighbouring failure (an unparseable answer)
fabricated 50 and blocked. Two failures of one kind treated oppositely, and the
permissive one is the one that reaches a customer. Now: null score, null
breakdown, a distinct `unscored` verdict, and auto-execution withdrawn because
the permission was conditioned on a check that did not happen.

**An approval stamped an hour before it could have happened.** `proposeAction`
wrote `approved_by = 'auto'` and `approved_at` ONE HOUR IN THE FUTURE the moment
a level-1 action was proposed, left the status pending, and returned — with no
scheduler, no notice, and a dashboard badge promising a "1-hour window". Removed;
migration 201 refuses any `approved_at` more than five minutes ahead of the
clock; and whether Foundry may send because nobody answered is now
`OWNER_DECISIONS_PENDING` §14 rather than a timestamp written in advance.

**A budget that metered the wrong person and never gave anything back.** The cap
of three a week exists so agents cannot nag a company's CUSTOMER; every
founder-bound send passes the founder's own address, so the daily briefing, the
digest, the welcome sequence and the billing notice drew on one budget of three
— and the first thing refused after Wednesday was whatever came next, including
"your card was declined". The count is also taken BEFORE the send and was never
released, so three provider outages made a customer uncontactable that week
having received nothing. Two department sweeps spent it on drafts, keyed on the
CRM id while the gateway keyed on the address — two counts of messages to one
person, neither of them the number they received.

**Every component of one assessment failed towards a claim.**
`assessMigrationReadiness`: revenue read from two MOVEMENT columns instead of the
level, churn compared a 0–1 fraction against 5 (i.e. "under 500%"), NPS was
`nps_score ?? (0 >= 50)` because `>=` binds tighter than `??` — so an NPS of -40
read as "High NPS confirms value delivery" — and users were `?? 0`. Four
defects, four different mechanisms, one direction.

**A documented endpoint that had never once succeeded.** `GET /v1/customers`
selected three columns the table does not have, threw on every request, and
returned a fixed sentence from a catch that discarded the error. The POST
handler seventy lines below names the correct mapping in a comment: the write
was fixed and the read was left. Its sibling `/v1/metrics/health` computed
`is_stale` from row EXISTENCE while a daily job inserts an empty placeholder for
every company, so nothing was ever stale; and `/v1/agents/:name/briefings` had no
agent predicate at all, answering for names that are not agents.

**A cohort that did not exist, ranked against invented bands.** The percentile
lookup keyed `lifecycle_state` as 'prompt_1'..'prompt_4' while the only writer
stores 'pre_revenue'|'early'|'growth'|'scale'. The two vocabularies never
intersected, the lookup missed for every company on every call, and the fallback
— bands in percentage points, ranked against 0–1 fractions — was therefore the
path EVERY founder took. It also walked around the owner's five-contributor
floor, because an invented distribution has no contributors.

**A runway that was algebraically the constant 8.** `min(24, (mrr*2)/(mrr/4))`:
the burn it divides by is the MRR it divides. One failure pattern asks for
runway under 6 months and could never match; another asks for under 9 and always
did.

**Numbers that could not move.** Foundry's own growth rate compared today's
payers against today's payers-who-signed-up-earlier — a strict subset, so it
could not be negative, and the twelve-month forecast compounded it. Compliance
debt was always 0 because nothing writes the requirements it scores, and 0 there
is the claim "nothing required is unmet". The activation stressor measured a
fraction against a threshold in points and could never fire. The dashboard's
rejection-streak card called a lifetime counter "this week".

**A control the product calls the person's own, which the person could not
exercise.** `preferences.max_channel` — the interruption ceiling three modules
describe as the thing that "always wins" — had no writer anywhere, so every
founder sat permanently at push. It has a setter and a setting now.

**A gate that skipped the shape the defect was in.** `check-select-columns`
skipped every aliased query along with the JOINs, and the broken endpoint above
was `FROM customer_intelligence ci`. One table is one table, alias or not; it
reads them now, and replanting the original defect fails the build.

**And the red-team ledger, worked to the end of what is engineering.** Four
more tickets closed, and in three of them the ticket was not the worst of it:

- **RT02-14 asked for nonces.** The enforced `script-src` named neither origin
  the product's own pages load Clerk from — `cdn.jsdelivr.net` on sign-up,
  sign-in and sign-out, `unpkg.com` on the landing page — so an enforcing
  browser blocks authentication entirely. And a SECOND policy sat in
  `middleware/security.ts` that nothing imported, allowing unpkg but not
  jsdelivr and carrying two directives the live one lacked: two answers to one
  question, and the dead one looked stricter. A test now reads the origins the
  pages actually load from and requires the policy to name each.
- **RT02-15 asked for opt-out filtering on reads.** The consent that gates the
  WRITE cannot be granted at all — `cross_company_patterns` is in the union and
  not in migration 041's CHECK — so nothing has written the table since. What
  the readers could still serve was pre-gate and seed rows, and the one reader
  that counted ROWS rather than companies had no production caller and one test
  asserting the defect as its expected behaviour. Deleted.
- **RT02-16 asked for LIKE escaping** on one query; the same shape was in three
  more, and on the `resolve_stressor` path it reached a WRITE — a `%` matched
  the company's first active stressor and marked it resolved.
- **RT02-13** was the error rendering on the auth pages, and is now nodes and
  `textContent`.

- **RT02-07 and RT02-08** wanted prompt-injection defence and said no
  sanitisation layer existed. It had existed since Wave 1 and was used at three
  boundaries; the transcript and competitor paths had never been wired to it.
  They are wrapped in named data blocks now, with the instruction in the SYSTEM
  prompt — and the words inside are NOT rewritten, because the denylist that is
  right for a stranger's support message mangles a founder's own dictation.

**One ticket is left, and it is not a fix:** the RT02-09 binding half needs a
Stripe Connect account id on the product row — a schema and connect-flow change.

**And the lesson the ledger itself teaches:** in three of these the ticket was
not the worst of it, and implementing the remediation as proposed would have
made a false claim more robust. Read the code the ticket points at.

**And the writer four repairs had been working around.** A job inserted an
EMPTY `metric_snapshots` row for every active company every day, so that "daily
snapshots exist". The decomposition that returned a confident zero, the
staleness flag computed from a row's existence, the readiness assessment that
found no revenue, the mobile dashboard reporting a month in which nothing moved
— four fixes in this campaign, each correct, each a workaround for this one
writer. Two ingest paths depended on the row and reported success when their
bare UPDATE matched nothing; they upsert now, and the job is deleted. WHEN TWO
READERS NEED THE SAME WORKAROUND, THE DEFECT IS UPSTREAM OF BOTH.

**And the gate that could not see four columns until an unrelated writer was
deleted.** Removing the daily placeholder made the write-only-column gate report
four `customer_health_snapshots` columns it had never mentioned. They had always
been write-only: the gate blanked write contexts by REMOVING their text, and
`INSERT INTO metric_snapshots (id, product_id, snapshot_date)` is a leading
substring of that table's column list, so blanking the short one left the long
one unable to match itself. **When a gate's verdict changes after a change that
could not have affected it, the gate is the finding.** It records ranges now
instead of removing text. The four columns got a reader in the same batch: the
falling-customers table names WHICH of usage, support, payment or engagement
dropped, which is the only part of that answer that says what to do.

**Two tables removed, and the trap that made one of them possible.**
`leading_indicators` held the columns that would have made the failure-pattern
library evidential — `confidence`, `sample_size`, `lead_time_days` — and nothing
ever wrote one, because Foundry has never had a way to establish those numbers.
The library itself was stating four frequencies as though something had counted
them ("typically see churn double within 60 days"), on a card headed by the
founder's own match score; the directions are kept, the numbers are gone, and
the card now says which half is editorial. `outbound_webhooks` was a third table
for a concept the product implements twice — and reading it surfaced that TEN
`CREATE TABLE IF NOT EXISTS` statements across seven migrations never ran.
Three of them have cost this campaign real time. Each now says so in the file.

**A capped page with no order, six times, and one of them was Foundry grading
itself.** `scenario.ts` writes one forecast PER OPTION — a decision with three
options has three, one of which may be the ghost — and the accuracy scorer took
`LIMIT 1` with no ORDER BY, so an outcome that followed the founder raising
prices could be scored against the prediction for leaving them alone, then
recorded that option as the one chosen and stamped the untaken forecast with the
result. `decisions.chosen_option` holds the answer and the calling job already
selected it, one call short of the code that needed it. The other five: what
needs you next, the red team's five risks, the briefing's three stressors, an
agent's five OKRs, the verifier's hundred. **A biased sample nobody knows is a
sample is worse than a short list.**
