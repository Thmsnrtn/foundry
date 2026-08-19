# Implementation State

**Current verified reality.** What exists, what is reachable, what is proven,
what is not, and the debt that matters. This is the document a steward reads to
know what is true today.

It is deliberately short. The record of *how* each thing came to be — every
completed slice, cutover, benchmark and deletion, and the Tranche-0 baseline
manifest — is `history/IMPLEMENTATION_SLICES.md`. What to do next is
`AUTONOMOUS_CAMPAIGN_STATE.md`. How development operates is
`DEVELOPMENT_INSTITUTION.md`.

**Replace claims here when they become false. Do not append beneath them.**

---

## Verified now

Measured at `aa01e4d` on `claude/foundry-autonomous-continuation-0gents`.

| | |
|---|---|
| Stack | Node 20, TypeScript, Hono, libSQL/Turso, Vitest. Fly.io. |
| Migrations | **203 files**, highest number **167**. Applied lexically at startup, which equals numeric order because `check-migration-order.mjs` enforces fixed-width numbering; 31 numbers are duplicated from early parallel development and are baselined. Schema snapshot current and gated. |
| Validation | Full suite green: **260 files / 2,294 tests**. `npm run check` green — and `check` now actually runs every gate, including the thirteen it used to omit. **It also aborts intermittently** — roughly one run in three — with a native libsql panic that takes the whole run with it. See the live frontier: a green run is currently a claim about a process that survived. |
| CI | Runs on `master`, `main` and `claude/**`. It triggered on master alone until now, so **no gate in this repository had ever run in CI** for the branch all the work is on. |
| Ratchets | Unguarded mutating routes **114** · fabricated test schemas **4** · writer-less tables **0** · SELECT drift **0** · untraced consequential effects **0** · statically unreachable modules **29** · **write-only columns 93** (new: the mirror of writer-less tables — columns the system fills and never reads). |
| Composition root | `src/index.ts`. Static/public, signed webhooks, internal service-key, Clerk-authenticated founder, and API-key `/api/v1` route groups coexist. |
| Public API | **Live.** Scoped, expiring, revocable keys issued from settings. Every v1 route needs a scope a founder can grant; the bidirectional gate enforces both directions. |
| Consequential effects | Converge through `services/outbound/gateway.ts` — kill switch, classification, budget, idempotency, audit. Inventory in `CONSEQUENTIAL_EFFECTS.json`; untraced count ratcheted to zero. |
| AI spend | Central OpenRouter client. Atomic reserve → dispatch → settle across global/product/founder scopes. Refuses spend for a company that is not operating, naming which axis stopped it. |
| Erasure | One implementation. Every table classified with a written reason, on two axes: by product, and — since an adversarial review found the gap — by PERSON across companies they do not own. An end-to-end sweep seeds every table and matches by containment, so an id inside a composite key is visible; only survivors with stated retention dispositions are allowed. Deletes where the row is wholly the person's, severs where it is the company's record naming a person. **Five tables are deliberately untouched pending an owner decision** (`OWNER_DECISIONS_PENDING` §10) — company assets on NOT NULL columns — which is a live gap, not a footnote. |

## The institution's senses

- **Time.** A responsibility can carry a due date the COMPANY stated, with who
  stated it; triggers refuse a date with no author and refuse one authored by
  the owner of the product `system_identities` names as Foundry. `overdue` is
  the first reason a responsibility needs the founder, and the only one that is
  a fact about the company rather than about where Foundry has got to. Prose is
  never turned into a date. Reachable from The Letter's report form.
- **A passed deadline can falsify a judgment.** `contradicted` was recorded as
  proof debt because "contradiction needs an observer that can see a deadline
  pass". It has one now, and only that: a conflict still standing after a date
  the company gave. An absent deadline is not a met one.
- **Outcomes now reach the authority request.** `getAssistingCandidates`
  counted matched and deviated comparisons equally and ignored whether previous
  assisted actions had failed. Both are separated and surfaced to the founder
  at the moment they decide whether to grant more. It also counted comparisons
  the database would refuse as entry evidence, so a founder could be asked to
  grant a permission that could not then be used; the offer applies the entry
  guard's own condition now.
- **Foundry can say how it has done.** Two track records, both read back from
  learning it had been recording and never once consulting: how its changes to
  the founder's systems have held up, and how its judgments about the company
  have. Counts, never a rate. Staleness is asymmetric in both — read-time
  expiry retires a positive claim and never a negative one, so Foundry cannot
  improve its own record by waiting.
- **The owner sees what a judgment was computed from.** The scarcity itself
  ("you have 2 work blocks; these need 3"), what each side loses, what else was
  weighed, and whether Foundry can order the alternatives on money — reported
  as itself in all four states, including "I cannot tell you".
- Everything else a company can tell Foundry arrives through the four ingest
  routes, twelve integration adapters, two webhooks, and the founder typing
  into The Letter.

## Reachability caveats that still hold

- ~~The reachability gate scans `src/services/institution` only~~ — **CLOSED.**
  `check-reachability.mjs` walks all of `src/` from the real entry points as a
  ratchet (29 unreachable, may only fall), declares modules reached by a
  computed dynamic import with the mechanism that reaches them, and walks from
  those too.

- **Nothing has met reality.** No real founder, outside tool, or provider.
- Production reachability is proven against **synthetic** companies. A
  production-facing code path is not production evidence.
- `support-pilot-readiness-v1` green means **ready to attempt** a bounded
  pilot. No pilot has occurred.
- Recursive Foundry operation is local only. The owner performs the **report,
  not the grant** — Foundry may not mutate its own repository outside a test.

## Running it, and where things live

A fresh steward needs this before anything else, and it was missing.

```bash
npm install
npx tsc --noEmit                  # typecheck — seconds
npm run lint:columns              # the SQL/schema/authority gates — seconds
npx vitest run tests/unit/<file>  # one test file — seconds
npm run check                     # composite: typecheck + ratchets + full suite (~10 min)
bash scripts/schema-snapshot.sh   # regenerate docs/db/schema.snapshot.sql after a migration
```

Tests need **no external services**. They set `TURSO_DATABASE_URL=file::memory:`
and `ENCRYPTION_KEY` themselves and run migrations into a fresh in-memory
database. Clerk, OpenRouter, Resend and Stripe keys are only needed to run the
server, not the suite.

**Concept → code.** The vocabulary in these documents is load-bearing; this is
where it lives.

| Concept | Where |
|---|---|
| Composition root, route mounting | `src/index.ts` |
| Governed consequential effects | `src/services/outbound/gateway.ts`, inventory in `CONSEQUENTIAL_EFFECTS.json` |
| Kill switch | `src/services/outbound/kill-switch.ts` |
| Migrations, and the SQL splitter | `src/db/migrations/`, `src/db/migrate.ts` |
| Canonical predicates (`operatingProduct`, `visibleProductIds`) | `src/db/client.ts` |
| Authority: capabilities, membership | `src/middleware/rbac.ts`, `src/services/team/members.ts` |
| Principal discrimination | `principalOf` in `src/middleware/` |
| Entitlement / erasure / pause axes | `src/api/middleware/entitlement.ts` |
| Erasure, consent, retention dispositions | `src/services/privacy/consent.ts` |
| Responsibility ladder (Visible→Understood→Shadowing→Assisting) | `src/services/institution/`, `institutional_responsibilities` |
| AI spend reserve/settle | `src/services/ai/client.ts` |
| Scheduled jobs and the registry | `src/jobs/index.ts` |
| CI gates ("ratchets") | `scripts/check-*.mjs`, chained by `npm run lint:columns` |
| Gate baselines | `docs/db/*-baseline.txt` |
| Gate self-tests (planted defects) | `tests/unit/gates-fail-when-they-should.test.ts` |

**Evidence levels (E0–E6) are defined in `PROOF_PROGRAM.md`.** Every maturity
claim below uses them; read that file before trusting a level here.

## Environment facts worth not re-discovering

- **`sqlite3` IS available** (`/usr/bin/sqlite3`), so `bash scripts/schema-snapshot.sh`
  runs directly. Earlier records said otherwise.
- The branch is never merged to master — standing owner instruction.
- Vitest full runs take roughly ten minutes here. **Do not start a second one
  concurrently**: `gates-fail-when-they-should` plants fixture files in the
  working tree, and two runs collide into a false failure. This is written down
  because it has now cost time twice — the second time to somebody who had this
  document open and had not read this line.

## The ladder in production-facing code

```
outside tool → POST /ingest/:token → external observation ──────────┐
founder reports an obligation → discovery → Visible                 │
  → founder answers/volunteers what Foundry cannot observe → Understood
    → founder states a bounded expectation → Shadowing ─────────────┘
      → external reading → matched / deviated / unresolved
        → founder grants exact bounded authority → Assisting admission
          → customer message on the responsibility's channel
            → founder authors a reply → bounded plan → revalidation
              → governed send_email → receipt → outcome UNRESOLVED

provider adapter → POST /ingest/customer-message/:channelKey
  → canonical message evidence, attributed by channel binding
```

**The chain is complete and closed.** What remains unproven is autonomous reply
generation: the founder writes the reply, and that is now the deterministic
human baseline (§10) any model-generated proposal must beat on a frozen
contract.

All of it is **E2 — local runtime**. Nothing has been exercised by a real founder, a real outside system, or a real provider.

## Evidence frontier (do not inflate)

| Capability | Level | Scope |
|---|---|---|
| Reconstruction / recognition / understanding / Shadowing / judgment / development | E3 | prior exercised synthetic dimensions only |
| Assisting (support reply) | E3 | **prior synthetic dimensions only — unchanged for three sessions** |
| Production reachability | E3 | four synthetic non-software companies, each now entering through the ONE intake production has — they used to be admitted by SaaS event types nothing emits, so the benchmark answered "can a normal company enter the ladder?" through a door the running system does not have. Better founded, same level: still synthetic. |
| Everything wired through production-facing services | E2 | local runtime through production-facing services |
| Recursive Foundry operation | **E1** | `recursive-institution-contract.ts` has **zero importers in `src/`** — only its test reaches it. It was recorded as E2, which means "local runtime through production-facing services", and there is no production-facing service. `recursive-institution-v1` reporting ordinary on thirteen dimensions is a benchmark result, not a runtime one. Never run by a real owner in production. Corrected on evidence, not re-measured upward. |
| Institutional economics | **E1** | `institutional-economics.ts` also has zero importers in `src/`. Attribution is structural and the arithmetic is tested; nothing in production consumes it, so the same correction applies. Seven components remain named-unmeasured. |
| Assisting → Operating | frozen | migration 115; unchanged |
| Real founders, providers, pilots, production | unproven | E4/E5/E6 |

## Open proof debt

- **Nothing has met reality.** No real founder, outside tool, or provider.
- **Autonomous reply generation** is unbuilt and unclaimed; the founder-authored path is the baseline. Its contract is now frozen at E1 and nothing has ever been scored against it.
- **Pilot readiness is green, and that is a smaller claim than it sounds.** `support-pilot-readiness-v1` says *ready to attempt a bounded pilot*. No pilot has occurred; the six named items of outstanding external proof are all still outstanding.
- **Outcome (§12) remains untouched and must stay so:** provider acknowledgement, delivery, customer silence, and elapsed time are all *not* resolution. If a provider can emit an explicit case-status event, audit whether its contract genuinely establishes the outcome before believing it. Preserve `unresolved`.
- ~~Judgment observation cannot report `contradicted`~~ — **CLOSED.** It now
  does, and only against a date the COMPANY stated that has passed with the
  conflict still standing. Anything less is still `partially_observed`: an
  absent deadline is not a met one, and a conflict the owner has simply not
  got to yet has falsified nothing.
- Of the development paths, only `development-benchmark.ts` is still on the reachability gate's DARK list, and it is a frozen benchmark. The rest are statically reachable; what is missing is a caller for the change-execution chain (`plan` → `execute` → `verify` → `rollback`), which is a different gap and is recorded on the frontier.
- Executive cognition: no marginal-value comparison; the cognition gate forces one.
- Economics: near-vacuous while the institution is model-free.
- ~~Duplicate founder reports still create duplicate responsibilities~~ —
  **CLOSED within a source.** Discovery converges a repeat of the same
  obligation: same title, capability, stated deadline and reporting source, and
  only onto an active responsibility. Both reports are kept as evidence; what
  converges is the obligation. Still open across sources, deliberately: a
  founder and one of their own systems reporting the same thing produce two
  responsibilities, because a responsibility carries a single discovery
  reference and merging would make the second witness invisible where today it
  is visible as its own item. See `discovery.ts`.
- NULL-safety gate does not analyse nullable **columns**; trigger tests are the backstop.
- **The suite aborts intermittently and the cause is not known.** Roughly one
  run in three, a native libsql panic that takes the run with it rather than
  failing a test. Two candidates eliminated by measurement (a leaked query
  timeout; the old fixture collision), one live (nothing ever closed a database
  connection — `closeDb()` landed and the suite now closes after every file;
  over 30 consecutive clean runs since, against a prior rate near one in
  three). Until this is settled, "full
  suite green" carries an unstated qualifier: *this time the process survived*.
  Recorded here rather than in a comment because it qualifies every other
  evidence claim in this document.

## Master-audit reconciliation

*Reconciled against the repository rather than against memory. Where a line says "verified", it was checked in that pass; where it states a count, it names the command so the next steward can re-run it rather than believe it. The trigger counts below were last re-run at `c1c0976`.*

### Proven — E3, or structurally enforced and mutation-verified

| What | How it is proven |
|---|---|
| Reconstruction, recognition, understanding, Shadowing, Assisting, judgment, development | Executable benchmark gates, each with a running test. **Scope: the synthetic dimensions those corpora actually exercise — nothing wider.** |
| Production reachability | `production-reachability-v1` across four synthetic non-software companies, each admitted through the one intake production has |
| Unfamiliar-company generalization | Independently generated corpus against the frozen recognition gate |
| **Institutional invariants live in the database** | Not in application code, so a bug in a service cannot bypass them. Reproducible counts across `src/db/migrations/`: **87** `CREATE TRIGGER` statements carrying **74** distinct trigger names, and **222** `RAISE(ABORT, …)` guards — re-counted after migration 169. The name count did not move because 169 drops and recreates `founder_assertion_guard` rather than adding a guard; the statement and abort counts moved by exactly what it re-declares. A previous figure of "169 … verified by count" appeared here with no stated method and cannot be reproduced by any obvious one; these numbers name their own command so the next steward can check them. |
| The scheduled pass has no epistemic privilege | Four-part audit: structural, behavioural (four refusals + one advancing control), provenance, idempotency |
| Support-chain reachability | Sixteen named links, invocation-based, mutation-verified against a removed call |
| Institutional cognition is deterministic | Gate test; no model reachable from the kernel |
| NULL-semantics of every guard | Systematic audit (migration 130) plus a standing gate |
| Coverage integrity in both new gates | Dropping an observation reports *unexercised* rather than passing |

### Implemented but unproven — E2, real code path, local runtime only

Everything built in sessions four through seven: the founder evidence bridge, company-scoped facts, external metric observation, Shadowing resolution, the Assisting admission and its revocable authority, inbound customer message intake, the founder-authored reply proposal, bounded planning, execution-time revalidation, governed send, receipt, and the seven-day absence view. **None of it has been touched by a real founder, a real outside system, or a real provider.** A production-facing code path is not production evidence, and this table is the difference.

### Partially implemented

- ~~**Judgment observation cannot report `contradicted`**~~ — closed by migration 166's stated due dates; see above.
- **Duplicate founder reports still create duplicate responsibilities.**
- **The NULL-safety gate does not analyse nullable columns**, only guard predicates; trigger tests are the backstop.
- **Reachability is per module, not per behaviour.** A module counts as reachable when production imports it at all — including read-only. Several institution modules are reachable that way while their write paths stay undriven.

### Superseded

- The vertical support-chain test's caller assertions — replaced by the standing reachability gate, which cannot go stale.
- Earlier continuation records — this one supersedes all of them.
- Capability-level autonomy consent as a route to Assisting — superseded by responsibility-bound authority (migration 112) and kept structurally distinguishable so the legacy form cannot satisfy the new one.

### Owner deferred

- **Real AcreOS work.** Not inspected, accessed, ingested, modified, integrated, benchmarked against, simulated, special-cased, or used to derive architecture. Unchanged this session.
- **Merging to master.** The branch has never been merged and will not be without explicit instruction.
- **Assisting → Operating.** Frozen by migration 115. Pilot readiness being green is explicitly *not* a reason to design or enable it.

### External-only — cannot be established in this repository at any effort

- Whether a real founder understands and trusts the grant/revoke/re-grant surface.
- Whether a real customer's problem was actually solved (business outcome). Provider acknowledgement, delivery, silence, and elapsed time are all *not* resolution; `unresolved` is preserved deliberately.
- Whether founder attention actually decreases.
- Whether the support envelope survives contact with real message volume and variety.
- Model quality against `support-drafting-v1` — the contract is frozen, and no model has ever been scored against it.

### Still open

*Reconciled again at the close of the eleventh session.*

- **Recursive operation in production.** The vertical is proven locally and end
  to end, but it has only ever run in tests. **External proof debt, explicitly:**
  the deployed Foundry company still requires a genuine owner-authenticated
  report, performed outside the coding environment. The owner has decided on
  **report only, not the grant**, so Foundry still may not mutate its own
  repository outside a test. Neither may be fabricated.
- **Named-agent retirement.** Twelve implementations remain live and
  production-reachable. Retiring them is Class-C, not Class-B: they are
  model-driven and the institution is deliberately model-free, so cutting them
  over would LOSE capability rather than preserve it. Blocked on executive
  cognition, itself blocked on a consumed task with a real baseline.
- **Judgment calibration — still blocked on reality, but less so.** The
  observation pass writes `judgment_expected_supported` when the company
  resolves a conflict and `judgment_expected_contradicted` when a date the
  company itself gave passes with the conflict still standing, so evaluation
  can reach a real verdict rather than only `not_yet_observable`. What remains
  blocked is CALIBRATION: whether Foundry's confidence tracks its accuracy
  needs a run of real judgments against real later reality, and manufacturing
  longitudinal examples to improve that number would corrupt the one number
  that is supposed to be honest.
- **Quality/cost comparator.** Deferred with a stated trigger — buildable when a
  second candidate method exists for a consumed capability.
- **Architecture deletion.** Candidates remain, each needing per-module proof.
  The dynamic-loader blind spot is now closed and the classification gate is
  bidirectional, so the next sweep starts from a trustworthy report.
- **Founder attention** stays unbuilt until a real consumer needs it.

**Closed since the last reconciliation, and not to be re-listed:**

- ~~`challenger` and `synthesizer` are evidence-insufficient~~ — the owner
  answered, and the answer was that my classification was wrong. Both are
  standalone debate functions reached by ordinary static import from
  `debate/orchestrator.ts`. Being in `agents/` is not what makes something an
  agent; the gate now checks reachability rather than location.
- ~~`development-shadowing.ts` remains dark~~ — the owner can now open a
  development expectation, so the DARK list contains only frozen benchmark
  gates, which is what it was always supposed to mean.
- ~~The unreproduced `customer-message-intake` flake~~ — **RESOLVED.** A
  near-miss key fixture built as `key.slice(0,-1) + 'X'` collided with the real
  key whenever it ended in `X`, once in sixty-four. Every one of the six
  eliminated hypotheses was correctly eliminated, and none of them could have
  found it.

## Working rules that mattered most

- **Audit the writers, not just the modules.** Five sessions running, the biggest finding was something built and never called.
- **Attribution must be structural, not semantic.** The temptation this session was to infer which responsibility a customer message belongs to from its text. Binding the channel to the responsibility makes it a fact instead of a guess.
- **Identity comes from the credential, not the payload.** If the authentication channel can establish the source, the body must not be able to claim it.
- **When the honest path stops, stop and say why.** There is still no reply generator; inventing one to turn the pipeline green would have been the worst available outcome.
- **An audit that finds nothing is a result, not a failure to deliver.** Three slices this session ended in building nothing, because the structure already held. The instinct to add *something* so the work looks substantial is how privileged bypasses and second kill-switches get built.
- **Freeze the contract before the thing it judges exists.** Thresholds written after the first model are thresholds the first model passes.
- **A gate you have not mutated is a gate you are guessing about.** Every detector and classifier added this session was broken deliberately first, in both directions, before being trusted.
- **The same defect shape recurs at every layer.** A general mechanism bound to one SaaS-shaped special case: twelve metric columns for observation, one capability and one scope for effects. Finding it once teaches you where to look next.
- **Let reality reveal the missing primitive.** The effect-boundary gap was not designed into a roadmap; four fictional-but-honest businesses walked the ladder and stopped at the same wall.
- **Replacing a guard means reproducing ALL of it.** Migration 135's first draft recreated the vocabulary checks and silently dropped two independence guards. Widening a vocabulary must never quietly narrow anything else.
- **A test that only exercises the service has not tested the database.** Deleting the trigger's tenant binding passed every test until a forged insert named a channel that was live for another company.
- **Fix the fixture, never the feature.** The seven-day view failed against a hand-built stub that had drifted two migrations behind production. The stub was wrong; the query was right.
- **Check the observation against reality BEFORE building on it.** The recursive slice began by measuring the live schema against the committed snapshot — 698 objects each side, exact match — because an observer that reports drift where there is none is not a recursive proof, it is a fabricated fact about the company.
- **A tool's blind spot is more dangerous than its silence.** The orphan report confidently named 160KB of live, dynamically-loaded code as dead. Any analysis that resolves only static imports will do this, and the failure mode is a production outage rather than a test failure.
- **Latent is not the same as observed — say which one you fixed.** The foreign-key PRAGMA race was real in principle and unreproducible in practice. Recording it as "found and fixed, but not the cause" keeps the open flake open, which is where it belongs.
- **When guards keep refusing your fixture, stop hand-building rows.** Four consecutive triggers refused a hand-made economics fixture. Building it through the real services was less work and proved more.
- **Deferral with a stated trigger is a decision; deferral without one is drift.** Three things were deliberately not built this session, each recorded with the condition that would make it buildable.
- **When a guard refuses your fixture, the guard is usually right.** Five separate refusals this session — an ambiguous same-second observation, two competing proposals, a plan without Assisting, shadowing without Understanding, a weak intake key — were every one of them the system working. The fixture changed each time; no guard did.
- **A cast is a promise, not a check.** `agentName as AgentName` on a database row type-checks and validates nothing. Two of three dynamic loaders were secured by a type annotation that does not exist at runtime.
- **Verifying the thing you changed cannot see the thing you didn't.** The whole point of `verifyDiffScope`: every other check passes while the repository is unauthorised.
- **Being ready to learn beats continuing to look.** After nine full runs and twenty-five saturated ones, the honest move on the intermittent was forensics readiness, not more guessing.
- **A credential is an authority surface.** Whenever a route is added behind an existing token, ask what ELSE that token already opens. One secret authenticated posting numbers, raising work, and declaring that an effect succeeded — and the third walked straight through the guard built to stop exactly that.
- **Reading a subsystem's surfaces side by side beats extending it.** Two more companies through the ladder confirmed the generalization and found nothing. Stopping to reassess found a real defect within the hour.
- **Gate on reach, not on rendering.** "No secret is printed" passes right up until somebody prints one. A row that never arrives has nothing to print.
- **Commit before mutation-testing.** A `git checkout` to revert a mutant silently reverted real edits in the same file, and left mutants standing in the untracked ones. Second time this has happened; the fix is to commit first, not to be more careful.
- **A word boundary is not a boundary once you fold case.** `heatingHint` lowercases to `heatinghint`, and `\bheating\b` cannot see it. Two gates read as if they checked something they did not.
- **Read a subsystem's surfaces beside each other; do not extend it.** Nine reads, seven real defects, and none of them would have surfaced by building the next feature. Two more unfamiliar companies through the ladder confirmed the generalization and found nothing.
- **Ask what one surface assumes about another.** Every finding was an assumption that used to be true: one credential meant one consequence, CI's job matched `npm run check`, a detector saw every consequential call, a write chain implied someone could see the result.
- **A detector's blind spot is a claim you are making without evidence.** "0 direct effects" was true of what the regex could see and false of the codebase. The inventory read as reassurance for as long as nobody checked what it could not match.
- **A write chain is half a chain.** Four surfaces were unreachable by a human being while every write link had a production caller. Data moving is not a person seeing.
- **`unresolved` becomes permanent unless something makes it fail.** Four untraced consequential effects sat for a long time because the audit counted them instead of refusing them.
