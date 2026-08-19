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
- **Migrations:** 203 files, highest **167**. Ordering gated. Snapshot current.
- **Validation:** full suite green — **259 files / 2,272 tests**. `npm run check`
  green, and it now runs every gate. CI runs on this branch for the first time.
- **Ratchets:** unguarded mutating routes **114** (population corrected from a
  quarter of the surface — see below); fabricated test schemas **13**;
  writer-less tables **0**; SELECT drift **0**; fabricated test schemas **4** (was 13).

## Active work

None in flight. Frontier item 6 is halfway across and gated; the remaining
nine files are named in the baseline.

## What this tranche established

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

## Highest-value current opportunities

Provisional, recomputed each cycle. Not a backlog — if something better is
found, this list loses.

1. ~~Two disagreeing answers to "what needs you".~~ **Closed, all three
   stores.** `decisions`, `institutional_responsibilities` and
   `strategic_decisions_log` are projected over by one rule, on both paths
   (`composer.ts` for a company, `fleet.ts` across the fleet): overdue
   obligation, then contradicted judgment — both LATE against a date the company
   itself gave — then the founder's own queue, then other responsibility asks,
   then open judgments. The fleet item is a discriminated union, so every
   consumer must say which kind it handles; the verifier re-reads each kind from
   its own ledger and drops it if the ledger no longer says it.

2. **~1,600 LOC of clientless API** (`founder-intelligence`, `mobile` serving
   an archived unbuildable client, most of `tier1-4`). Deletion adds no
   capability but makes the route count honest — the 114 figure includes pages
   no person can reach. (~1,000 LOC of statically dead modules already gone;
   `check-reachability` holds the rest at 30 and may only shrink.)
3. **Readers whose writers can never run.** One of three resolved: the public
   API's data-quality chain is retired (migration 167) because wiring it would
   have meant inventing thresholds Foundry has no basis for. Two remain, and
   they are the same shape: `/agents/okr` renders from `company_okrs` and
   `scribe.ts` reads `agent_wiki_entries`, and in both cases the only writer is
   a module nothing can reach. Deleting a mounted page is a product decision,
   so it is recorded rather than taken as collateral.
4. **The five deferred erasure tables** (`OWNER_DECISIONS_PENDING` §10) — a
   live gap with a recommended answer, waiting on the owner.
5. **Adapters for the existing intakes.** The shape is proven; breadth is
   missing and the owner's pilot decision gates on it.
6. ~~The ladder's tests enter through a door production does not have.~~
   **Closed.** Twenty test files built ladder state through `discovery.ts`'s four
   SaaS event types, which nothing in production emits. All twenty were moved
   onto the real intake under a ratchet, the ratchet reached zero, and
   `SIGNAL_RESPONSIBILITIES` and the gate are both deleted. Discovery now has one
   contract: the company states the kind. `reportedObligation()` in
   `tests/fixtures/responsibility-state.ts` is the fixture door, and it calls
   `reportCompanyObligation` rather than re-implementing it.

   Left behind as standing guards rather than history:
   `discovery-is-not-reachable-from-integrations.test.ts` holds that the one
   caller stays one, that no second domain-shaped contract reappears, and that
   `EVENT_AGENT_MAP` — the same defect one layer up — stays asserted.

7. **The rest of the outcome loop.** Two of five closed, both the same shape: a
   learned claim written beside a state column, with the column read and the
   claim read by nothing.
   - `development_change_outcome` — **closed.** The founder sees how Foundry's
     changes to their systems have held up.
   - `later_reality_comparison` — **closed.** The founder sees how Foundry's
     judgments about their company have held up, which is the record that
     decides how much weight to give the next one.
   - Still unread: `shadow_expectation` and `shadow_comparison`
     (`external-shadowing.ts`), `development_shadow_comparison`
     (`development-shadowing.ts`). These are shadow records rather than
     outcomes, so the reader they want is probably admission evidence rather
     than a founder line — `assisting-admission.ts` already counts deviations
     and verified failures from other sources and is the natural home.

   Both closures follow the same rules and the next should too: counts and never
   a rate, `unresolved` carried as its own number, nothing shown at all for a
   company with no observations, and staleness asymmetric so read-time expiry
   retires a positive claim and never a negative one. Foundry may not improve
   its own record by waiting.

9. **97 columns are written and never read.** New instrument:
   `check-write-only-columns.mjs`, the mirror of `check-writerless-tables`. It
   was built after finding the same defect by hand twice — `learned_claim_id` is
   written on four tables, every write recording what Foundry had learned, and
   nothing read any of them. Two now have readers and both became something the
   founder can see.

   A write-only column is not automatically a defect: provenance is a real
   reason to record what no code consumes. But it is always a question, so the
   count is a ratchet rather than a wall, and the baseline is the list of
   questions nobody has answered yet. The gate states its own blind spot: it
   cannot see a read that never names the column (`SELECT *` with generic row
   iteration), and it ignores `tests/` on purpose — a test reading a column is
   not the product consuming it.

   Working through the 97 is a real seam. The two already done suggest the
   shape: ask what the write was FOR, and either give it a reader a person can
   reach or delete it.

10. **An intermittent native abort in the suite — one cause eliminated, one
    hypothesis live.** `npm run check` dies with a Rust panic out of the libsql
    binding (`PendingException` where `Ok` was expected) and SIGABRT. Not the
    old intermittent, which was resolved as a 1-in-64 fixture collision.

    An abort is worse than a failure: it takes the run with it, so "validation
    green" becomes a claim about whether the process survived long enough to
    say so.

    - **Rate:** roughly 1 run in 3 on this machine, measured over a deliberate
      repeat-run experiment.
    - **Locus:** both observed aborts landed at the same boundary — immediately
      after `autopilot.test.ts` finished, as the next file started.
    - **Eliminated:** the uncleared query-timeout timer. Fixed, and the abort
      recurred with the fix in place. That settles it: the leak was real and
      was not this.
    - **Live hypothesis:** nothing ever closed a database connection. Each test
      file gets its own module registry and therefore its own libsql client, so
      a run created hundreds of native handles and left every one to the
      garbage collector — including collection during the next file's queries,
      which is exactly the observed boundary. `closeDb()` now exists and the
      suite closes after every file.
    - **Evidence so far: six consecutive clean full runs since `aa01e4d`** —
      three from a deliberate repeat-run experiment on a frozen tree, three from
      ordinary `npm run check` validations. Against the prior rate that is about
      a 1-in-17 coincidence. **Suggestive, not settled.** Keep counting: every
      `npm run check` is a sample, and the next abort — if it comes — eliminates
      this hypothesis the way the last one eliminated the timer.
    - **Method note for whoever continues:** do not run the suite concurrently
      with another run. `gates-fail-when-they-should.test.ts` plants real files
      into `src/` and `tests/`, so two runs collide and produce failures that
      look like defects. One such collision cost an hour here.

11. **A refusal the founder could not see, on the surface that grants
    authority.** `grantAssistingAuthority` caught the database's refusal with a
    bare `catch {}` and returned `admitted: false`, which the route ignored
    before redirecting. So a founder granted permission, saw no difference, and
    was left with a live consent Foundry could not use and no way to find out
    why. The card compounded it: `granted` meant "a live consent exists", not
    "Foundry is helping", so a refused admission read exactly like an accepted
    one.

    Notable because the codebase's own convention is the opposite — the
    notice-carry route returns `Not carried: <reason>` and the disposition
    routes all surface refusals. The single exception was the one route that
    grants authority.

    **Closed.** The reason is captured and logged, the card distinguishes a live
    grant from actually assisting, and the grant is NOT destroyed: the owner
    gave it, Foundry declining to use authority is always permitted, and Foundry
    deleting an owner's grant would be editing the owner's decision.

12. **`authorityRequired` said authority was no longer required after a
    withdrawal.** ~~Open.~~ **Closed.** The understanding projection read
    `authority_ref === null`, and that column is deliberately not cleared when a
    founder withdraws permission — the ledger keeps the history and every
    execution path re-reads `revoked_at IS NULL`. So the projection inverted the
    answer on the one question the founder had just acted on. It asks the ledger
    the same question the execution paths ask now. `absence-summary` had it
    right all along, which is how it was found.

14. **Working the write-only seam: the institution's own tables are done.**
    Baseline 96 → 95, and every remaining entry on an institution-owned table
    now has its answer written where the column is written, as the gate's own
    message instructs:
    - `products.scp_constitution_version` — **retired** (migration 168). A
      version stamp promises that a consequence path asks which constitution a
      company is on. Nothing did, and it had been 1 for every company since it
      was added. Wiring it would have meant inventing a second constitution for
      it to be a version of, which is an owner question.
    - `system_identities.established_reason`,
      `responsibility_candidate_decisions.{grounding_mechanism,
      grounding_evidence_json, resulting_initial_state}`, and
      `strategic_decisions_log.authority_required_json` — **provenance, stated
      as such.** The first three answer "how did this come to exist and on whose
      say-so" for a person, not for code. The fourth is a constant: a judgment
      can never allocate or execute, and reading it back would be Foundry
      checking its own constitution against a copy of itself.

    The ~90 that remain are on the older SCP/tier tables and are unexamined.

13. **Three more write-only columns, previously invisible.** The gate matched
    `INSERT INTO` but not `INSERT OR IGNORE INTO`, so every column written only
    through a conflict-handling insert could never be reported. Fixed; baseline
    93 → 96. Two of the three are a company's SEASONALITY
    (`business_model_profile.seasonal_baseline_factor`, `seasonal_peak_months`)
    — Foundry records the shape of a company's year and nothing reads it. Worth
    a look: it is the sort of fact a marina or a dance school would expect to be
    used.

15. **The interruption policy's top rung did what the rung below it does.**
    ~~Open.~~ **Closed.** `deliver()`'s `push` branch wrote a notification row
    and returned `delivered: true`, with a comment claiming a mobile poller
    picked it up. No such poller exists — nothing turned a notification row into
    a push — so `decideChannel` deciding an event warranted interrupting the
    founder had exactly the same effect as deciding it did not. Meanwhile the
    push capability the owner explicitly asked for sat built and governed with
    one caller.

    It has a second caller now. The record is still written, because a push is a
    nudge and a founder who missed the buzz must still find the thing in the
    app; `delivered` means "a record exists" and `pushed` says whether the phone
    was reached, which were the same field.

16. **`memberMay` interpolated a capability into SQL with no runtime check.**
    ~~Open.~~ **Closed.** The capability is a column name, and the closed union
    protecting it is a TYPE — erased at runtime. What actually protected it was
    every call site happening to pass a string literal, which is a property of
    the wiring rather than of the function, and the function is one call site
    away from being reachable with a request-supplied string.

    `push.ts` carries the identical shape and was hardened for exactly this
    reason. This is the AUTHORITY check, so it was the last place that should
    have been relying on a type that does not exist at runtime. It fails closed
    now, and the check runs BEFORE the ownership shortcut so an unknown
    capability cannot be answered `true` for an owner either.

    Worth generalising: `grep` for a template literal placing a variable where a
    column name goes. Two found so far, both by reading rather than by a gate.

17. **Two retention policies, both deleting, silently disagreeing.**
    ~~Open.~~ **Closed, with a question for the owner.** `services/retention.ts`
    ran a daily purge over `agent_messages` and `audit_log` on one global
    window; `services/maintenance/retention.ts` ran its own daily purge over
    five tables with per-table horizons. They overlapped on `audit_log`, where
    one said 365 days and the other deleted at 180. The shorter wins, so the
    audit log has always been kept 180 days while the code stating the policy
    said 365.

    The crude implementation and its job are deleted. `audit_log` deliberately
    stays at 180 — removing a duplication must not quietly change what happens
    to anybody's data, and lengthening retention of records that may name people
    is the wrong direction to take by accident. Which figure is right is now
    `OWNER_DECISIONS_PENDING` §11, beside the retention question already with
    counsel. `DATA_RETENTION_DAYS` survives as a CAP: a deployment that set it
    did so to keep less.

18. **The live-grant predicate was hand-copied seven times and had drifted.**
    ~~Open.~~ **Closed.** `reconstruction.ts` asked only for an unrevoked
    act-grant for the same CAPABILITY: an expired grant reported as active
    authority, and a grant bound to one responsibility made every other
    responsibility of that capability report authority it did not have — while
    execution requires a grant bound to the responsibility and still in date.

    "A copied fragment of a rule drifts the moment the rule grows another axis"
    was already written in this codebase, about `operatingProduct`. Authority
    grew two axes — expiry and responsibility binding — and the copies did not
    follow. There is a canonical `liveActGrant(alias)` in `db/client.ts` now,
    and five of the six call sites use it. The sixth compares against a
    caller-supplied clock and says at the line why it is still by hand.

## Blocked — needs a design decision, not effort

- **Named-agent retirement.** The twelve live agents are model-driven; the institution is deliberately model-free. They are Class C, not B: cutting them over would LOSE capability rather than preserve it. Blocked on executive-cognition design, itself blocked on a consumed task with a baseline. Do not force it.
- **`challenger` and `synthesizer` are NOT part of that.** They are not agents at all — standalone debate functions reached by static import. Classifying them from the directory nearly justified deleting live code; the gate now checks reachability instead of location.

## Blocked — owner

**One item pending: retention lawfulness (counsel, not the owner alone).**
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
