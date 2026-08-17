# AUTONOMOUS CAMPAIGN STATE

Durable scheduler across context windows. Operational, not a specification and
not a diary — git history is the diary. Keep it short enough to stay true.

---

## Current frontier

- **Branch:** `claude/foundry-autonomous-continuation-0gents`. Never merged to master.
- **Migrations:** through **139**. Schema snapshot current.
- **Validation:** `npm run check` green — **185 files / 1,516 tests**, all 4 ratchets hold.
- **Three companies now cross a governed effect,** not one, and between them
  they use both declared effect kinds and both directions of the outcome loop.
  A groundworks contractor is raised by its own system and reports ACHIEVED; a
  heating firm is raised by its owner and reports FAILED. The kernel did not
  move for either.
- **Credentials are scoped to their purpose** (139). One product-wide secret
  authenticated three intakes with quite different consequences, including the
  outcome ledger. Found by reassessing rather than by continuing down a list.
- **The public API is reachable, and safe to be.** Owner decision. It was
  mounted, authenticated, and unusable — nothing could issue a key. Turning it
  on required fixing three write routes gated by a read scope and an MCP
  transport with no scope check at all.
- **One authenticator for one credential.** `api_keys` had two readers with the
  same exported name; the unmounted one was weaker, and a stale audit doc named
  it as the live one.
- **The whole ladder is generic now.** Four SaaS-shaped bindings were found and removed in sequence, each revealed by the previous one: the observation vocabulary (135), the effect guard (136), the authority-read, and the grantable-capability map. A dance school is carried end to end — owner report → Understood → Shadowing → resolved comparison → exact grant → Assisting → founder-authored notice → governed send → receipt → outcome.
- **The loop closes.** Someone outside can finally say whether an effect achieved what it was for (137), so `outcome_status` can leave `unresolved` by fact rather than staying there by construction. HANDLED now means "it worked", not "it reached a rung".
- **A company's own systems can raise work** (138), so the first rung is no longer fed only by a person.
- **The ladder is no longer SaaS-only.** Independent observation was admissible for twelve hard-coded metrics backed by physical columns, in the service *and* in a database trigger. A company now declares what it counts, in its own words, and the kernel treats it as an opaque named quantity. A boatyard reaches Shadowing in test.
- **Recursive Foundry:** the owner-named schema-snapshot responsibility is carried end to end locally — owner report → Understood → Shadowing → Assisting → governed effect → independent verification. `recursive-institution-v1` reports ordinary on all thirteen dimensions, earned by exercise.
- **Dynamic reachability:** all three agent loaders narrow through one closed vocabulary; a bidirectional gate classifies every loadable module.
- **Economics:** cost attaches to responsibility and capability (migration 134), with measured / counted / unmeasured kept rigorously apart.
- **Operating:** frozen (migration 115). **AcreOS:** deferred by owner.

## Final-state gaps

Ordered by distance from the final state, not by effort.

1. **Senses are still thin, but no longer closed.** Five provider-neutral intakes exist — metrics, company-defined quantities, inbound customer messages, external obligations, and effect outcomes. All are generic in shape; none is domain-specific. What is missing is breadth of ADAPTERS, not more kernel. Each intake's credential is now scoped to its purpose (139), so a sixth needs a purpose added by migration — deliberately.
2. **Capability fabric is still narrow.** Governed email send now serves any capability through two declared effect kinds, plus bounded generated-artifact development. No scheduling, record mutation, publishing, billing operations, or reconciliation.
3. **World model is sparse.** Facts and claims exist; promise / obligation / workflow / dependency / resource / constraint composition does not.
4. **No frontier cognition anywhere**, by design — no consumed task has yet established a baseline that a model would beat.
5. **Unfamiliar-company breadth** is one held-out corpus plus seven hand-authored businesses, three of which are carried through a governed effect end to end. None has needed a kernel change, and the last two were chosen to take different branches rather than repeat one.
6. **Judgment calibration still has no supply.** Effect outcomes are now reportable; JUDGMENT outcomes are a different shape and nothing produces them, so evaluation can still only report `not_yet_observable`. Deliberately unbuilt.
7. **Nothing has met reality.** No real founder, provider, customer, or pilot.

## Ready work

- **Adapters** for the existing intakes — the shape is proven; what is missing
  is breadth, not architecture. The owner's pilot decision gates on this, so it
  is endorsed rather than speculative. Prefer a source a real responsibility
  demands over a vendor checklist.
- More effect kinds, when a real responsibility demands one. Each is a migration, deliberately.
- ~~A second and third unfamiliar company through a governed effect~~ — **DONE**.

## Blocked — needs a design decision, not effort

- **Named-agent retirement.** The twelve live agents are model-driven; the institution is deliberately model-free. They are Class C, not B: cutting them over would LOSE capability rather than preserve it. Blocked on executive-cognition design, itself blocked on a consumed task with a baseline. Do not force it.
- **`challenger` and `synthesizer` are NOT part of that.** They are not agents at all — standalone debate functions reached by static import. Classifying them from the directory nearly justified deleting live code; the gate now checks reachability instead of location.

## Active work

None in flight. Last package closed and pushed.

## Three findings worth not re-learning

- **A credential is an authority surface, and shared ones widen silently.** One
  secret authenticated posting numbers, raising work, AND declaring that an
  effect succeeded. Migration 137 refuses reports from the institution because
  self-declared success is not an outcome layer — and a metrics integration is
  not the institution, so it walked straight through that check. Whenever a
  route is added behind an existing token, ask what ELSE that token already
  opens. Found by reassessing rather than by continuing down the list.

- **47 assertions existed under `src/` where the runner never looked.** Invisible coverage reads exactly like coverage. Two had silently gone stale — one contradicted a security improvement (SEC-10 moved a GitHub token out of the request body), one required a credential the setup deliberately stopped providing. A gate now enforces both directions.
- **The orphan report is only trustworthy after the dynamic loaders are accounted for.** A naive run once named ~160KB of live, dynamically-loaded agents as dead. Seven modules were deleted this session only after checking module path, bare name, config, CI, and docs.

## Blocked — owner

**Nothing.** All five queued decisions are answered; `OWNER_DECISIONS_PENDING.md`
records them as settled. Standing consequences:

- The public API is **live**. Every new v1 route needs a scope a founder can
  actually grant; the bidirectional gate enforces both directions. Transcript
  ingestion is reachable, so real customer call content can arrive — it is
  customer data AND untrusted external content, and is treated as both.

- Support pilot: **hold for adapter breadth.** E4 stays unclaimed.
- Recursive Foundry: the owner performs the **report only, not the grant** —
  Foundry still may not mutate its own repository outside a test. Do not
  simulate the report; do not treat a local run as the deployed one.
- Effect kinds stay **constitutional**. Never add a mechanism that lets them be
  created at runtime, by a company, an integration, or a model. Now gated
  structurally, not just documented.
- `challenger`/`synthesizer` were **already live** — my classification was
  wrong, corrected on evidence.

## Blocked — external

- **Real bounded support pilot (E4).** `support-pilot-readiness-v1` is green and means only *ready to attempt*.
- **Deployed recursive operation.** Requires a genuine owner-authenticated report and grant performed outside the coding environment. Must not be fabricated.
- **Judgment calibration.** Requires real later-outcome evidence reaching the evaluation path.
- **Business outcomes.** Provider acknowledgement is not resolution; `unresolved` is preserved deliberately.

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

## Recently completed

Newest first. Trimmed as it ages — git history is the diary.

- The public API made live on owner decision: scoped, expiring, revocable keys issued from settings; three write routes moved off a read scope; the MCP transport gains a per-tool scope check it never had.
- Call-transcript analysis bounded — the model's answer cannot put a hundred fabricated competitors into the competitive signal.
- One authenticator for one credential; a permissive unmounted duplicate deleted and a backwards audit row corrected.
- Scoped ingest credentials (139); public surfaces stop selecting rows that carry secrets.
- A second and third unfamiliar company through a governed effect, closing the outcome loop in both directions.
- Both kernel-ignorance gates hardened — camelCase was folding the domain word out of existence.
- The owner can open a development expectation — the last non-benchmark DARK module goes live.
- Four owner decisions answered; the effect-kind line made structural.
- `challenger`/`synthesizer` reclassified: already production-reachable via the debate orchestrator.
- Seven proven-dead modules deleted on evidence; as-any ratchet tightened 30 → 29.
- 47 unrun assertions recovered from under `src/`, and a gate against invisible tests.
- External company reports (138) — a company's own systems can raise work, without laundering provenance.
- Effect outcome reports (137) — the loop's last link has a supply; HANDLED means "it worked".
- Governed effect kinds (136) — capability out of the guard; founder-authored notices as the second kind.
- A dance school carried end to end through a governed effect.
- The long-standing intermittent RESOLVED — a 1-in-64 fixture collision, not a system defect.
- Company-defined observation channels (135) — the ladder stops being SaaS-only.
- Dynamic-loader blind spot closed; bidirectional agent classification gate.
- `recursive-institution-v1` reports ordinary, earned by real exercise.
- Owner-named schema-snapshot responsibility carried end to end; `verifyDiffScope` added.
- Institutional cost attribution (migration 134).

## NEXT SESSION START HERE

Bootstrap from disk: verify the branch and clean tree, read this file and
`IMPLEMENTATION_STATE.md`, skim recent git history, then continue without chat
history.

**The last known SaaS-shaped binding in the ladder is gone** (migration 136).
An unfamiliar company can now be recognised, understood, watched, and — with an
exact grant — helped, without a kernel change.

**The kernel work is substantially done.** Five consecutive packages each
removed a SaaS-shaped binding or closed a missing link, and the last of them
found no further binding to remove. The recurring defect shape — a general
mechanism bound to one special case — has been swept from observation,
effects, authority reads, the grant surface, recognition, and outcomes.

**Items 2 and 3 of the previous list are done, and item 3 was the one that
paid.** Carrying two more companies confirmed the generalization and found
nothing — eleven of twelve assertions passed on the first run. Then reassessing
instead of moving to item 1 found a real defect: one credential opening three
intakes, including the outcome ledger. **Reading a subsystem's surfaces
side-by-side beats extending it.**

Next, in order:
1. **Adapters, not architecture.** Now the honest top of the list, and
   owner-endorsed — the pilot decision explicitly gates on adapter breadth.
   Still: prefer a source a real responsibility already demands over a vendor
   checklist, and remember that every new intake needs a purpose in migration
   139's closed set, which is a migration and a review by design.
2. **Keep reassessing.** Two side-by-side reads have now paid: the four intakes
   (one credential, three consequences) and the authority surfaces (two
   authenticators, one weaker, and an audit doc that named them backwards).
   **The founder-facing writes and the scheduler have NOT had that treatment
   yet.** Do those next, one deliberate read each.
3. **Executive cognition remains the genuine frontier** and remains gated on a
   consumed task with a real baseline. It must not be started by sprinkling
   model calls.

Do not build the three deferred systems. Do not unlock Operating. Do not touch
AcreOS.
