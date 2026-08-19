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
- **Head:** `e2e9c6b`. **Migrations:** 205 files, highest **169**. Ordering gated. Snapshot current.
- **Validation:** full suite green — **264 files / 2,323 tests**, `npm run check`
  EXIT=0, every gate chained and running in CI on this branch.
  **Qualified:** the suite aborts natively about one run in three *before*
  `closeDb` landed; over 30 consecutive clean runs since. See item 3.
- **Ratchets:** unguarded mutating routes **114** · fabricated test schemas **4**
  · writer-less tables **0** · SELECT drift **0** · untraced consequential
  effects **0** · statically unreachable modules **29** · write-only columns
  **95**.

## Active work

None in flight. Everything below is unstarted or blocked.

## What the last cycle established

*One paragraph, deliberately. The narrative record is
`history/SEAM_CAMPAIGN_HISTORY.md`; this file is what a steward needs today.*

The institution computes more than it says. Three large facts about a company —
that it is being deleted, that Foundry has stopped working for it, and how
Foundry's own judgments and changes have held up — were all computed correctly
and appeared nowhere a founder reads. They do now. The same cycle found one rule
implemented twice and disagreeing (two retention jobs deleting from `audit_log`
on different horizons), a live-grant predicate copied seven times and drifted
(an expired grant reported as active authority), an authority check protected by
a TypeScript type that does not exist at runtime, and a refusal swallowed on the
one surface that grants authority. Every one of them was found by reading for a
specific failure shape rather than by reading a subsystem — the shapes are
listed under "What keeps working" below.

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

4. **~95 write-only columns on the older SCP/tier tables.**
   `check-write-only-columns.mjs` holds the count. The institution's own tables
   are done — each remaining one there is answered where it is written. These
   are unexamined, and the two examined so far both turned into something a
   founder can now see. Two of them are a company's SEASONALITY
   (`business_model_profile.seasonal_*`): Foundry records the shape of a
   company's year and nothing reads it.

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
     `grantDevelopmentAuthority`, `revokeDevelopmentAuthority` — already
     recorded as DARK. Foundry improving Foundry, built and not wired;
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
