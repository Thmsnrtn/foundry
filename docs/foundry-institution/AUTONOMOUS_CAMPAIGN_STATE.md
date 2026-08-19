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
- **Migrations:** 202 files, highest **166**. Ordering gated. Snapshot current.
- **Validation:** full suite green — **257 files / 2,252 tests**. `npm run check`
  green, and it now runs every gate. CI runs on this branch for the first time.
- **Ratchets:** unguarded mutating routes **114** (population corrected from a
  quarter of the surface — see below); fabricated test schemas **13**;
  writer-less tables **0**; SELECT drift **0**; fabricated test schemas **4** (was 13).

## Active work

None in flight. Last tranche closed and pushed at `0f62fb8`.

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

1. **Two disagreeing answers to "what needs you".** The Letter's headline card
   reads the `decisions` table's highest-gate pending row; the institution's
   own NEEDS_YOU list is computed independently and rendered below it. Nothing
   reconciles them, and `strategic_decisions_log` is a third founder-decision
   store. A page that answers its own central question twice, differently, is
   false institutional truth on the surface the founder reads first.
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
6. **The rest of the outcome loop.** Five more predicates are written and read
   by nothing (`shadow_expectation`, `later_reality_comparison`,
   `development_shadow_comparison`, `development_change_outcome`, and
   `shadow_comparison` outside a frozen benchmark). The authority request is
   closed; the others are not.

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
