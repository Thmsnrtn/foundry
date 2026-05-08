# Foundry V3 — Synthesis From the Real Repo

> Written 2026-05-07 by Claude Opus 4.7 (1M context) with the live repo,
> 95 migrations, 60+ cron jobs, and the full SCP runtime in view.
>
> Companion read to:
> - The V3 chat artifacts (the four-document arc + V3 mega-prompt)
> - The 9 reality-alignment commits (`fe63f3e` → `ccd3942`)
> - `docs/audits/reality-check.md`
> - `docs/audits/99-REALITY-ALIGNMENT-HANDOFF.md`
>
> If this document conflicts with the V3 mega-prompt, this document wins,
> for one reason: I had repo access and the mega-prompt's author did not.

---

## TL;DR

The V3 spec from chat assumes a Foundry that doesn't exist anymore. Foundry
already has a 12-agent SCP runtime with constitution-based evolution, golden
lessons, inter-agent messaging, temporal analysis, debate cycles, prediction
accuracy tracking, and wisdom synthesis — 6,348 lines under
`src/services/scp/` plus 60+ cron jobs. Most of what V3 proposes to *build*
already exists, just under different names and abstractions.

The 9 reality-alignment commits did the hard work of separating the 60% of
Foundry that's shipped from the 40% that's aspirational architecture. That
work was correct. Reading those commits as anxiety-driven scope reduction
would be a misread — they were a forensic audit by Claude Opus 4.6 with
explicit Path A / Path B framing.

**My recommendation is a third path.** Not the V3-as-written rewrite. Not a
strict "ship Path A and freeze." A narrow V3.1 that adds 4-5 high-leverage
disciplines on top of the existing SCP — the disciplines V3's recursion
genuinely earned — while honoring the simplification arc by *not* rebuilding
the parts that already work. Estimated cost: 2-3 weeks of focused work, not
3 months. Reversible. Composes with friendly-alpha launch rather than
blocking it.

The full argument follows.

---

## A. What V3 got right

The V3 chat arc (SOP → AOA → SYNTHESIS → AGENTIC_FOUNDRY → RECURSIVE_FOUNDRY
→ VESPER_V2_AND_RECURSION) is not worthless. It contains genuine architectural
work that current Foundry lacks. The recursion findings are particularly
valuable — they're the bits that survived 24 specialists worth of independent
critique.

Specifically, V3's load-bearing innovations that the current repo does not
have:

1. **North Star + Outcome Tree as first-class schema.** Foundry tracks
   `lifecycle_state`, `risk_state`, `audit_scores`, `signal_events` —
   everything except an explicit per-product 12-month destination that all
   work must trace to. The agents observe and recommend; they do not have a
   defined target to move toward. Sage's role would not be redundant.

2. **Architecture freeze period as enforced discipline.** Ambros's recursion
   finding (the meta-discipline from VESPER_V2_AND_RECURSION §27) is the
   single most important thing in the whole V3 arc. Foundry has no mechanism
   that says "no architectural changes for N days; collect operational data;
   resume after." The 859 audit docs and the v3-v6 cycle are exactly the
   pathology this discipline prevents — endless internal critique without
   enough operational data to ground the next round.

3. **Tool gateway with idempotency, classification, kill-switch.** Atlas's,
   Cipher's, and Forge's recursion findings. Foundry has `audit_log` and
   per-instance rate limiting and the 12-agent system has authority levels
   0/1/2 — but it does not have a single trust boundary through which all
   outbound writes pass with idempotency keys, data classification checks,
   and tool versioning. The current state would not survive 50 tenants. It's
   surviving Thomas's portfolio because Thomas is the only operator.

4. **Voice Fingerprint + Taste Journal.** Lyric's and Vesper's recursion
   findings. Foundry has Beacon (CMO) and Scribe (Content) — but neither has
   a per-product voice signature that makes "in-voice" verifiable, and there
   is no founder-rated artifact corpus that distinguishes "feels right for
   this product" from "feels right generically." This is a real gap; current
   agents will produce competent-but-generic SaaS copy.

5. **Communication budget per customer.** Lighthouse's recursion finding.
   Foundry has Harbor (CS) sending behavioral triggers and the digest system
   sending weekly briefings — but no cross-agent message budget per customer.
   At 5 agents × 1-3 weekly outreach actions × N customers, this becomes
   spam-from-five-voices the moment Foundry serves more than one tenant
   actively.

6. **Recursive critique yield monitoring.** The Round 5 meta-finding from
   VESPER_V2_AND_RECURSION. This is what the v3-v6 cycle needed and didn't
   have. The 9 reality-alignment commits did it manually after the fact;
   building it as a system metric would prevent the next 859-audit-doc cycle.

7. **Anti-canon corpus as forced choice.** Vesper's distinctiveness mechanism.
   Most agentic systems converge on training-distribution medians; explicit
   inversion-consideration is a real defense against that. Foundry's existing
   evolution mechanism (golden lessons + constraint additions) is good but
   does not include this.

8. **Domain expert veto.** Surveyor's recursion finding. Generalist SaaS
   agents giving advice on land investment, astrology, or prediction markets
   without domain authority is exactly the failure mode that produces wrong-
   confident output. Foundry has zero domain-specialist concept.

That's eight load-bearing wins. The rest of V3 — 24 named specialists, 25
new tables, sense/reason/act tier reorganization, parallel `src/services/
specialists/`, full per-tenant-domain-specialist roster — is mostly noise
relative to those eight.

---

## B. What V3 got wrong or redundant

The V3 spec was written by Claude in chat without seeing what exists. The
specific places where V3 overspecs:

**1. The 24-specialist roster duplicates SCP's 12.** SCP already has Atlas
(CTO), Compass (PM), Prism (UX), Beacon (CMO), Scribe (Content), Forge
(Revenue), Harbor (CS), Sentinel (DevOps), Ledger (Finance), Shield (Legal),
Oracle (Analytics), Crucible (QA). V3's roster (Atlas, Sage, Ambros, Forge,
Anvil, Cipher, Vigil, Mariner, Compass, Aurora, Atrium, Vesper, Lyric,
Threshold, Beacon, Conduit, Quill, Herald, Lookout, Aria, Aide, Lighthouse,
Treasury, Ledger) renames most of them and adds ~12 new roles. The new
roles are not all wasted (Ambros, Sage, Mariner are real additions for
governance/strategy/AI engineering). But building 24 in parallel to the
running 12 splits the agent abstraction in two and corrupts both.

**2. Twenty-five new tables overlap heavily with existing schema.** Specific
duplications:
- V3 `customer_profiles` ≈ existing `customer_intelligence` +
  `customer_health_snapshots` + `customers`
- V3 `opportunity_queue` ≈ existing `agent_initiative_queue`
- V3 `specialist_critiques` ≈ existing `agent_messages` +
  `agent_message_threads` + `debate_sessions`
- V3 `specialist_disagreements` ≈ existing `debate_sessions`
- V3 `specialist_reflections` ≈ existing `agent_run_details` +
  `agent_predictions` + `decision_outcomes`
- V3 `team_health_metrics` ≈ existing `agent_accuracy_scores`
- V3 `exemplar_corpus` + `canonical_principles` ≈ existing `agent_wiki_*`
- V3 `competitor_corpus` ≈ existing `competitor_profiles` +
  `competitor_*_tracking` (5 tables)
- V3 `experiments` ≈ existing experiments service + tables
- V3 `data_classifications` — exists informally in `data_residency_settings`
- V3 `freeze_periods` — net new (genuinely missing)
- V3 `north_stars`, `outcome_trees` — net new (genuinely missing)
- V3 `voice_fingerprints`, `taste_journals` — net new (genuinely missing)
- V3 `communication_budgets` — net new
- V3 `idempotency_keys` — exists as `webhook_idempotency` for webhooks; not
  generalized
- V3 `phase_beta_proposals` — net new
- V3 `financial_frame` — partially exists in `cost_events`, `agent_cost_log`,
  monthly ROI rollups

Of 25 V3 tables, only ~8 are genuinely net-new. The other ~17 either
duplicate existing tables or could be folded into existing schemas with
column additions.

**3. Sense/Reason/Act tier reorganization is a code-org refactor with no
operational payoff.** Foundry's existing `src/services/{audit, intelligence,
decisions, scp}` split is already a sense/reason/act split in spirit
(audit + intelligence = sense, decisions/queue + scp/gates = reason,
scp/remediation + outbound + integrations = act). The V3 prompt's directory
restructure would touch every import in the codebase and produce no testable
behavior change. This is exactly the kind of churn the freeze period exists
to prevent.

**4. The multi-tenant framing is wrong for current Foundry.** V3 assumes
AcreOS, Astrum, Kalshi-Genius are *Foundry tenants*. Reading the codebase
and the reality check: **Foundry is a single-founder product** for SaaS
founders running 1-5 of their own products. There is no `organizations`
table. There is no cross-tenant pattern surfacing service. AcreOS being a
Foundry tenant is aspirational positioning, not architecture. V3's
"onboard AcreOS, Astrum, Kalshi-Genius as initial tenants" presupposes a
multi-tenancy that does not exist. The work to make Foundry actually
multi-tenant is itself a 1-2 month project (per `docs/roadmap/documented-
but-not-built.md`, "Multi-Organization Architecture"), and the 9 reality-
alignment commits explicitly walked back this framing on the landing page.

**5. The Vesper v3 brand specialist is overkill for current product
context.** Vesper's role is "Head of Brand for AcreOS." AcreOS is a
land-investment AI tool with a small founding-customer cohort. A full brand
specialist with Voice Fingerprint, Taste Journal, anti-canon, distinctiveness
KPI, and four-gate review (Compass truthfulness + Aria resonance + Sage
positioning + founder approval) for a product that has under 10 users is
governance theater. The brand discipline matters; the specialist abstraction
is too heavy for the scale.

**6. Per-tenant domain specialists (Surveyor, Astra, Edge) have no canon
to be specialists about.** V3 acknowledges this ("placeholder; founder will
fill in over time") — but a placeholder specialist with veto authority is a
mechanism that fires randomly. Either the canon is real and the specialist
is too, or neither is. Building the specialist before the canon inverts
the dependency.

**7. The 90-day freeze period is good; the timing in V3 is wrong.** V3
sets the freeze *after* the 24-specialist build ships. That's the moment
of maximum mismatch between the system and the world. The freeze should
attach to whatever ships next, not to the specific shape V3 specifies.

---

## C. What the 9 reality-alignment commits reveal

I read the commit bodies, not just the titles. They were authored by
Claude Opus 4.6 (1M context). They span 8 documented phases with cross-
references and an explicit recommendation framework. The trajectory is:

- `fe63f3e` (foundational) — evidence-based audit comparing README,
  v6 positioning, and the codebase. Finding: "product is a single-founder
  BI tool with multi-product support, not the multi-company fleet control
  plane the audit docs describe."
- `7dd9b2c`, `c1aaf14`, `cb59dd8`, `cca7e95`, `8a48317` — concrete
  cleanup. README rewritten, audit docs annotated, landing page corrected,
  pricing aligned across surfaces.
- `978a887` — `documented-but-not-built.md` lists 11 specs-without-code
  with effort estimates and operator-decision columns left blank.
- `b0b103a` — narrow positioning launch readiness assessment. Single-product
  flow: fully functional. Multi-product: functional but manual. 3 pre-launch
  actions identified.
- `79a81d4` — Path A (ship what's built) vs Path B (build fleet) handoff
  with explicit recommendation: Path A.
- `ccd3942` — final inventory across branches/stashes/PRs confirms no
  unmerged fleet implementation exists anywhere. Reality check holds.

This is not anxiety. This is forensic discipline. The author was specifically
commissioned to separate shipped reality from documented aspiration, and
that's what they did. The recommendation — friendly alpha to 3-5 founders
under narrow positioning — is the conservative-correct call given the
evidence.

But Thomas's redirect message is also right: "the simplification commits
and the ambition statement may both be true." Path A says *ship now*. The
V3 ambition says *build the operating system that lets the portfolio run
itself*. Both are true. The reality-alignment work doesn't say "abandon
ambition" — it says "stop calling shipped reality something it isn't, and
*then* decide what to build next."

The trap to avoid: reading the 9 commits as a directive to freeze the
codebase. They were a directive to stop *misrepresenting* the codebase.
Continued evolution is fine and good — it just shouldn't be evolution that
re-introduces the same gap between docs and shipped that those commits just
closed.

---

## D. What the existing 12-agent SCP represents

I spent real time in `src/services/scp/`. It is not a stub. It is a
mature, opinionated runtime. Specific evidence:

- **6,348 lines across 19 files.** Comparable in size and discipline to the
  V3 spec's proposed `src/services/specialists/runtime/` plus 24 specialist
  classes.
- **Constitution-based agents.** `SCPConstitution` exists in `types.ts`.
  `instance.ts` provisions agents with system prompts, behavioral
  constraints, evolution policy, and golden-lesson injection. This is
  exactly what V3 calls "constitution loading" — already built.
- **Authority levels** (0=autonomous, 1=notify+override, 2=approve). Simpler
  than V3's 0-4 gate model but covers the same ground for the actual
  surface area Foundry currently acts on.
- **Per-agent cadence** in hours. V3 specifies daily/weekly/monthly cadences;
  SCP already has them and lets each agent have its own.
- **Evolution mechanism** — `evolution.ts` is 603 lines. Agents propose
  configuration changes based on outcomes, validation gates these against
  thresholds, founder corrections feed golden lessons. This is "constitutional
  evolution" from V3, already shipped.
- **Inter-agent messaging** — `messages.ts`, `message-threads.ts`,
  `agent_messages` table. Agents send each other alerts/insights/requests/
  updates with priority. V3's "structured critique" protocol is a stricter
  variant of this; the underlying transport exists.
- **Debate sessions** — `debate/` directory plus `scp_debate_run` cron.
  This is structurally identical to V3's "structured disagreement protocol."
- **Wisdom synthesis** — weekly cross-agent pattern extraction. Goes beyond
  what V3's `decision_patterns` proposes.
- **Temporal analysis** — `temporal.ts` (413 lines) does weekly trend
  identification per company. V3 has no equivalent.
- **Founder wellbeing** — `founder-wellbeing.ts` does behavioral signal
  detection on the founder. V3 has no equivalent.
- **Prediction accuracy tracking** — `agent_predictions` + `prediction_
  accuracy` cron measures whether agents are calibrated. V3 has Mariner
  recommend per-specialist eval suites; SCP already has live accuracy
  measurement.
- **Network contribution** — `network.ts` with consent-gated anonymized
  pattern contribution. This is the cross-tenant pattern layer V3 wants —
  the table exists, the writes work, only the reader service is missing
  (per `documented-but-not-built.md`).

What SCP is missing relative to V3:

- North Star + Outcome Tree (no defined destination)
- Voice Fingerprint + Taste Journal (no per-product calibrated artifact
  signature)
- Tool gateway with idempotency (each integration handles its own auth/rate-
  limiting/audit; no unified trust boundary)
- Architecture freeze period (no enforced "stop critiquing, start observing"
  mechanism)
- Recursive critique yield monitoring (no measure of when to stop iterating)
- Anti-canon corpus (no forced-inversion mechanism against canonical
  exemplars)
- Communication budget per customer (no cross-agent rate limit on
  customer-facing messaging)
- Domain expert role (no concept of per-product domain authority)

**Verdict on D:** SCP is the right abstraction. It is under-instrumented
in 4-5 specific places that V3's recursion correctly identified. It is
not insufficient and does not need to be replaced. Treating SCP as
"something to bolt onto" — V3's framing — is wrong. SCP is the platform.
V3 is the discipline layer that gives SCP a destination and guardrails.

---

## E. The synthesis — what V3.x should actually be

**Name it V3.1 to honor the V3 architecture work without claiming to
implement it whole.** V3.1 is the narrow synthesis: the 4-5 highest-leverage
additions from V3's recursion findings, applied to the existing SCP
runtime, in a way that respects the simplification arc and composes with
friendly-alpha launch.

The path: **evolve SCP, don't fork it.**

V3.1 ships in this order:

### Layer A — Destination & discipline (week 1)
1. **`north_stars` table** — one row per product. Founder-set ARR target,
   paying-account target, NRR floor, target date, last-reviewed timestamp.
   Surfaced in briefings. Agent contexts include current vs. target gap.
2. **`outcome_trees` table** — branches with current/target values and a
   required `kill_criterion` per branch (Sage's recursion finding). Trees
   regenerate weekly via a new cron driven by metric snapshots and stressors.
3. **`freeze_periods` table** — when active for a product, blocks
   "architecture-class" code changes (a new field on the `decisions` table
   tags decisions as architecture-affecting; freeze rejects those into a
   `phase_beta_proposals` queue). Founder-revocable.
4. **`team_health_metrics` table** — Ambros's six metrics (critique pass
   rate, override rate, etc.) computed weekly across the existing 12 SCP
   agents. Includes recursive critique yield.

### Layer B — Calibration (week 2)
5. **`voice_fingerprints` table** — per-product. Sentence rhythm, lexical
   preferences, register, exemplar sentences, banned words. Tenant-restricted
   (Cipher's rule). Beacon and Scribe use it as ground truth. Voice-as-gate
   integration with the existing decision queue: any agent decision
   modifying user-facing strings (`action_type IN ('send_email',
   'update_landing', 'publish_content')`) requires voice-fingerprint scoring
   above threshold or founder approval.
6. **`taste_journals` table** — per-product, per-agent. Founder-rated
   artifacts (`feels_right` / `feels_off` / `missing_something`). Calibration
   sessions are a new founder UI surface, monthly cadence.

### Layer C — Trust boundary (week 3)
7. **Tool gateway, narrow scope.** A new `src/services/tool-gateway/`
   that wraps the *outbound* action types in `decisions` (send_email,
   create_pr, update_config, publish_content). Provides idempotency keys
   (table generalized from `webhook_idempotency`), classification check
   (per-product `data_classifications` table), kill-switch (existing
   pause/resume extended), and audit (joins existing `audit_log`).
   Critically: **does not** wrap every internal service call. Wraps only
   what reaches outside the system. Existing integrations migrate one at a
   time.
8. **`communication_budgets` table** — Lighthouse's finding. Per-product,
   per-customer, weekly cap. Tool gateway for `send_email` and similar
   checks the budget; over-cap messages queue for priority arbitration.

### What V3.1 deliberately does NOT include
- 24-specialist parallel team (SCP's 12 stays)
- Sense/Reason/Act directory restructure
- 25-table schema dump (only ~8 tables, all genuinely net-new)
- Vesper as a separate role (her disciplines fold into Beacon + Scribe via
  voice fingerprint + taste journal + anti-canon)
- Surveyor/Astra/Edge per-tenant specialists (deferred until Foundry has
  real multi-tenant architecture)
- Operator dashboards beyond what SCP already has (existing dashboard +
  briefings cover this)
- Production deploys (Thomas's call)

### Why this is the right call
- **Honors the simplification arc.** Adds ~8 tables to a 95-migration
  codebase, not 25. No parallel agent system. No directory restructure.
  Existing SCP behavior unchanged.
- **Honors the ambition.** Adds the V3 architecture's load-bearing
  innovations — destination, freeze discipline, trust boundary, calibration,
  customer-protection — that genuinely weren't there before.
- **Composes with friendly alpha.** V3.1 work and Path A launch are not
  mutually exclusive. Layer A is the most launch-relevant (founders need
  to see destination, not just observation). Layers B and C land while
  alpha runs.
- **Reversible.** Each layer commits separately. If A doesn't earn its
  keep in the alpha, B and C don't ship. If C breaks integrations, the
  gateway is opt-in per integration.
- **Operational data > internal critique.** Layer D ("more specialists,
  more disciplines") evaluates against real founder behavior, not against
  another round of recursion in chat.

### What about Thomas's "way more advanced iteration" / "95-99% autonomy" ask?
The honest answer: 95% autonomy is reachable from V3.1 via the existing
SCP authority ratchet, *not* via building 24 new specialists. The current
SCP defaults are conservative (most agents at authority 1 or 2). Trust
ratchet has not yet started in real operations because there are no real
operations yet. The bottleneck is alpha customers, not specialist count.

### What V3.1 produces, concretely
- Foundry alpha-shippable on day one (V3.1 doesn't block launch)
- Each product has a measurable destination by week 1
- Each product has a calibrated voice signature by week 2
- All outbound actions trace through audit + idempotency by week 3
- Foundry is materially closer to the V3 architecture's load-bearing
  innovations without rebuilding the parts that work

---

## F. The concrete build plan

File-level. Migration-level. The kind of plan a future Claude session can
pick up cold.

### Migrations (numbered 060–067, all reversible)

```
src/db/migrations/
  060_north_stars_outcome_trees.sql
    CREATE TABLE north_stars(...)                — 1 row per product
    CREATE TABLE outcome_trees(...)              — branches, kill_criterion NOT NULL
    CREATE INDEX north_stars_product_id, outcome_trees_product_id
    DOWN: DROP both tables

  061_freeze_periods.sql
    CREATE TABLE freeze_periods(...)
    ALTER TABLE decisions ADD COLUMN architecture_class INTEGER DEFAULT 0
    ALTER TABLE decisions ADD COLUMN frozen_at DATETIME
    CREATE TABLE phase_beta_proposals(...)
    DOWN: DROP tables, DROP columns

  062_team_health_metrics.sql
    CREATE TABLE team_health_metrics(...)        — weekly aggregate per product
    DOWN: DROP table

  063_voice_fingerprints.sql
    CREATE TABLE voice_fingerprints(...)         — per-product, versioned
    DOWN: DROP table

  064_taste_journals.sql
    CREATE TABLE taste_journals(...)             — per-product, per-agent
    DOWN: DROP table

  065_idempotency_general.sql
    CREATE TABLE idempotency_keys(...)           — generalized; webhook_idempotency stays
    CREATE INDEX idempotency_keys_key_unique UNIQUE
    DOWN: DROP table, DROP index

  066_data_classifications.sql
    CREATE TABLE data_classifications(...)       — per-product, per-surface
    DOWN: DROP table

  067_communication_budgets.sql
    CREATE TABLE communication_budgets(...)      — per-product, per-customer-key
    CREATE INDEX comm_budgets_product_customer
    DOWN: DROP table, DROP index
```

All migrations follow Foundry's existing convention (CREATE TABLE IF NOT
EXISTS, idempotent ALTER, migration runner swallows duplicate errors).

### New service files (additive only)

```
src/services/destination/
  north-star.ts          — CRUD + briefing context surface
  outcome-tree.ts        — tree generation, kill-criterion enforcement
  __tests__/             — unit tests for both

src/services/discipline/
  freeze-periods.ts      — start/end/check freeze status; tag decisions
  proposals-queue.ts     — phase_beta_proposals CRUD
  team-health.ts         — Ambros's six metrics, recursive critique yield
  __tests__/

src/services/calibration/
  voice-fingerprint.ts   — CRUD; scoring API; voice-as-gate hook
  taste-journal.ts       — CRUD; calibration session helper
  __tests__/

src/services/tool-gateway/
  gateway.ts             — invoke({agent, tool, action, params, key})
  idempotency.ts         — wraps generalized idempotency_keys
  classification.ts      — data classification compliance check
  kill-switch.ts         — reads existing pause state + new disabled_tools
  audit.ts               — wraps existing audit_log
  budget.ts              — communication_budgets enforcement
  index.ts               — exports
  __tests__/             — required: idempotency, kill-switch, budget
  README.md              — adapter migration plan (one integration at a time)
```

### Existing service touch-points (minimal)

```
src/services/scp/instance.ts
  + load North Star context for each agent run
  + prepend financial frame to system prompt (cached daily)

src/services/scp/briefing.ts
  + include North Star delta + outcome tree health in headline section
  + include team health metrics

src/services/scp/scheduler.ts
  + before scheduling agent run, check freeze_periods for architecture-
    affecting agents (if architecture-class freeze active, route to
    proposals-queue instead)

src/services/decisions/queue.ts
  + voice-as-gate: decisions with action_type in user-facing-strings
    pre-screen via voice-fingerprint scoring

src/services/decisions/actions.ts
  + outbound action types route through tool-gateway.invoke instead of
    direct integration calls (one type at a time, behind feature flag)

src/jobs/index.ts
  + new cron: outcome_tree_refresh (weekly)
  + new cron: team_health_aggregate (weekly)
  + new cron: voice_fingerprint_drift_check (weekly)
```

### New routes (additive)

```
src/routes/api/
  north-stars.ts         — GET/POST/PATCH per product
  outcome-trees.ts       — GET tree, POST branches, kill-criterion enforcement
  voice-fingerprints.ts  — GET/POST/PATCH; calibration session endpoint
  taste-journals.ts      — GET/POST per product per agent
  team-health.ts         — GET aggregated metrics

src/routes/dashboard/
  destination.ts         — North Star + Outcome Tree visualization
                           (mobile-first; minimal styling deferred to desktop)
  team-health.ts         — Ambros's metrics card on dashboard
  calibration.ts         — voice-fingerprint + taste-journal review surface
```

### Test coverage targets
- Migrations: forward + backward (reversibility test)
- Tool gateway: idempotency dedup, kill-switch refusal, classification
  compliance, communication budget enforcement
- North Star + Outcome Tree: kill-criterion required, tree regeneration
- Freeze period: architecture-class detection, proposals queue routing
- Team health: critique pass rate calculation, recursive yield calc

Aim for >70% line coverage on new code. Do not modify existing tests.

### Sequencing
- Days 1-3: migrations 060-062 + destination + discipline services + tests
- Days 4-6: migrations 063-064 + calibration services + voice-as-gate + tests
- Days 7-12: migrations 065-067 + tool gateway + budget + adapter migration
  for the riskiest integration first (Resend → Stripe → GitHub) + tests
- Days 13-14: routes, briefing integration, cron wiring, end-to-end smoke
- Day 15: ready for review; commit at every clean boundary

### What this is NOT
This is not 24 specialists. Not 25 tables. Not a fork of SCP. Not a
directory reorg. Not a multi-tenant architecture. Not Vesper. Not the V3
mega-prompt. It is the load-bearing 30% of V3 that earns its keep in the
real Foundry codebase.

---

## G. What I'm uncertain about

These need Thomas's input. Listed in priority order.

**G1. The fundamental Path A vs V3.1 question.**
The 9 reality-alignment commits explicitly recommend Path A: ship to 3-5
founders under narrow positioning. V3.1 is compatible with Path A but not
free — it is 2-3 weeks of focused work that delays alpha by that amount
unless run in parallel. Is alpha launch the priority, with V3.1 as the
*next* increment after alpha is live? Or is V3.1 first, then alpha? My
recommendation is alpha first, V3.1 in parallel — but this is a strategic
call I cannot make for Thomas.

**G2. Whether to honor the V3 chat arc's roster/naming or SCP's.**
V3 introduces new names (Vesper, Ambros, Sage, Mariner, Atrium) that don't
map to SCP's 12 (atlas/compass/prism/beacon/etc.). V3.1 keeps SCP's 12 as
the agent layer and adds the disciplines as services, not as new agents.
But Thomas may have invested in the V3 nomenclature emotionally or as
external positioning. If the names are load-bearing, V3.1 needs renaming
work I haven't scoped.

**G3. The North Star numbers themselves.**
V3.1 ships the North Star *table*. The actual values per product
(Foundry's own ARR target, AcreOS's if Foundry serves it, etc.) are
Thomas's. I can stub `null` and proceed; the table is useful empty. But
the briefing surface that says "you are X% to North Star" needs real
numbers eventually.

**G4. Voice Fingerprint baseline content.**
Building the table is one thing. Filling it with the actual voice signature
for each product (Foundry's own, AcreOS's, etc.) requires founder
calibration on 20-50 sample sentences per product. Stub-with-defaults is
fine for shipping infrastructure. Real calibration is a 30-min founder
session per product.

**G5. The freeze period scope choice.**
V3 specs a 90-day full freeze. My V3.1 plan defaults to architecture-class-
only freeze for 90 days. Thomas may want different scope or duration. The
scope semantics (architecture-class / specialist-only / process-only) need
his confirmation if non-default.

**G6. Whether AcreOS, Astrum, Kalshi-Genius are actually Foundry tenants
yet.**
The V3 prompt assumes these are tenants. The reality check says Foundry is
single-founder with multi-product. If Thomas himself is the founder and
those are products under his single Foundry account, that's already
supported. If they are *separate founders* using Foundry, that's the multi-
organization architecture which is 1-2 months of separate work. I have
written V3.1 assuming the former (Thomas + multiple products under one
account).

**G7. Whether the existing SCP names should be renamed to V3 names.**
Specifically: should "atlas" stay "atlas" (CTO/code) or become V3's "Atlas"
(Chief Architect/strategy)? They're different roles in the two specs. If
Thomas wants V3 naming, this is a non-trivial rename across 6,348 lines of
SCP code plus tables and indexes.

---

## Closing note

The V3 chat arc is high-quality strategy and architecture work. The
reality-alignment commits are high-quality forensic engineering work.
Both are correct in their own scope. The synthesis is to take the load-
bearing innovations from the former, the discipline of the latter, and
land them on the actual repo as a focused 2-3 week increment that doesn't
block launch and doesn't pretend to rebuild what already works.

If Thomas confirms this direction (V3.1 as specified above), the next
session can begin with migration 060 and proceed file-by-file through
the build plan in section F. If Thomas wants V3-as-written, that's
viable too — but it's a 3-month build that materially conflicts with
the simplification arc, and the conflict should be named explicitly
before it starts.

— Claude Opus 4.7, with the live repo open
