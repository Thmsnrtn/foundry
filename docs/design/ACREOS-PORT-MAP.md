# AcreOS → Foundry Autopilot Port Map

**Source:** structured sweep of `thmsnrtn/acreos` @ ec8cd72 (2026-07-14).
AcreOS runs a shipped, tested Jarvis autopilot ("Solene") on a Foundry-like
kernel — much of it explicitly labeled `KERNEL (Foundry-reusable)`. This maps
its advanced primitives to Foundry, with **triggers** so we port by need, not
by envy (finish-line self-check #4: no fleet-scale machinery for a zero-
customer product).

## Second sweep (AcreOS @ 0aeb7d5, 2026-07-14) — the Horizon/Jarvis/Pax waves

AcreOS split its autopilot into **two named brains on a strict data boundary**
(`docs/company/three-level-boundary.md`, `pax-jarvis.md`): **Solene** =
platform chief-of-staff (sees tenants as aggregates only) and **Pax** =
per-customer copilot. Governing formula: **autonomy = min(customer setting,
platform cap, earned trust)**. This is the architecture Foundry was missing a
name for (operator-pack = Solene; departments = Pax).

### Ported 2026-07-14 (the Protective Wrapper — see PROTECTIVE-WRAPPER.md)
- ✅ **Platform cap** (`autopilot/platform-cap.ts`) — the operator ceiling;
  autonomy = min(setting, cap, trust). Money caps at shadow, outreach at
  suggest. Departments route through `getEffectiveMode`.
- ✅ **Consent ledger** (mig 098, `autopilot/consent.ts`) — recorded, versioned
  acknowledgment when granting `act`; the liability audit's enforceability fix,
  scoped to the highest-risk moment. No autonomous act without live consent
  (belt beyond the policy row).
- ✅ **Per-action attribution** — autonomous executions write a disclosed-agent
  trail ("acted on the founder's behalf under consent X, disclosure Y").
- ✅ **Enforced Level-1/2 data boundary** — operator pack is structurally
  aggregate-only (COUNT/SUM), guarded by a source + behavioral test that no
  customer PII reaches an operator line.

### Next wave (highest-value, each shipped+tested in AcreOS)
- **Outcome ledger** (`outcomeLedger.ts`): decisions carry a PREDICTION scored
  against reality at 30/90 days — machine-checkable predictions grade
  themselves; judgment calls raise one phone-answerable card. Foundry's
  action-verifier checks immediately; this closes the long-horizon "was it the
  right call?" loop. **Trigger:** dogfood generates ~30 resolved decisions.
- **Promotion as a founder decision** (`shadowAgreement.ts`): reaching the
  clean-cycle threshold raises a promotion CARD backed by shadow-agreement
  evidence rather than auto-promoting — "no agent expands its own authority."
  Foundry currently auto-promotes shadow→suggest. **Trigger:** next autopilot
  hardening pass (pairs with the consent ledger — same explicit-grant theme).
- **EV loop** (`tokenEconomyScorer.ts`): per-dispatch expected-value scoring +
  cognition ROI in real recovered dollars + a graduated pre-cap throttle.
  Turns the envelope from a cap into an optimization signal. **Trigger:**
  real AI-spend + recovered-revenue data exists (dogfood).
- **Letter reply → witnessed confirm → precedent** (`letterReply.ts`): the
  founder replies to the Letter in plain language; parsed to ruling/directive/
  question, shown back as a one-tap confirm, nothing stored until confirmed.
  Makes the Letter bidirectional. **Trigger:** conversational-presence axis
  (JARVIS.md) — pairs with the /talk fast path already shipped.
- **Interruption budget-gate + Class-C-is-a-defect** (`founderInterruptArbiter.ts`):
  a weekly founder-decision budget as a hard gate, and treating a Class-C
  interrupt's arrival as a defect signal that earned autonomy should have
  handled. Strengthens Foundry's existing interruption policy. **Trigger:**
  when interrupt volume is real enough to tune.
- **Read-only dispatch lane + doctrine-as-memory** (`connectionsSweep.ts`):
  structurally read-only self-inspection (toolset-strip + executor
  fail-closed) + the governance corpus as first-class memory with a weekly
  "what contradicts doctrine / what did I forget" sweep. **Trigger:** the
  embedding-memory infra decision (already infra-gated below).

## Ported first session (2026-07-13)
- ✅ **SSRF guard** (`services/outbound/ssrf.ts`, from
  `server/middleware/fileUploadSecurity.ts`) — launch-critical. Foundry made
  outbound HTTP to founder-supplied URLs (MCP servers, custom_webhook) with
  zero private-range/metadata defense. Now every such call passes
  `assertUrlSafe` (regex + DNS-resolution rebinding defense) at call time.
- ✅ **Self-audit deference detector** (`services/autopilot/self-audit.ts`,
  from `server/services/solene/selfAudit.ts`) — THE most on-thesis port:
  scans Foundry's own founder-facing output for permission-seeking /
  menu-handing when it should act or recommend, surfaces the drift in the
  operator letter. Operationalizes finish-line self-check #7 as code.
- ✅ **Calibration scoring** (`services/autopilot/calibration.ts`, from
  `confidenceObservations.ts`) — the trust ladder measured agreement;
  calibration measures truthfulness-of-confidence (do the acts pass
  verification, do the beliefs hold?). An overconfident category is a
  promotion HOLD, however high its agreement. Reuses the action-verifier
  record + premise ledger. Surfaces in Controls.

## Sequenced ports (each with a trigger)

### Next when there's real outcome data (dogfood week ~1)
- **Learned gates / learned policy** (`autopilot/learnedGates.ts`,
  `learnedPolicy.ts`, `policyInducer.ts`): replace hand-typed thresholds
  (PROMOTION_THRESHOLD=10, QUALITY_FLOOR=0.6) with self-calibrating ones
  induced from real (signal→outcome) history. **Trigger:** ≥1 category with
  ≥30 resolved outcomes on the operator instance. Premature now — nothing to
  learn from.

### Next when the operator wants a live cockpit (dogfood week ~2)
- **The Bridge command deck** (`client/src/pages/founder/bridge.tsx` +
  `routes-founder-bridge.ts`): fused chat + modular telemetry, context-aware
  embedded agent ("this MRR" resolves to on-screen state). Foundry has the
  Letter (daily artifact) + /talk (chat); the Bridge fuses them into one live
  deck. **Trigger:** Thomas asks for a live console, or the Letter proves
  insufficient during dogfood. Maps onto the deferred "conversational
  presence" axis in JARVIS.md.

### Next when autonomy needs verifiable receipts (before first external act-tier grant)
- **ProofReceipts + witness grants** (`autopilot/proofReceipt.ts`,
  `witnessGrant.ts`): tamper-evident hashable receipt per witnessed send
  (what / on-whose-behalf / under-whose-authority / under-which-constitution +
  a self-verifying hash). Foundry has grants + audit; ProofReceipts make each
  autonomous act independently verifiable — the trust-factory artifact.
  **Trigger:** first customer grants an act-tier capability (the record needs
  to be provable to a third party, not just auditable by the owner).

### Next when a department needs projects, not reflexes
- **Durable dispatch + independent-reviewer + self-debug**
  (`services/solene/dispatchQueue.ts`, `codeReviewQueue.ts`, `selfDebug.ts`,
  `agentIdentity.ts`): a Postgres-backed queue (atomic claim), every
  code-producing dispatch auto-reviewed by a sibling before landing, a flagged
  verdict calls the original agent back to self-repair, and per-role identity
  carries "what Iris-on-Monday decided" into Tuesday. This is Foundry's
  deferred "durable missions" axis, done well. **Trigger:** first multi-step
  department action (already the armed trigger in JARVIS.md). Note the infra
  gap: AcreOS is Postgres; Foundry is Turso/libSQL — the queue needs a
  libSQL-native claim (or the job-lock we already have, generalized).

### The big one — port last, when the value is proven
- **Executive causal world-model** (`autopilot/worldModel.ts`,
  `contextualForecast.ts`, `proactiveForecast.ts`): a self-revising causal
  graph (variables + edges) reasoned over by *simulating interventions*
  (`queryIntervention` forward-propagates a lever change along edges),
  generating the action space from consequence rather than from a catalog of
  facts. This is the highest-ceiling borrow and the biggest surface. Foundry's
  premise ledger + Ghost simulator are the seeds. **Trigger:** the operator
  world-graph (deferred in JARVIS.md, unlocks at 2 weeks of attention data)
  is live AND a department needs to reason about second-order effects. Build
  the graph first; add intervention simulation second.

### Infra-gated (needs Postgres/pgvector)
- **Embedding memory / second-brain** (`solene-embeddings.ts` pgvector +
  Voyage, `learningLoop.ts`, `memoryRetrieval.ts`, `memoryFileStore.ts`):
  RAG over the operator's own decision/audit history, past-correction recall
  into prompts, and a CLI↔app shared memory-file layer with SHA-256 drift
  detection. Directly serves the "second brain" the founder's screenshots
  gesture at (a queryable graph over one's own notes/history). **Trigger:**
  Foundry adopts a vector store (or a libSQL-native embedding table), which is
  itself gated on the world-graph proving valuable. Until then, the
  admission-controlled attention memory + knowledge-graph engine cover the
  intent at lower cost.

## Deliberately NOT porting
- **Oz** (`oz/agent.acreos.yaml`) — an external cloud coding-agent that ships
  PRs to the repo. That's a dev-tooling choice for the operator, not a product
  capability; Foundry's remediation-PR machinery already covers self-patch.
- **Sovereign-protocol self-evolution engine** — Day-1 stubs in both repos;
  valuable as a *design* for versioning departments, not as code to lift.
- **Immune system / self-patch / dependency-audit** — Foundry's ratchets +
  truth:audit + kernel-boundary already hold this line for a pre-revenue
  product; revisit only if dependency churn becomes a real cost.

## Principle
Every port must land as an extension of an existing Foundry system on the same
governance (trust ladder, gateway, audit, premises), never a parallel stack.
AcreOS proves these work at scale; Foundry adopts them at its own pace.
