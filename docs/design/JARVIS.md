# The Portfolio-Operator Jarvis — Phase 0 Audit + Phase 1 Proposal

**Date:** 2026-07-13 · **Thesis applied:** a real Jarvis is a
reliability-and-judgment system wrapped around capable models — persistent
memory, governed action, an independent verifier, and proactivity that
defaults to silence. **Audit rule honored:** every claim below cites live
code, and the verdict up front is that Foundry is unusually far along —
most Jarvis layers exist and are battle-tested; the gaps are specific and
narrow, not architectural.

---

## PHASE 0 — What exists vs. what's missing, layer by layer

### 1. Perception / context — STRONG, one blind spot

| Signal class | Exists | Where |
|---|---|---|
| Business telemetry | ✅ | `metric_snapshots` (MRR, churn, signups, activation, NPS…), `funnel_events`; public `/ingest/:token` (Zod-hardened 2026-07-13); integration sync (`services/integrations/sync.ts`) |
| Customer-level | ✅ | `customers` (health, churn risk, champions), `customer_events`, `services/customers/intelligence.ts` |
| Qualitative / multi-modal | ✅ | Call transcripts via Fathom/Fireflies webhooks (`routes/api/webhooks/transcripts.ts`), competitor job signals, time-allocation logs (`signals-multimodal.ts`) |
| **Operator state** | ✅ | `services/wellbeing/pulse.ts` — decision load vs 4-week average, late-night resolution share, rejection streaks → `steady/strained/overloaded` |
| Peer / network | ✅ | `network_benchmarks`, radar (`services/network/radar.ts`), anonymized `decision_patterns` |
| System's own actions | ✅ | `audit_log` (gateway-tagged), `action_executions`, agent runs |
| External personal feeds (calendar, inbox, screen) | ❌ | Not built — but `/connections` (Hands H1) is the ingestion path: any MCP server, grant-governed. Deliberately deferred; see gaps. |

### 2. Memory — DEEP but per-product; no operator-level spine

- **Belief ledger:** `decision_premises` — every decision carries falsifiable
  premises, auto-checked daily, with grace windows (`effective_at`, mig 093).
  This is temporal memory with *built-in truth maintenance* — rare and valuable.
- **Knowledge graph:** `services/graph/engine.ts` — typed entities
  (customer/competitor/decision/stressor/metric/feature/channel/cohort/
  experiment), relationships with weight + evidence, multi-hop
  `queryNeighborhood`, `discoverCausalChains`. Tables `graph_entities` /
  relationships exist. **Scoped per product.**
- **Curated identity:** Product DNA (`product_dna` — ICP, positioning,
  what-we-are-not, voice) = admission-controlled memory a human vets.
- **Preferences:** `founders.preferences` (fluency, digest_time), autopilot
  policies per category, envelopes per scope.
- **Institutional history:** decisions, outcomes, Red Team record, trust
  ledger, `/memory` surfaces (search, ask, counterfactuals).
- **Missing:** nothing models the OPERATOR's world *across* products —
  the graph engine has no founder-scoped entities (people, commitments,
  external relationships) and no cross-product retrieval.

### 3. Cognition / orchestration — RICH

12 SCP agents (`services/scp/agents/base.ts`) with scheduler + debates;
Red Team council (adversarial pre-mortem, vindication tracking); Ghost
(seeded Monte-Carlo on real history); four governed departments
(`services/departments/` — success, marketing, product, outreach); `/talk`
institution chat where conversation IS capture; MCP loop-tools (the
company's judgment as tools for external clients). **Control-plane
primitives:** FleetObservatory (`services/fleet/observatory.ts`), Fleet
Triage (`/portfolio`, signal-sorted), cross-company insight reader
(`services/fleet/insights.ts`, shipped 2026-07-13).

### 4. Action / effectors — GOVERNED, reversibility explicit

Single gateway path `services/outbound/gateway.ts` `invoke()`: kill-switch,
classification, budget, **idempotency**, audit. Effectors: email/Slack/
Linear/webhook + `mcp_tool` = ANY founder-connected MCP server, licensed by
grants (tool-scoped, call-capped, expiring, revocable — mig 091), bounded by
envelopes (weekly caps, mig 092), stopped cold by reserved powers
(`services/outbound/reserved.ts`). Reversibility: autopilot acts are
gate-≤1 with 12h grace + 24h undo; an undo demotes the category.

### 5. Governance — THE STANDOUT; the directive's tier model already ships

The required Observe → Suggest → Act-and-confirm → Autonomous maps 1:1 onto
the shipped trust ladder (`services/autopilot/policy.ts`): **shadow**
(records what it WOULD do — the audit shows it) → **suggest** (drafts into
the approval queue) → **act** (founder's explicit grant; 12h grace + 24h
undo = act-and-confirm; gate-≤1 only = hard-capped blast radius). Promotion
is EARNED on measured agreement (10 clean cycles, quality floor);
enforcement is in SQL policy checks, not prompts. Plus: Gates 0–4 by
stakes, per-product AI cost ceilings, panic stop, full audit log
("why did you do that?" = `audit_log` + premises + Red Team record).

### Gap analysis — what actually stands between this and a Jarvis

1. **No single cross-product attention surface.** `composeLetter(productId)`
   is per-product: a 4-product founder gets 4 letters and must self-rank.
   Fleet Triage sorts by Signal but isn't the daily artifact. The Jarvis
   moment — "here is the ONE thing across your world" — doesn't exist.
2. **No interruption-policy layer.** Channels exist (silent audit log,
   Letter line, in-app notification, push `services/notifications/push.ts`,
   email) and wellbeing pacing exists (`pulse.ts` explicitly says "later:
   briefing pacing"), but nothing chooses the *quietest sufficient channel*
   per event. Detection and delivery are entangled in each job.
3. **No independent verifier on composed output/actions.** Truth engine
   exists (`services/truth/engine.ts`, claim-vs-source, in CI) and premises
   verify beliefs post-hoc; Red Team contests decisions pre-hoc. But nothing
   independently checks a consequential artifact/action against explicit
   success criteria at runtime before it reaches the founder or the world.
4. **No operator-scoped memory.** The graph engine is product-scoped;
   preferences are one JSON blob. What the founder cares about, ignores,
   acts on — never captured as admission-controlled memory that improves
   ranking.
5. **No durable multi-step task runner** (single-shot actions + crons only).
   Real, but deferred: nothing in the first slice needs it.

---

## PHASE 1 — Proposed first slice: **“One Letter” — the portfolio brief with a verifier and an interruption policy**

**The capability:** every morning (and on-demand via chat/MCP), the founder
gets ONE artifact spanning every product: the single ranked "needs you"
across the fleet, what ran everywhere, what was learned, and how trust
moved — delivered through the quietest sufficient channel, every factual
line independently verified against the ledgers before it ships, and the
founder's reactions captured as operator memory that improves tomorrow's
ranking.

**Why this slice:** it is the literal Jarvis job description for a
portfolio operator ("surface what needs attention across all products"),
it directly serves the finish-line mandate (the dogfood exit criterion is
"Thomas operates AcreOS primarily through the briefing + inbox" — this IS
that surface, made fleet-wide), and it is ~90% reuse.

**Reuses (no rewrites):** `composeLetter(productId, fluency)` per product ·
Signal + gates + deadlines for ranking · FleetObservatory + fleet insights ·
radar warnings · wellbeing pulse (pacing input) · notifications + push +
Resend (channels) · truth-engine verification discipline · `/talk` + MCP
`foundry_letter` (on-demand delivery) · fluency (voice) · audit log.

**Net-new (small, each with tests):**
1. `services/letter/fleet.ts` — compose per-product letters, rank the
   cross-fleet "needs you" (gate × signal-risk × deadline × staleness),
   emit ONE FleetLetter. (~1 day)
2. `services/ux/interruption.ts` — the policy: event importance × operator
   pulse × preferences → channel ∈ {log, letter, notification, push}.
   Detection stays in jobs; THIS owns delivery. Default: quietest
   sufficient. Strained founder ⇒ non-critical drops a tier. (~1 day)
3. `services/letter/verifier.ts` — the independent pass: every factual
   line in the composed FleetLetter must trace to a ledger row (decision,
   execution, premise, radar warning) fetched FRESH by the verifier, not
   trusted from the composer. A line that fails verification is dropped
   and logged as a defect. Runs before any delivery. (~1 day)
4. Operator memory seed — `operator_attention` table: which lines the
   founder opened/acted/ignored (admission control: only explicit
   reactions are stored, never inferred noise). Ranking reads it.
   This seeds the founder-scoped memory spine the graph engine will
   later join. (~1 day)

**Autonomy tier at launch:** Observe/Suggest only (the letter suggests; it
acts through nothing new). Acting across products stays with the existing
trust ladder — no new effectors in this slice.

**Deferred, with revisit triggers:** operator world-graph beyond attention
memory (trigger: One Letter shipped + 2 weeks of attention data) ·
calendar/inbox perception via Connections (trigger: Thomas connects one) ·
durable task runner (trigger: first multi-step department action) · fleet
verifier on *actions* (trigger: first act-tier cross-product effector).

**Build order:** fleet composer → verifier → interruption policy →
attention memory → wire to morning job + `/talk` + MCP. Working checkpoint
after each; gates green before each merge.

---

## SHIPPED — 2026-07-13 (same session as the go)

All four net-new pieces landed, gated, tested (8-case suite):
- `services/letter/fleet.ts` — one letter across the fleet; needs-you ranked
  gate × risk × deadline × attention memory, provenance-carrying.
- `services/letter/verifier.ts` — the independent pass: fresh re-reads per
  item; drops resolved/tampered/cross-tenant/gate-mismatched items and
  refuses stale compositions whole; every drop logged to audit_log
  ('letter:verifier'), so "why didn't you show me X?" is queryable.
- `services/ux/interruption.ts` — log < letter < notification < push;
  strain quiets non-critical (with an action-needed floor at the letter);
  critical cuts through strain; the founder's explicit `max_channel`
  ceiling beats everything.
- `operator_attention` (mig 096) + `recordAttention` — explicit reactions
  only, ownership-checked on write, ranking adjustment bounded ±5.
- Wiring: `/letter` renders the verified fleet letter for multi-product
  founders (single-product keeps the classic letter); Decide/Later capture
  reactions; daily `fleet_letter_notify` job (07:30) composes → verifies →
  delivers through the policy. MCP `foundry_letter` unchanged (per-product,
  technical voice) — fleet MCP tool is a deferred follow-up.

**Deferred triggers now armed:** operator world-graph (2 weeks of attention
data), calendar/inbox perception (first founder-connected MCP feed),
durable task runner (first multi-step department action), action verifier
(first act-tier cross-product effector).
