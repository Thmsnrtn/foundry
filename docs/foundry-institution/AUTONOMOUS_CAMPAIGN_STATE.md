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
- **Head:** `1af4fc6` plus the tranche this checkpoint describes.
  **Migrations:** 210 files, highest **174**. Ordering gated. Snapshot current.
- **Validation:** full suite green — **287 files / 2,426 tests**, `npm run check`
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

4. **92 write-only columns.** `check-write-only-columns.mjs` holds the count.
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

5. **Two unread outcome predicates.** `shadow_expectation` and
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

6. **Adapters for the existing intakes.** The shape is proven; breadth is
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

7. **CLOSED: the uncalled-export sweep.** 32 of the institution's exported
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

Three lenses produced almost everything found in the last cycle. They are worth
trying before inventing a new one:

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

**Three items pending.** §9 retention lawfulness and §11 the audit-log horizon
both need counsel rather than the owner alone; §10 (the five erasure tables) has
a recommended answer and waits on the owner.

§11 is new: two retention implementations disagreed about `audit_log` — 365 days
written down, 180 actually in force. The duplication is fixed at 180, which is
what has been happening, and which figure is right is the owner's.

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
