# Foundry — the Ascent program

Bringing Foundry to AcreOS-grade development **and** building the six
game-changing evolutions, as one fused program. This is a multi-phase effort
that spans many work sessions; each phase ships as a coherent, green, merged
increment. This doc is the map. Progress is logged at the bottom.

## Honest gap analysis (Foundry vs AcreOS)

AcreOS is a genius-level, feature-complete industry platform — the product of a
long, intense build:

| Dimension | AcreOS | Foundry (today) |
|---|---|---|
| Schema | 234 tables, 10,232-line **typed Drizzle** schema | ~245 tables, **raw SQL strings** (source of the 55-site drift class) |
| Backend | Express, 166 services, 95+ route files | Hono, server-rendered HTML, ~40 services |
| Frontend | React 18 SPA + PWA | Server-rendered `hono/html` |
| Platforms | Web, iOS + Android (Capacitor), Desktop (Tauri) | Web only |
| Tests | 1,658 — unit/integration/e2e/a11y/chaos/security/prompt-injection/eval | ~785 unit + a walkthrough sim |
| Guardrails | 14+ custom architectural **lint ratchets** | schema-drift checkers (added this session) |
| ML | Custom TypeScript gradient boosting + Python retrain | LLM calls only |
| Real-time | WebSockets + Redis pub/sub | none |
| Moats | data (valuation model), network (marketplace), automation | agent intelligence + wisdom network (early) |

The gap is real and large. But Foundry has two things going for it: a sound,
now-hardened core, and a **sharper product thesis** (an autonomous exec team for
solo founders). We don't clone AcreOS's *features* — we transfer its
*engineering techniques* and use them to build Foundry's *own* six evolutions.

## Two tracks, fused

### Track A — Engineering maturity (AcreOS-grade foundation)

- **A1 · Typed schema kernel.** Schema-as-code + typed row types + typed query
  helpers. Kills the column/table-drift class at compile time (the Drizzle
  benefit) without a risky big-bang ORM migration — adopt incrementally,
  new subsystems first. *This is the single highest-leverage engineering move.*
- **A2 · Service/route/test triplet + architectural ratchets.** Adopt AcreOS's
  convention (a service, its routes, its tests) and its lint-ratchet *technique*
  (baseline-counted invariants that may only improve) for Foundry's own rules.
- **A3 · Eval gate + truth-engine.** Anti-fabrication grounding for generated
  briefings (AcreOS's `check-no-fabrication` / `audit-public-claims`), and an
  eval gate that blocks prompt-quality regressions.
- **A4 · Real-time + client surface (later).** Ambient/WebSocket layer for the
  Overnight Operator; a focused client surface if/when warranted.

### Track B — The six evolutions (built ON Track A)

Each is a compounding *asset* (appreciates with use), not a screen:

- **B1 · Institutional Memory** — the second brain that never flinches. *(Phase 1)*
- **B2 · Red Team** — an adversary paid to disagree. *(cheap, high-trust)*
- **B3 · Ghost Company** — counterfactual simulation. *(mirrors AcreOS Monte-Carlo portfolioOptimizer)*
- **B4 · Network Nervous System** — collective foresight. *(mirrors AcreOS marketplace/network)*
- **B5 · Human Layer** — the cofounder who keeps you alive.
- **B6 · Second Self** — judgment cloning + graduated delegation. *(the endgame)*
- **B7 · Overnight Operator** — ambient, voice-first, "fewer doors as autopilot grows" (AcreOS's own nav philosophy).

## Phasing

1. **Memory Kernel** (B1 on A1+A2) — establish the typed-schema + service/route/
   test + ratchet pattern *by* shipping the first evolution. ← **in progress**
2. **Red Team** (B2) — adversarial pre-mortem on gate-3/4 decisions.
3. **Truth-engine + eval gate** (A3) — ground the agents' output.
4. **Ghost Company** (B3), **Network foresight** (B4), **Human Layer** (B5).
5. **Second Self** (B6) + **Overnight Operator** (B7).

Full architectural detail transferred from AcreOS lives in the survey dossier
(see EXECUTION-LOG once folded in).

## Progress log

- ✅ **Phase 1 — Memory Kernel (B1) + schema-as-code kernel (A1 seed).** Shipped
  the "second brain that never flinches": decisions capture the *belief* behind
  them as testable premises; a daily job re-checks metric premises against live
  `metric_snapshots`; a falsified belief surfaces as an "expired belief" on the
  Strategic Decisions page ("you bet X believing Y — Y is now false; revisit")
  and notifies the founder. Established the typed schema-as-code pattern
  (`src/db/schema/kernel.ts` `buildInsert`/`buildUpdate` — column typos are now
  compile errors, the Drizzle benefit that prevents this session's whole drift
  class going forward). Files: migration 088, `src/db/schema/{kernel,memory}.ts`,
  `src/services/memory/kernel.ts`, `memory_premise_check` job, Strategic
  Decisions capture + banner + revisit route, `tests/unit/memory-kernel.test.ts`
  (8 cases). 793 tests green.
- **Dossier folded in.** AcreOS transferable-patterns survey confirms the six
  evolutions map ~1:1 to proven AcreOS systems (`institutionalMemory`,
  `agentDebates`/`council`, `portfolioOptimizer` Monte-Carlo, `founderWellbeing`,
  `decisionAutopilot`, the four-door ratchet). Highest-value next engineering
  transfer: port AcreOS's generic **ratchet factory** (`scripts/ratchet.mjs` —
  bidirectional, stale-entry-detecting, JSON-baseline count gates) as Track A2.

- ✅ **The Constitution.** `docs/design/CONSTITUTION.md` — the One Concept
  (institution-in-a-box: one closed decision loop that compounds), the eight
  design laws (Loop, Ledger, Trust, Dissent, Attention, Honesty, Human,
  Compounding), and the key unification: a Red Team objection is an
  ANTI-PREMISE on the same substrate as the Memory Kernel. Every future feature
  must name its loop stage and law.
- ✅ **A2 — Ratchet factory.** Ported AcreOS's bidirectional, self-locking
  count-gate (`scripts/ratchet.mjs` + `scripts/ratchets/*.json`): first three
  invariants (double-quote-now=0, as-any=32, console-in-src=214); wired into
  `check` + CI, plus a `column-drift` CI job for the INSERT/UPDATE checkers.
- ✅ **Phase 2 — Red Team (B2 / Dissent Law).** The adversary paid to disagree:
  gate-3+ decisions get an adversarial pre-mortem (three lenses — downside,
  competitor, capacity; one atomic model call; grounded in real telemetry, no
  fabricated context). Objections are falsifiable anti-premises; overruling one
  records its inverse as a monitored premise (origin='red_team'); telemetry
  falsifying it VINDICATES the review — dissent with a track record, shown in
  the decision chamber ("Red Team record here: N vindicated…"). Files:
  migration 089, `src/db/schema/redteam.ts`, `src/services/redteam/council.ts`,
  `red_team_sweep` job (2h, cost-capped), chamber UI + summon route + overrule
  hook, `tests/unit/red-team.test.ts` (full loop, mocked model). Also fixed a
  real pre-existing test flake (nanoid `--` truncating raw SQL via executeRaw's
  comment-stripper). 798 tests green.

- ✅ **Phase 3 — Ghost Company (B3).** "Fork reality" in the decision chamber:
  1,000-run seeded Monte Carlo (mulberry32 + Box-Muller, seed = decision id) of
  each option's 90-day MRR path on the company's OWN growth history; abstains
  below 4 snapshots (Honesty Law); the model contributes only labeled
  conservative growth-delta priors; full assumptions persisted (Ledger Law).
  Lands in `scenario_models` → the chamber's existing Scenarios stage renders
  the bands, incl. a "Ghost (do nothing)" fork. `ghost/simulator.ts`, POST
  `/decisions/:id/ghost`, 5 tests (incl. bit-for-bit determinism). 803 green.
- ✅ **A3 — Truth engine.** Deterministic claim-vs-source verification
  (`services/truth/engine.ts`): every significant token — all numbers, quoted
  phrases, meaningful words — must match a NAMED source; strict on numbers,
  forgiving on phrasing. `scripts/audit-public-claims.mjs` verifies the landing
  page's 6 factual claims against CODE-DERIVED sources (tierPricing, TRIAL_
  PERIOD_DAYS, the real agent-file roster, the founding-slot math) and is wired
  into `npm run check` — marketing copy can no longer drift from the product.
  809 tests green.

- ✅ **Phase 4b — Human Layer seed (B5 / Human Law).** The founder pulse
  (`services/wellbeing/pulse.ts`): strain computed ONLY from existing decision
  telemetry — load vs their own trailing 4-week average, late-night resolution
  share (23:00–05:00), rejection rate. Two independent factors = 'overloaded';
  the weekly job (Friday 9:00, never at night) sends one kind, numbers-shown
  observation ("you resolved 8 decisions this week — 2.3× your usual…
  the queue will keep"). Steady weeks stay silent (Attention Law). 812 green.

- ✅ **Phase 5 — Network radar (B4) + Trust ledger (B6) + The Letter (B7).**
  The loop closes end to end:
  - **B4 radar** (`network/radar.ts` + daily `network_radar` job): places each
    product in its peer cell (stage × MRR bracket) and warns when a vital sits
    in the danger tail — churn above peer p75, activation/retention/NPS below
    p25 — with the percentile evidence shown. Abstains below 5 peers.
  - **B6 trust ledger** (`trust/ledger.ts`): autonomy PRICED, not configured —
    per-category record of founder-approved decisions with positive measured
    outcomes; ≥80% on ≥8 decisions earns a graduation PROPOSAL (never silently
    applied, always reversible, evidence shown).
  - **B7 The Letter** (`letter/composer.ts` + `/letter`): one deterministic
    daily artifact — what I handled, the ONE thing that needs you, what I
    learned (expired beliefs + radar), how trust moved (proposals + Red Team
    record). No model call: free, instant, cannot hallucinate. A quiet day says
    "Nothing needs you. That's the goal." And the **route-count ratchet**
    (baseline 88, may only shrink) makes the Attention Law structural.
  818 tests green.

**Track B is now seeded end to end: all seven evolutions live.** Remaining arcs
are deepening, not scaffolding: radar trend-detection (trajectory divergence,
not just level), trust-ledger → actual gate application UI, The Letter as the
default landing surface + voice delivery, A4 real-time, and the long AcreOS-
parity items (SPA/mobile) if desired.

- ✅ **Phase 6 — The Autopilot (B6 realized; AcreOS convergence).** Studied
  AcreOS's mature governed-autonomy kernel (domainAutonomy/act/experienceLog)
  and converged Foundry onto it: per-category trust ladder (shadow → suggest →
  act) with EARNED promotion (10 clean cycles from real outcome_valence, quality
  hold at <60% positive), founder-consent boundary into 'act', guarded act path
  (gate ≤1 · 12h grace · kill switch · 24h undo), anomaly circuit-breaker,
  undo-as-trust-signal demotion, panic stop, and the /autopilot Controls door
  (plain-language dials + evidence, behind the Letter mount — ratchet honored).
  Second Self actions land in The Letter. Full comparison + deliberate
  differences: docs/design/AUTOPILOT.md. Migration 090,
  services/autopilot/policy.ts, autopilot_tick job (4h), undo route, 10
  lifecycle tests. 837 green.

- ✅ **Phase 7 — the Trust Plane (MCP both directions + chat + kernel seed).**
  1. **Remote MCP server** (`api/v1/mcp.ts` + `mcp/loop-tools.ts`): the
     company's judgment as tools for ANY MCP client — letter, queue, resolve
     (with accountable overruling), record-decision-with-premise, red team,
     fork, expired beliefs, trust. API key fixes the tenant; autopilot modes
     deliberately NOT exposed (consent stays in Controls).
  2. **MCP client through the gateway** (`integration/mcp-client.ts`, migration
     091): any founder-connected MCP server becomes callable, licensed only by
     founder-issued grants (tool-scoped, call-capped, expiring, revocable) and
     routed through the outbound gateway (kill-switch, idempotency, audit) —
     the adapter treadmill ends.
  3. **Institution chat** (`chat/institution.ts`, `/talk`): conversation IS
     capture — stated decisions/beliefs land in the ledger with monitored
     premises; replies carry the trust record; real ledgers in model context.
  4. **Kernel boundary** (`check-kernel-boundary.mjs`, in `check`): Foundry's
     10 kernel dirs verified domain-agnostic (0 pack imports at inception) —
     the extraction option for a shared Foundry/AcreOS autonomy engine is held
     open at zero cost (docs/design/KERNEL.md).
  Phase 5 (economic graph — verified playbooks, calibration-as-signal,
  underwriting) is spec'd above and gated on real network scale. 855 tests
  green; 18 new across the three phases.
- ✅ **The Fluency Law (Constitution Law 9) + full-product sweep.** One product,
  many voices: the app NEVER forks by audience — every founder gets the same
  features, data, and power; only the *voice* adapts. A per-founder fluency dial
  (`plain | balanced | technical`, stored in `founders.preferences`, adjustable
  in Settings, inferred as a default by onboarding path but never overriding an
  explicit choice) drives `services/ux/fluency.ts`: vocabulary translation that
  keeps the technical term visible ("Big decision (gate 3)", "no longer true
  (falsified)"), explainer strips that go silent at technical, humanized rates
  (5% not 0.05 — radar warnings now say "4%" for every voice), and metric
  translation ("customers leaving monthly (churn)"). The structured premise
  dropdowns are GONE for everyone: founders state the belief in their own words
  and `extractPremiseCondition` deterministically parses "churn stays under 5%"
  into a monitored condition (unparseable → honest qualitative premise, still
  recorded). Swept: dashboard, Strategic Decisions (plain-text premise +
  translated expired-belief evidence), decision list + chamber (Red Team /
  Ghost instruments translated, facts identical), The Letter, Controls, /talk,
  briefings, Product DNA. Proof: two-voice tests render the same page at plain
  and technical and assert IDENTICAL facts and actions with different words
  (`tests/unit/fluency.test.ts`, 9 cases). 864 tests green.
- ✅ **Fluency — the last mile.** (1) The Letter composer itself now speaks the
  founder's voice (`composeLetter(productId, fluency)`): "Ran send_email for
  you through gmail" vs "Executed send_email via gmail"; the devil's-advocate
  record vs the Red Team record — identical facts, dialed phrasing; MCP callers
  get 'technical' (terse machine voice). (2) Every expert page gets its
  explainer for free: `navExplain` maps sidebar nav keys → explainers and the
  shared layout renders the strip once (Roster, Debate, Accuracy, Transparency,
  Intelligence, Actions, Scenarios, Investor Hub, Exit, Weekly Brief,
  Multi-Modal, Network, Memory, Competitive, Standing Orders, Ambient, ROI,
  Benchmarks) — pages with in-page strips are deliberately absent so nothing
  doubles. (3) Onboarding speaks universally plain (fluency is unknown until
  the path is chosen) and now *tells* the founder about the voice inference:
  "same product either way — only how Foundry speaks adapts; change it in
  Settings." 866 tests green.

- ✅ **The Hands, phase H1 (Law 10 + design: `docs/design/HANDS.md`).** The
  founder shapes the system's hands. (1) **`/connections`** — connect ANY MCP
  server by URL (token encrypted at rest); grants are tool-scoped, call-capped,
  expiring, instantly revocable, and only issuable for servers actually
  connected; the page shows what Foundry MAY do and what it HAS done (gateway
  audit trail) in one place, fluency-dialed. (2) **`mcp_tool` standing-order
  action** — any granted tool is usable in a founder-authored rule; the call
  rides createExecution→gateway with grant checks intact (proven end-to-end:
  no grant → refused with reason; disconnected server → refused even with a
  live grant). (3) **Five doors** — sidebar leads with Today (the Letter),
  Signal, Decide, Talk, Actions; everything else in collapsible groups
  (Autopilot / Your Team / Company / Investor / System) that auto-open where
  you are; mobile nav matches; ⌘K gained Letter/Talk/Controls/Connections.
  The route-count ratchet forced the constitutional mount (Connections rides
  the autopilot module — mounts may only shrink). Also fixed: /letter,
  /autopilot, /talk had never been registered with auth middleware. The full
  HANDS design (envelopes, reserved powers, departments H2–H5, operator side)
  is specced in docs/design/HANDS.md. 873 tests green.

### Next (specs ready to execute)
- **Phase 4a — Network Nervous System (B4).** Turn `network_benchmarks` +
  `funnel_events` into an early-warning radar: nightly job matches each product
  to its cell (stage × mrr_bracket), detects peers whose trajectory diverged
  N days ahead, emits "2 companies at your coordinate hit a churn wall 30 days
  ahead of you; here's what the survivor changed" briefing items. Abstain < 5
  peers (already the peer-signal convention).
- **Phase 4b — Human Layer (B5).** `services/wellbeing/pulse.ts`: decision load
  vs trailing average, late-night resolution share (decided_at hour), rejection
  streaks (service exists) → a pacing signal the briefing + notification cadence
  respects (defer non-critical alerts when strained; celebrate milestone runs).
  Adapt AcreOS `founderWellbeing.ts` ("you've overridden 14 decisions this
  week — 3× average").
- **Phase 5a — Second Self (B6 / Trust Law).** A trust ledger per decision
  category: calibration = agreement rate between agent recommendations and
  (founder choices × later outcome quality) from `decision_outcomes` +
  `agent_predictions`. Display earned trust in Controls; propose (never силently
  apply) gate reductions when calibration clears a bar; every delegation is
  reversible + logged. The gate system already carries the plumbing.
- **Phase 5b — Overnight Operator (B7 / Attention Law).** The Letter: one daily
  artifact — "what I handled, the one thing that needs you, what I learned, how
  my calibration moved" — built from briefings + gateway executions + trust
  ledger. Add the AcreOS-style route-count ratchet so founder surfaces may only
  consolidate. Voice delivery already exists (audio briefings).
