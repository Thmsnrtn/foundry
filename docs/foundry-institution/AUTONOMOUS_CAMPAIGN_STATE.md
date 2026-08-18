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
- **Migrations:** through **164**. Schema snapshot current.
- **Validation:** full suite green — **250 files / 2,186 tests**. `npm run check`
  green; all ratchets hold.
- **Ratchets:** unguarded mutating routes **114** (population corrected from a
  quarter of the surface — see below); fabricated test schemas **13**;
  writer-less tables **0**; SELECT drift **0**.

## Active work

None in flight. Last tranche closed and pushed at `d777b05`.

## What the last tranche established

The lens was *the system has no observation of X, so the system asserts X does
not exist* — one defect in five places, one of them a gate.

- **Erasure was incomplete and the classification could not have known.** A
  data-shaped proof replaced the plan-shaped one: seed every table carrying a
  product or founder id, erase, then sweep every column of every table. Twelve
  founder-scoped tables survived an *account* erasure untouched, because
  `FOUNDER_SCOPED` explained why they survive erasing one of two companies and
  nobody had asked the other half. `ai_daily_spend` carried both ids under
  `scope_id` while classified as naming nobody.
- **Identity had been standing in for purpose** in the erasure write exemption:
  it opened the whole API surface on the reasoning that the founder must be
  able to change their mind, but the write that changes their mind is on a
  surface that middleware never guards.
- **Two bounded queues selected work they could not do,** so five decisions
  from non-operating companies occupied the red-team window permanently.
- **`check-route-guards` scanned one directory of four** and printed its count
  as a statement about the system. True figure 114, baseline corrected,
  exclusions now tested in both directions.
- **Two writers per investor document,** each rendering the other's rows as an
  empty page. SCP is canonical — the navigation points at it and at the other
  from nowhere.

## Highest-value current opportunities

Provisional, recomputed each cycle, ranked by §4 of `DEVELOPMENT_INSTITUTION.md`.
Not a backlog — if something better is found, this list loses.

1. **114 unguarded mutating routes**, now visible for the first time. Most are
   ordinary company work an active member should be able to do, and gating them
   all would be the opposite defect. The work is deciding, per route, which
   capability it needs or why it needs none — starting with the ones where the
   company arrives in the request body.
2. **Adapters for the existing intakes.** The shape is proven; breadth is
   missing, and the owner's pilot decision gates on it. Prefer a source a real
   responsibility demands over a vendor checklist.
3. **Three separate fundraising-readiness implementations** writing three
   tables (`fundraise_readiness`, `fundraising_scores`, and a reader of
   `funding_readiness`). Same duplicate-truth shape as the investor documents,
   not yet resolved.
4. **Seam-reading yield is still positive but narrowing** — the last tranche's
   best finds came from turning instruments on themselves rather than from
   reading further subsystem pairs. Watch for the mode change.
5. More effect kinds, when a real responsibility demands one. Each is a
   migration, deliberately.

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
