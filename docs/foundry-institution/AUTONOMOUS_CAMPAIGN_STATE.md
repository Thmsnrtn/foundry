# Live frontier

**Operational state, not a specification and not a diary.** Git history is the
diary; `history/SEAM_CAMPAIGN_HISTORY.md` is the narrative record. This file is
what a steward needs to start working today, and it is trimmed as it ages. If
it grows into a backlog, it has stopped doing its job.

How development operates is `DEVELOPMENT_INSTITUTION.md`. What is currently
true is `IMPLEMENTATION_STATE.md`.

---

## NEXT SESSION START HERE

Bootstrap from disk: verify the branch and a clean tree, read
`DEVELOPMENT_INSTITUTION.md` and this file, skim `IMPLEMENTATION_STATE.md` and
recent git history, then work. No chat history is required.

Then run the loop in `DEVELOPMENT_INSTITUTION.md` §2: orient, verify, locate
the frontier from **current repository truth**, and act. Do not resume an
inherited list because it was inherited.

---

## Verified checkpoint

- **Branch:** `claude/foundry-autonomous-continuation-0gents`. Never merged to master.
- **Head:** `8ea8397`, pushed.
  **Migrations:** 213 files, highest **177**. Ordering gated. Snapshot current.
- **Validation:** full suite green — **294 files / 2,491 tests**, `npm run check`
  EXIT=0, every gate chained and running in CI on this branch.
  **Qualified:** the suite aborts natively about one run in three *before*
  `closeDb` landed; over 30 consecutive clean runs since. See item 3.
  **Read the exit code from the run that produced the log** — a commit went out
  with five red tests this cycle because it was read from a wrapper.
- **Ratchets:** unguarded mutating routes **114** · fabricated test schemas **4**
  · writer-less tables **0** · SELECT drift **0** · untraced consequential
  effects **0** · statically unreachable modules **28** · write-only columns
  **85** · id tiebreaks **18** · backticks in embedded comments **0**.

## Active work

None in flight. Everything below is unstarted or blocked.

## What the last cycle established

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

**This cycle: the owner's direction on ethics, legitimacy and the private
frontier landed, and it was implemented rather than filed.** The doctrine went
into the existing canonical artifacts — no new ethics universe — and then the
repository was read for the places where the doctrine had outrun the code.
`ARCHITECTURE.md` names seven terms of the legitimate action envelope; five
were already structural, and `IMPLEMENTATION_STATE.md` now reports each of them
against real code. The two that were absent were the work.

The **affected-party term** existed as a sentence in migration 094 — "never
contacted again, by any mode, at any trust level" — with no way in and one
reader. `addSuppression` had no caller anywhere in `src/`, so the list was
always empty, and the governed email path never consulted it. It is now checked
at the boundary every outward effect converges through, recorded by the founder
and readable by them, and gated on `can_manage_company` because an append-only
list is a brake somebody could pull on the company's best customer. The
**external-permission term** is deliberately still absent: three counsel-debt
items are queued instead of a legal-knowledge store built on a model's
recollection.

Reading for **"what does this claim that its execution path cannot support"**
then found three fabrications in a row. An agent's parsed LLM output was fed to
`upsertCustomer`, whose insert branch CREATED a customer — name, email, plan,
MRR, stage `trial` — indistinguishable in the same table from one a real
billing system reported through the scoped API, and read as ground truth by the
priority ranker, the strategy synthesis and the accuracy tracker. The creating
function is deleted; a model may now judge a customer it cannot invent, and a
refused signal lands where the founder reads it. `network/benchmarks.ts` said
"No product or founder ID stored" in two places while its primary key is
`${productId}_week_${metric}`. And the question *how few companies may stand
behind a number shown to another company* was asked in four places and answered
three ways — 3, 5, 5, and a bare literal 3 — with two of them sharing the name
`MIN_CONTRIBUTORS` while disagreeing. The weakest answer governed the two paths
that publish to a company's competitors. One constant now, at the strictest of
what was there.

The same lens found the largest one. `ARCHITECTURE.md` says consequential
mutations enter ONE governed execution boundary; there were two.
`action_executions` had its own switch, whose `send_email` arm returned
`success: true` with the note *"Email draft stored. Email provider integration
pending."* Nothing was sent — and the live send path had existed the whole time,
one directory away, with the sender-of-record rule, the kill switch, the
entitlement pause, classification, idempotency and effect certainty. The
execution was marked `completed`, the customer-success department counted it as
`sent`, and the attribution entry read *"Foundry sent a check-in on the
founder's behalf under consent <id>"*. The note described a gap that had been
closed elsewhere and never re-read. The second regime now enters the first, a
refusal is no longer counted as a send, and the affected-party refusal built at
the top of this cycle binds both paths because there is now only one path.

Two smaller ones from the same reading. The privacy page's **Aggregate
Insights** governed nothing — contribution was consented while RECEIVING was
gated by nothing at all — and it promised "statistical patterns across hundreds
of products", a scale nobody counted, over what is an eligibility floor of five
companies rather than a statistic. It governs the reading now. And **Help
Improve Foundry** described a choice the code does not offer: Foundry's own
funnel analytics record a NAMED founder's progression regardless. The copy now
says what happens, and the position is queued as owner decision §14. Every
consent type is now either consulted or listed in `RECORDED_PREFERENCE_ONLY`
with a reason, held by a test — four separate toggles governing nothing was
four separate findings that should have been one rule.

Pulling the same thread twice more. `schedule_call` and `update_crm` had the
identical shape as the old email arm — `success: true` with a note saying the
integration was pending — and a founder could build a template of either type
on a live page, approve one, and read "Call" or "CRM" as done. There is no
Calendly and no CRM to route into, so both refuse, and the template picker no
longer offers a type the executor will refuse. And the privacy page's two
retention dropdowns wrote a settings row that the retention sweep never read:
they are honoured now where they ask Foundry to keep **less**, which is the
direction that needs no counsel, with the boundaries (the financial log, the
erasure trail) stated in §9 rather than drawn silently.

And the largest of the tail: **the erasure knew about fifty-five tables the
export could not see.** `exportProductData` swept the tables carrying
`product_id` and nothing else — its own header argues that the denominator is
the point, since an earlier version exported ten tables against a guessed one.
Four hundred lines further down, the same file establishes at length that
fifty-five tables carry no `product_id` and that three quarters of them ARE
company data: eleven children hanging off erased parents, and the ones naming
their subject as a contributor hash, a scope id, or the first component of a
composite key. A founder asking for their own data got the conversation and not
what they said in it. "This is yours and goes when you go" and "this is not
yours to receive" are the same claim read two ways; there is one derivation
now, `companyDataSources()`, and two consumers.

The same asymmetry one level down, and it was worse. `FOUNDER_SCOPED` names
twelve tables that are the PERSON'S rather than any company's — their voice,
their health circumstances, their devices, their peer profile, their referral
history — and `PERSON_ACROSS_COMPANIES` names their own activity inside
companies they do not own. Both maps existed **only so an erasure could clear
them**. Nothing read either to answer "what do you have about me?", and the
erasure fires from the identity provider's `user.deleted` webhook, so there was
no Foundry surface where a person asks to be erased and therefore no moment at
which they could be offered their data first. `exportFounderData` is derived
from the same two maps, and the privacy page offers it before it is needed
rather than after it is too late.

**One vocabulary for who allowed it**, closing the last piece of the two-ledger
finding. `approved_by` is the field that makes an authorisation attributable and
it held four spellings of one idea — `founder:<id>`, `institution:assisting`,
`auto`, `voice:<id>`, `system:playbook`, `autopilot:<category>`, and from the
dashboard approval a BARE founder id. Nothing misread a founder as an autopilot,
because both readers that interpret the field happen to key on the `autopilot:`
prefix; that is a property of which two readers exist, not of the data. Both
approval doors now refuse a value that names no kind, and refuse it CLOSED — an
authorisation nobody can be held to is not one. Test fixtures were passing the
bare word `'founder'`, a role label with nobody behind it, which is the literal
`'ceo'` defect surviving where nobody was looking.

And the one reader that turns the field into English lived on ONE ledger's page
and knew only three of the six kinds. The other ledger's page never rendered
`approved_by` at all: it showed the agent that PROPOSED an action and never who
ALLOWED it, which is the distinction the constitution turns on. It says
"proposed by" and "Authorised by" now, from one reader.

**A company that integrated properly was invisible to the departments that act
on customers.** Two customer stores, split along the line between where a real
company's data enters — the documented `POST /api/v1/customers`, with issued
scoped credentials — and where the institution looks. The success and outreach
departments are real: governed, platform-capped, consent-gated, budgeted,
verified, tested. They were structurally starved for exactly the companies that
integrated the documented way, and nothing was broken; the two halves had
simply never been introduced.

Three things fell out of one accessor. The outcome verifier looked a reported
customer up in the wrong table and **abstained** — a vacuous pass, proven under
mutation: health fell from 80 to 10 and the criterion recorded `passed`.
`draftCheckIn` took `Record<string, unknown>` and read `last_active_at`, the
legacy column name, so a reported customer would have silently lost the
personalised sentence rather than failing — a loose type is how a store
migration goes quiet. And two "at risk" definitions turned out to be one:
`churn_risk > 0.6` and `health_score < 40` are the same line, because
`computeCustomerHealth` defines churn risk as `(100 - health)/100`.

**A test fixture that proved the rails while bypassing the criterion.** The
outreach champion fixture set `health_score` to `0.95` on a 0–100 column and
hand-set `is_champion = 1`. The production job marks a champion at
`health_score > 80` and would never have marked either row. Every rail below it
was exercised; the thing that decides WHO gets written to was not.

**A failed reading looked exactly like a calm one.** `analyzeTranscript` ended
in `console.error`, and all three of its live callers — the Fathom webhook, the
Fireflies webhook, the manual upload page — wrap it in `.catch(() => {})`.
Swallowed twice. The consequence was not a missing log: `processed_at IS NULL`
meant BOTH "not analysed yet" AND "analysed and failed", so a founder opened a
call, saw no summary and no insights, and there was no state in which Foundry
said it had tried. Migration 178 records the attempt with a closed reason
vocabulary — the shape, never the content, because a raw error can quote the
transcript and a transcript is a customer speaking — and two triggers keep the
row coherent: never both analysed and failed, never a failure without a reason.

**Two things checked rather than assumed, and both corrected me.** This list had
recorded that transcripts "reach one dashboard page and nothing else" and
proposed wiring extracted commitments into responsibility discovery. The page is
mounted and does render them; and migration 126 settles the rest — *"nothing
inferred from free-form chat: the founder states the kind explicitly, and
ambiguity stays conversation."* Building what the note proposed would have
violated it. Separately, I suspected the analysis spent money silently:
`callSonnet` is passed the product id and routes through the reserving AI
client, so the spend is accounted, and the prompt already carries a proper
untrusted-data boundary. What is true is narrower — a call that succeeded and
then failed to PARSE was paid for and left nothing behind.

**And the failure classifier matched a prefix I had guessed at.** It tested for
`SyntaxError` and `^AI response schema validation failed`, so an unparseable
model response was recorded as `model_unavailable` — `parseJSONResponse` wraps
the SyntaxError, making the name `Error` and the prefix `Failed to parse AI JSON
response`. The test caught it. Classifying on message text is fragile; the
mitigation is that the fallback is the least specific claim, never a confident
wrong one.

**One rule, two implementations, one enforced — on the operator boundary this
time.** `protective-wrapper` states it ("the operator brain sees aggregates
only") and holds `letter/operator-pack.ts` to it structurally. The OTHER
operator surface, `founder/intelligence.ts`, selected the ten most at-risk
CUSTOMERS across every company on the platform by name with no product scope,
plus each company's audit `reasoning`. Both surfaces gate on `isFounder`, so
operator-only rather than a leak between founders, and nothing rendered the
names — they reached a clientless API response and stopped. Fixed at the source
anyway. The principle it settles: **the operator administers the COMPANIES and
bills them, so a company may be named; a company's customers belong to that
company.**

And the assertion I wrote to enforce it flagged `p.name` — the company's own
name, the thing the rule permits. It now reads the projection and requires every
column to be an aggregate or to come from the joined `products` table, which
states the distinction instead of pattern-matching a word that appears on both
sides of it.

**A process failure worth keeping.** The commit before this cycle's work was
pushed with five tests red: capping `customer_success` at 'suggest' was correct
and the tests asserting the old behaviour were not updated with it. Validation
was run and its exit code was read from the wrong stream. Read the exit code,
and read it from the run that produced the log.


**The cycle before this one, compressed** — the detail is in git history and in
`history/SEAM_CAMPAIGN_HISTORY.md`. Its method was asking what a written record
was FOR and then looking for its reader: `outcome_evidence_ref`,
`reply_proposal_id`, `provider_receipt_json` and `reconcile_after` were all
written faithfully and consumed by nothing. "Who finds out when this fails"
found the same silence around Foundry's own dependencies — a dead integration,
a support channel dropping customers, and the scheduled loops themselves could
all fail while the page read like a calm day. "Who certifies their own
authority" found two doors on the outbound boundary (`queueEmail` deleted,
`proposeAction` closed by migration 173) and an attribution field recording the
literal `'ceo'` for every founder of every company.

The instruments were the largest finding: ten gates shared a block-comment regex
that reads `app.use('/dashboard/*', mw)` as a comment opening and blanked 715
lines of code, including half of `src/index.ts`. It surfaced only because
hardening one unrelated gate made its baseline move. Two shapes recurred often
enough to become gates rather than lessons — a backtick inside an embedded SQL
or HTML comment, and an ORDER BY falling back to a nanoid id.

## Highest-value current opportunities

Provisional, recomputed each cycle. Not a backlog — if something better is
found, this list loses. **Closed items are not kept here**; the git history is
the record and `history/SEAM_CAMPAIGN_HISTORY.md` is the narrative.

1. **~1,600 LOC of clientless API** (`founder-intelligence`, `mobile` serving an
   archived unbuildable client, most of `tier1-4`). Deletion adds no capability
   but makes the route count honest. Mounted, so a founder could in principle
   POST to it — which makes this a product decision rather than dead-code
   removal, and it is why it has not been taken.

2. **Readers whose writers can never run.** Two remain, same shape:
   `/agents/okr` renders from `company_okrs`, `scribe.ts` reads
   `agent_wiki_entries`, and in both cases the only writer is a module nothing
   can reach. ~769 LOC. Deleting a mounted page is a product decision, so it is
   recorded rather than taken as collateral.

3. **The suite aborts natively, and the cause is not established.** A Rust panic
   out of the libsql binding (`PendingException` where `Ok` was expected) that
   takes the whole run with it. An abort is worse than a failure: "validation
   green" becomes a claim about a process that survived.

   - **Eliminated by measurement:** the uncleared query-timeout timer (real
     defect, fixed, abort recurred with the fix in place); the old 1-in-64
     fixture collision (a different intermittent, resolved earlier).
   - **Live hypothesis:** nothing ever closed a database connection, so a run
     left hundreds of native handles to the garbage collector — including
     collection during the next file's queries, which is where both observed
     aborts landed. `closeDb()` exists and the suite closes after every file.
   - **Evidence: over 30 consecutive clean runs since.** Against the prior rate
     that is a vanishing coincidence. Strong, still not a diagnosis — a
     recurrence eliminates this hypothesis the way the last one was eliminated.
   - **Method note:** never run two suites at once.
     `gates-fail-when-they-should` plants real files into the working tree, so
     concurrent runs collide and produce failures that look like defects.

4. **85 write-only columns.** `check-write-only-columns.mjs` holds the count;
   this line said 92 while the ratchet said 85, which is the kind of drift the
   ratchet exists to prevent in code and evidently not in prose.
   Attributed by writing area rather than guessed at:

   - **20 are written by `services/institution`**, and those are the ones worth
     reading. The claim that they were all "answered where they are written"
     did not survive checking: `outbound_actions.outcome_evidence_ref` was one
     of them, and reading it turned out to be the fix for an outcome that could
     never be reopened once settled. Remaining institution ones include
     `provider_receipt_json` (the founder cannot see what the provider actually
     said), `autonomy_consents.from_mode`, and
     `responsibility_shadow_expectations.observation_source_evidence_ref` (the
     letter says what differed, never where it was watching).
   - **22 are `services/scp`** and most of the rest are legacy verticals.
   - **Two are a company's SEASONALITY** (`business_model_profile.seasonal_*`),
     and the earlier note here overstated them: the only writer is
     `routes/api/tier3.ts`, part of the clientless API in item 1. Nothing
     *records* the shape of a company's year — an unreachable endpoint could,
     and nothing would read it. That makes them item 1's problem, not their own.

   `signal_events.processing_session_id` accounts for eleven of the institution
   rows on its own and is one column, not eleven findings.

5. **One concept, two canonical truths: `customers` and
   `customer_intelligence`** — now in the COMPARE stage, with the live harm
   fixed and a measurable cutover criterion.

   The split ran exactly along the line between where a real company's data
   ENTERS and where the institution LOOKS. `POST /api/v1/customers` — the
   documented external surface with issued scoped credentials, the path a real
   company integrates against — writes `customer_intelligence`. The customer
   success and outreach departments read `customers`, whose only writers are a
   session-authenticated route no client calls and the demo seed. **A company
   that reported its customers the documented way was invisible to the
   departments that act on customers**, and the outcome verifier's
   `customer_health_not_worse` looked such a customer up in the wrong table and
   abstained — a vacuous pass, forever, for exactly those customers.

   `institution/company-customers.ts` is the one accessor: both stores read,
   every record says which it came from, one at-risk predicate and one champion
   predicate stated once. `customerStoreSplit(productId).onlyLegacy` reaching
   zero is the criterion that says the legacy read can go — the *compare* stage
   made measurable rather than asserted.

   **Converged since:** `north-star` (its gap was computed from the legacy store
   under a comment calling it canonical — a company that integrated properly
   read `arr_current_dollars = 0`) and `graph/engine` (a company's own knowledge
   graph contained none of its reported customers).

   **What is left.** `customers/intelligence.ts` legitimately owns the legacy
   table — it computes health and marks champions there, and is that store's
   service. `founder/intelligence.ts` aggregates PLATFORM-WIDE across all
   companies for the operator, so it cannot use the per-product accessor; its
   totals, champion count and MRR-at-risk therefore still exclude every reported
   customer. That is Foundry's own view of its platform being computed from one
   store — lower stakes than a founder's own numbers, same class of error, and a
   UNION away. Deleting the legacy read is the cutover, and
   `customerStoreSplit(...).onlyLegacy` reaching zero is its criterion. `customer_events` has one writer,
   `routes/api/platform.ts`, part of the clientless API in item 1 — where that
   API is unused, `customers.churn_risk` reduces to `last_active_at` recency.

   Related, found while here and not yet acted on:
   `customer_intelligence.do_not_contact_until` has **no readers and no
   writers** — a third contact control, inert, beside the canonical
   `outreach_suppressions` one that is consulted at the boundary. Retire the
   column or fold it in; do not leave a third.

6. **The transcript sense: NOT a gap. Corrected before it was built on.**

   This list said a company's customer calls "reach one dashboard page and
   nothing else", and proposed wiring extracted commitments into responsibility
   discovery through a founder question. **Both halves were wrong**, and the
   check that found it was reading the code rather than trusting the note.

   `/signals/multimodal` is mounted (`index.ts:516`) and its transcript detail
   page renders the extracted commitments, objections and competitor mentions
   (`signals-multimodal.ts:295-297`). The sense reaches a person.

   And it must not reach further by extraction. Migration 126 states the
   boundary in the words that settle it: *"nothing inferred from free-form
   chat: the founder states the kind explicitly, and ambiguity stays
   conversation."* A transcript is free-form speech. Proposing a responsibility
   from a model's reading of it — even for confirmation — is the thing that
   sentence forbids, and it is the same reason the candidate-recognition chain
   is deliberately unwired.

   **The correct shape, if this is ever taken further:** the founder reports the
   obligation through the existing explicit intake, choosing the kind from the
   closed set themselves. Foundry may show them what it heard. It may not
   choose the kind for them, and it may not pre-fill one.

   What is genuinely worth checking here, and has not been: whether a founder is
   told a transcript arrived at all, or must navigate to the page to find out.
   That is a "where does a person read this" question about NOTICE, and it can
   be answered without inferring anything.

7. **Two unread outcome predicates.** `shadow_expectation` and
   `shadow_comparison` (`external-shadowing.ts`). Their table side IS consumed —
   `assisting-admission` reads the comparison rows — so these are redundant
   claims rather than lost learning. The resolution is to say so where they are
   written, or stop writing them.

   `development_shadow_comparison` turned out to be something else entirely:
   pulling on it found that **nothing in production ever resolved a development
   shadow expectation**. The Letter lets a founder open one — Foundry asks what
   they would expect a check to report and records their answer — and
   `resolveDevelopmentShadowing` had no caller outside its own tests. The
   institution asked a person a question and never compared the answer with what
   the check said. Now resolved by the judgment tick, in the same loop as its
   external-metric twin, because having them wired in two places is how one of
   them came to be wired in none.

8. **Adapters for the existing intakes.** The shape is proven; breadth is
   missing and the owner's pilot decision gates on it.

   Related, and now decided rather than open: the same obligation reported
   twice converges — within a reporting source. Across sources it does not, and
   that is the engineering call, not indecision. A responsibility carries one
   `discovery_evidence_ref`, so merging a founder's report onto a rota system's
   would make the second witness invisible, where today it is visible as its
   own item. Merging becomes right the moment a responsibility can hold more
   than one witness; until then the duplicate is the lesser loss. Both halves
   of the rule are asserted, and each clause of the convergence predicate has
   been mutated and shown load-bearing.

9. **CLOSED: the uncalled-export sweep.** 32 of the institution's exported
   functions had no caller anywhere in `src/`. They have been read. What is
   left is 26, and every one of them is accounted for:

   - the frozen benchmark scorers (`*-benchmark.ts`, `support-pilot-readiness`),
     legitimately test-driven;
   - the development-change vertical — `enterDevelopmentAssisting`,
     `planDevelopmentChange`, `executeDevelopmentChange`,
     `verifyDevelopmentChange`, `rollbackDevelopmentChange`,
     `grantDevelopmentAuthority`, `revokeDevelopmentAuthority`. **Do not wire
     this.** It is not an oversight: `OWNER_DECISIONS_PENDING` RESOLVED 2 says
     the bounded regeneration grant is deliberately not performed, so Foundry
     may not mutate its own repository outside a test. Uncalled is the correct
     state, and giving the founder a door to grant it is the same act as
     wiring it;
   - `reconstructCompany` and the candidate chain
     (`discoverCandidatesFromReconstruction`, `supersedeResponsibilityCandidate`),
     both examined below.

   Six defects came out of the sweep, each in git history: a founder question
   nobody compared against reality; an authority a founder could not withdraw;
   a number a founder could start watching but never stop; a bounded-help line
   that called a founder's own notice a support reply to a customer who does
   not exist; a pilot-readiness criterion proved on a query production never
   runs; and a responsibility that could be created with nothing to point at.
   The seventh, and the largest, came from pulling on the last of them: a
   question the founder skipped could never afterwards be answered, which
   foreclosed a responsibility permanently and silently (migration 169).

   **Do not build a gate for this.** Reachability at function granularity needs
   a real call graph — a first attempt that excluded a function's own file
   called `evaluateInstitutionalJudgment` unreachable when a production entry
   point in the same module calls it — and even the honest rule cannot tell a
   test-only benchmark from a defect. The list was worth reading once. It is
   read.

   **Candidate recognition stays, unreachable and asserted.**
   `discovery.ts:discoverCandidatesFromReconstruction` ->
   `proposeResponsibilityCandidate` -> `responsibility_candidates` -> The
   Letter's "Possible responsibilities requiring your judgment" is a four-layer
   chain with no production supply: nothing in `src/` writes an
   `operational_responsibility` reconstruction claim. It was not deleted — it
   carries an E3 claim the recognition benchmark scores, and wiring it would
   require Foundry *inferring* responsibilities, which migrations 126 and
   135-138 forbid. The section renders only when non-empty, so no false promise
   reaches a founder. All of that is asserted in
   `candidate-recognition-has-no-production-supply.test.ts`.

   **`reconstructCompany` is a benchmark-only projection, and its `unknowns`
   are production-constant.** It assembles identity, systems, responsibilities,
   claims and unknowns; only the reconstruction benchmark consumes it. System
   staleness is already surfaced on the integration-health page, and unknown
   FACTS are surfaced through founder evidence requests — so the projection is
   not a missing founder surface. But `unknowns` is computed from
   `subject='company' AND predicate='purpose'`, and nothing in `src/` can write
   that claim: company-scope founder evidence is recorded under
   `subject='product:<id>'`, and `purpose` is only ever asked at responsibility
   scope. In production `unknowns` is permanently `['company_purpose']`.

   **Named trap: two spellings for one subject.** `company-observation.ts`
   writes `subject='company'`; `founder-evidence.ts` writes
   `subject='product:<id>'` for the same company scope, and `readCapacityView`
   reads the latter. Whoever wires a company-level fact next will pick one and
   be silently invisible to the reader using the other. Left alone rather than
   normalised on a guess: the `observation_channel` claim written under
   `'company'` has no reader at all today, so the fix is to decide the spelling
   when there is a second reader to be consistent with.

## What keeps working, for whoever comes next

These lenses produced almost everything found in the last two cycles. They are
worth trying before inventing a new one:

- **"What does this claim that its execution path cannot support?"** The one
  that produced this cycle. A `success: true` from a function that contacted
  nobody; "No product or founder ID stored" above a primary key containing the
  product id; "anonymized usage patterns" over a named founder's funnel;
  "statistical patterns across hundreds of products" over an eligibility floor
  of five. Read the sentence, then read the line under it — the sentence was
  often true when it was written and nobody re-read it after the code moved.
- **"Who is this control for, and can they reach it?"** A suppression list with
  no way in. Four privacy toggles nothing read. A control that cannot be
  populated or is not consulted is a sentence in a migration, and it will be
  believed by the next person who greps for it.

- **"Where does a person read this?"** The institution knew three large facts
  about a company — that it was being deleted, that it had stopped, and how its
  own judgments had held up — and said none of them on the page a founder opens
  daily. Computing a thing is not telling anybody.
- **"What happens when this fails, and who finds out?"** A credential that
  authenticated and then had every request thrown away looked healthy:
  `last_used_at` recorded being let in, and nothing recorded not being
  understood. The same on a support channel, where the thing thrown away was a
  customer's message and the founder read the silence as nobody having written.
  Foundry knows both facts and said neither.
- **"One rule, two implementations."** Two retention jobs deleting from the same
  table on different horizons; a live-grant predicate hand-copied seven times
  and drifted; a type protecting a SQL identifier that does not exist at
  runtime. Ask which one is in force, not which one is written down.
- **"What does the offer promise that the guard will refuse?"** Permission
  offered that the database would not honour; a refusal swallowed on the one
  surface that grants authority.

## Blocked — needs a design decision, not effort

- **Named-agent retirement.** The twelve live agents are model-driven; the institution is deliberately model-free. They are Class C, not B: cutting them over would LOSE capability rather than preserve it. Blocked on executive-cognition design, itself blocked on a consumed task with a baseline. Do not force it.
- **`challenger` and `synthesizer` are NOT part of that.** They are not agents at all — standalone debate functions reached by static import. Classifying them from the directory nearly justified deleting live code; the gate now checks reachability instead of location.

## Blocked — owner

**Six items pending.** §9 retention lawfulness, §11 the audit-log horizon and
§13 the cross-company aggregation threshold need counsel rather than the owner
alone; §10 (the five erasure tables) has a recommended answer and waits; §12
needs a deployment FACT before it is a decision; §14 is a product and legal
position rather than a mechanism.

§11: two retention implementations disagreed about `audit_log` — 365 days
written down, 180 actually in force. Fixed at 180, which is what has been
happening; which figure is right is the owner's.

**§12 — one shared key reads any company's whole picture.**
`GET /internal/operator/dashboard-data?product_id=…` returns a named company's
risk state, stressors, MRR decomposition, retention, NPS, churn and cohort
summary, behind a single process-wide `ECOSYSTEM_SERVICE_KEY` with no owner
check and no tenant binding. Its own comment says it is "used by Apex Micro,
other ecosystem products". Whether that key has ever left the owner's control
is a fact only the owner has, and the two answers want opposite changes —
per-company scoping, or withdrawal — which is why it is not guessed at. The
route is read-only and nothing was relaxed; `/internal` is deliberately outside
the member-capability ratchet because no member is present on it, which is also
why this went unexamined.

**§13 — is k = 5 defensible?** Cross-company aggregation now has one floor at
five distinct contributing companies, and contribution requires consent. Five
is the smallest count at which no single contributor dominates an aggregate.
Whether it is sufficient for the jurisdictions Foundry operates in, whether a
consent toggle is the right basis at all, and whether a published percentile
must be recomputed when a contributing company erases itself, are counsel
questions. The floor stands meanwhile and nothing claims it is legally
sufficient.

**§14 — should Foundry's own funnel analytics be consent-gated?** They record a
NAMED founder's progression regardless of the Help Improve Foundry toggle. The
copy has been corrected to say so and the consent type is registered as a
recorded preference with that reason; whether the toggle should govern all of
it, none of it, or the detail beyond billing lifecycle is a position rather
than a mechanism.

**§9, as before: retention lawfulness (counsel, not the owner alone).**
`OWNER_DECISIONS_PENDING.md` §9 asks whether the retention periods for what
survives an erasure are right for the jurisdictions Foundry operates in,
whether a redacted shell satisfies a deletion request, and whether keeping the
erasure trail needs its own basis. Proof debt, not a blocker — the dispositions
stand and the erasure runs on them.

The first eight decisions are answered and recorded there as settled. Standing
consequences:

- The public API is **live**. Every new v1 route needs a scope a founder can
  actually grant; the bidirectional gate enforces both directions. Transcript
  ingestion is reachable, so real customer call content can arrive — it is
  customer data AND untrusted external content, and is treated as both.
- Support pilot: **hold for adapter breadth.** E4 stays unclaimed.
- Recursive Foundry: the owner performs the **report only, not the grant** —
  Foundry still may not mutate its own repository outside a test. Do not
  simulate the report; do not treat a local run as the deployed one.
- Effect kinds stay **constitutional**. Never add a mechanism that lets them be
  created at runtime, by a company, an integration, or a model. Gated
  structurally, not just documented.
- Peer review is **retired** rather than given a reader (§16 decision).
- Push notifications are wired through the gateway as `send_push`.

## Blocked — external

- **Real bounded support pilot (E4).** `support-pilot-readiness-v1` is green and means only *ready to attempt*.
- **Deployed recursive operation.** Requires a genuine owner-authenticated report and grant performed outside the coding environment. Must not be fabricated.
- **Judgment calibration.** Requires real later-outcome evidence reaching the evaluation path.
- **Business outcomes.** Provider acknowledgement is not resolution; `unresolved` is preserved deliberately.

## Worth an owner's attention, not a decision

- **Any integration configured through `/agents/integrations` before this
  session stored its provider secret in a plaintext column.** Reads fall back
  to it so nothing breaks, and `plaintextCredentialKeys(productId)` names
  exactly which keys to rotate. **No real credentials are affected** — nothing
  has met reality, so there are no production integrations. Recorded here so
  the rotation step is not forgotten if that changes.

## Proof debt

- Everything wired in sessions 4–10 is **E2** — local runtime through production-facing services. A production-facing code path is not production evidence.
- E3 claims cover **only the synthetic dimensions their corpora actually exercise**.
- The institution DARK list now contains **only frozen benchmark gates**, which is what it was always supposed to mean. `development-shadowing.ts` left it when the owner gained a way to state what they expect a check to report.
- ~~Open nondeterminism evidence debt~~ — **RESOLVED**. A near-miss key fixture built as `key.slice(0,-1) + 'X'` collided with the real key whenever it ended in `X` (1 in 64). Not a database, scheduling, or concurrency problem. See IMPLEMENTATION_STATE for the full record.
- The foreign-key PRAGMA defect fixed during that investigation is **latent, not the cause**.

## Deferred

- **Real AcreOS** — owner deferral, unchanged.
- **Quality/cost comparator** — trigger: a real decision between two candidate methods for a consumed capability.
- **Founder-attention measurement** — trigger: a real founder-facing or economic decision consuming it.
- **Assisting → Operating** — frozen; must be designed prospectively from real E4/E5 evidence.
