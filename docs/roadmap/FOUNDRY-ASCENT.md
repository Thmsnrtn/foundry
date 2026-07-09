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

### Next
- Phase 3 — Ghost Company (B3): counterfactual simulation on the decision
  chamber (adapt AcreOS `portfolioOptimizer` Monte-Carlo technique).
- A3 — truth-engine (claim-vs-source verification for briefings) + eval gate.
- Phase 4 — Network Nervous System (B4) + Human Layer (B5).
- Phase 5 — Second Self (B6, Trust Law pricing) + Overnight Operator (B7).
