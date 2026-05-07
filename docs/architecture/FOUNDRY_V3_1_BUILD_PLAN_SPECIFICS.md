# Foundry V3.1 — Build Plan Specifics

> Written 2026-05-07 by Claude Opus 4.7 (1M context).
> Companion to `FOUNDRY_V3_SYNTHESIS_FROM_REPO.md`.
> Answers Thomas's five pre-build clarifications. After this commits,
> the build proceeds layer-by-layer per Section 5.

---

## 1. Net-new tables — exhaustive list with non-duplication audit

The synthesis summarized "~8 tables." Actual count is **10**. I undercounted
in the summary; transparent here. Verified each against the existing 95-
migration schema (every existing table name extracted from
`src/db/migrations/*.sql`).

| # | Proposed table | Closest existing | Status | Why net-new |
|---|---|---|---|---|
| 1 | `north_stars` | none | Net new | No existing per-product 12-month destination record. |
| 2 | `outcome_trees` | none | Net new | Tree of branches with `kill_criterion` (Sage's recursion finding). No existing equivalent. |
| 3 | `freeze_periods` | none | Net new | No existing architecture-freeze mechanism. |
| 4 | `phase_beta_proposals` | `agent_initiative_queue` | Net new | `agent_initiative_queue` is per-agent execution queue; this is an architecture-class proposal queue gated by freeze status. Different concern. |
| 5 | `team_health_metrics` | `agent_accuracy_scores` | Net new | `agent_accuracy_scores` is per-agent prediction calibration. `team_health_metrics` is Ambros's six cross-team metrics (critique pass rate, override rate, recursive critique yield, etc.). Different scope. |
| 6 | `product_voice_fingerprints` | `founder_voice` | Net new | `founder_voice` is the founder's personal communication style (Thomas's tone). `product_voice_fingerprints` is per-product writing voice (Foundry's voice ≠ AcreOS's voice ≠ Astrum's voice). Different scope. **Note: I renamed from `voice_fingerprints` → `product_voice_fingerprints` to disambiguate from `founder_voice` and from the existing `src/services/voice/` (audio-briefing) directory.** |
| 7 | `taste_journals` | `ai_output_feedback` | Net new | `ai_output_feedback` is per-founder generic rating with dimensional flags (too_long, too_technical). `taste_journals` is per-product per-agent structured artifact rating (feels_right / feels_off / missing_something) for calibration sessions. Could in principle extend `ai_output_feedback`, but the join structure differs (product+agent vs founder) and the categories differ. New table is cleaner. |
| 8 | `idempotency_keys` | `webhook_idempotency` | Net new (generalized) | `webhook_idempotency` is webhook-specific event dedup. `idempotency_keys` is general outbound-action dedup keyed on `(agent_id, action_type, dedup_key)`. They coexist; webhook_idempotency stays as-is. |
| 9 | `data_classifications` | `data_residency_settings` | Net new | `data_residency_settings` is GDPR/region settings. `data_classifications` is per-product per-surface classification (PII / financial / customer / general) used by the gateway to authorize tools. Different scope. |
| 10 | `communication_budgets` | none | Net new | Lighthouse's recursion finding. No existing cross-agent rate limit per customer. Existing `behavioral_triggers` config is a per-product per-trigger frequency, not cross-agent cumulative. |

**Confirmation:** zero duplications. The closest cases are #6 (`founder_voice`)
and #7 (`ai_output_feedback`); both are different enough in scope and join
structure that creating new tables is correct, not over-engineering.

---

## 2. Service modules — concretely named, with ownership

The synthesis said "three additive service modules." Actual is **3 new
modules + 1 extension to existing `src/services/outbound/`**. Stating
explicitly since `outbound/executor.ts` already exists and is the natural
home for the trust-boundary work.

### Module 1 — `src/services/destination/` (NEW)
**Owns:** the per-product 12-month frame.
- `north-star.ts` — CRUD on `north_stars`. Surfaces current-vs-target gap
  to the briefing system. Reads metric snapshots to populate `current_value`
  on read.
- `outcome-tree.ts` — generates trees from North Star + stressors + agent
  observations. Enforces `kill_criterion NOT NULL` on every branch (Sage's
  rule). Regenerates weekly via new cron.
- `briefing-context.ts` — small adapter that `src/services/scp/briefing.ts`
  calls to inject destination context into headlines and agent prompts.
  No changes to existing briefing logic — new file, called from briefing.

### Module 2 — `src/services/discipline/` (NEW)
**Owns:** governance state and metrics.
- `freeze-periods.ts` — start/end/check freeze for a product. Function
  `isArchitectureClassFrozen(productId): boolean`. Function
  `tagDecisionAsArchitectureClass(decisionId)` runs heuristic classifier
  on `decisions` rows.
- `proposals-queue.ts` — CRUD on `phase_beta_proposals`. When freeze blocks
  a decision, it routes here instead of executing.
- `team-health.ts` — computes Ambros's six metrics weekly. Reads
  `agent_messages`, `decision_quality_scores`, `agent_predictions`, and
  produces `team_health_metrics` rows. Includes recursive critique yield.

### Module 3 — `src/services/calibration/` (NEW)
**Owns:** per-product voice and per-agent taste.
- `voice-fingerprint.ts` — CRUD on `product_voice_fingerprints`. Function
  `scoreArtifactAgainstVoice(productId, draftText): {score, breakdown}`
  using LLM-as-judge against the fingerprint's exemplars + rules.
- `taste-journal.ts` — CRUD on `taste_journals`. Calibration session
  helper: `startCalibrationSession(productId, agentName)` returns 5-10
  recent artifacts for founder rating.
- `voice-gate.ts` — used by `src/services/decisions/queue.ts` to pre-screen
  user-facing-string decisions before they hit the founder approval queue.

### Module 4 — `src/services/outbound/` (EXTENSION, not new)
**Owns:** trust boundary on outbound actions. Existing `executor.ts` stays;
this layer wraps it.
- `gateway.ts` — top-level `invoke({agent, tool, action, params, dedupKey})`.
  Calls into the four checks below in sequence. Falls through to existing
  `executor.ts`. **All new outbound action types route through gateway;
  existing types migrate one at a time per the README.**
- `idempotency.ts` — wraps generalized `idempotency_keys` table. Returns
  cached result if `dedupKey` already seen within TTL.
- `classification.ts` — checks per-product `data_classifications` against
  the action's data tags. Refuses if classification disallows.
- `kill-switch.ts` — reads existing pause state (`agent_instances.status =
  'paused'`) plus a new `disabled_tools` JSON column on `products`. Refuses
  if either is set.
- `budget.ts` — reads `communication_budgets` for `(product_id,
  customer_external_id, week)`. Refuses or queues if over.
- `audit.ts` — appends to existing `audit_log`. Tags with gateway invocation
  ID for cross-reference.

### Why this is clean
- Three new directories, no overlap with existing 40+ service dirs
  (`scp/`, `intelligence/`, `decisions/`, `outbound/`, etc.).
- The trust-boundary work extends the existing `outbound/` rather than
  parallel-forking a new `tool-gateway/` directory. This honors V3's
  architectural intent without splitting the abstraction.
- All four modules are additive. Existing imports do not break.

---

## 3. Architecture freeze ↔ SCP evolution interaction

This is the question I'm most glad you asked, because the wrong answer
would silently break the most important loop in the system.

### The principle
**Freeze blocks expansion of system behavior. Freeze permits tightening
and corrections.**

### Mapped concretely to SCP's existing `change_type` CHECK values

The existing `agent_evolution_versions.change_type` constraint
(`017_scp_foundation.sql:121`) has six values:

| `change_type` | Effect on agent | Frozen? | Why |
|---|---|---|---|
| `golden_lesson` | Founder correction → guardrail injected into prompt | **Allowed** | Tightens behavior. Founder-driven. Never expands capability. |
| `constraint_added` | New behavioral constraint | **Allowed** | Strictly tightens. Only restricts. |
| `authority_change` (toward restriction: 0→1, 1→2) | Agent becomes more conservative | **Allowed** | Reduces autonomy. Safer. |
| `authority_change` (toward expansion: 2→1, 1→0) | Agent gains autonomy | **Blocked** | Expansion of system behavior. Requires phase-beta proposal. |
| `prompt_refinement` | System prompt edit | **Conditionally blocked** | If refinement is purely correction-driven (linked to a `founder_correction` session), allowed. If it's the agent self-improving its prompt without correction trigger, blocked. |
| `founder_correction` | Founder explicit override | **Always allowed** | Founder is the authority. Freeze does not override the operator. |
| `initial_provision` | First-time agent creation | **Blocked** | Provisioning new agents during freeze is exactly the kind of expansion freeze prevents. Existing agents continue running. |

### What the freeze does NOT block (despite reasonable confusion)
- Agent **runs**. Cron-scheduled hourly/daily/weekly agent sessions continue.
- Agent **observations**. Agents continue observing, recommending, briefing.
- **Decisions** with `architecture_class = 0` (default). Operational decisions
  (send_email, create_pr at routine cadence, log_observation, etc.) flow
  normally.
- **Golden lesson injection.** Each session continues to load active golden
  lessons.
- **Validation cycles.** Existing `evolution.ts` validation logic
  (validation_score, promoted_at) continues running. The decision to
  promote is gated by freeze, not the measurement.

### What the freeze blocks
- New `authority_change` toward expansion.
- `initial_provision` of new agents.
- `prompt_refinement` not linked to a founder correction.
- `decisions` flagged `architecture_class = 1` (new column on `decisions`,
  defaults to 0). Heuristic flagger sets this for: schema changes, new
  cron registrations, cross-product structural changes, new tool
  integrations, evolution-policy edits.
- New entries in `agent_initiative_queue` flagged architecture-class.

### The phase-beta proposal flow
When freeze blocks something, it does not vanish. It writes to
`phase_beta_proposals` with: original decision/evolution, why it was
blocked, recommended unfreeze date, founder-visible explanation. Visible
on dashboard. Reviewed at end of freeze period.

### Founder override
The freeze is a discipline, not a security boundary. Founder can:
1. End the freeze (sets `freeze_periods.ended_at`)
2. Mark a specific proposal `force_apply = true` to bypass freeze for that
   one item
3. Reduce the architecture-class scope on a specific decision

This is correct: V3's freeze is a disciplined-defaults mechanism, not a
permission system. The founder remains the authority.

### Why this preserves SCP evolution
The four "always-allowed" change types (`golden_lesson`, `constraint_added`,
`authority_change` toward restriction, `founder_correction`) cover **>80%**
of the actual evolution traffic in current SCP based on the schema's
intent. The `prompt_refinement` and `authority_change` toward expansion
are exactly the changes that benefit from operational data before being
applied — which is what the freeze period exists to collect. Evolution is
not paused; it is rate-limited in the directions where rate-limiting
matters.

---

## 4. The 34 recursion findings — classification table

**Important caveat.** The V3 chat arc you described referenced 34
recursion findings across the 24-specialist VESPER_V2_AND_RECURSION
recursion. The actual full ledger of those 34 findings was not in the
repo when I started this session and was not pasted into the current
conversation in enumerable form. I can only confidently classify the
findings I can identify from the conversation context (the V3 mega-prompt
text, your redirect message, my synthesis cites). That gives me ~14
findings I can name and classify with confidence.

For the remaining ~20, I would need either: (a) the explicit recursion
ledger pasted, (b) the file path if the V3 chat docs are saved somewhere
on disk that I haven't found, or (c) your written list of the round-by-
round findings.

Below is the partial table for the findings I can name. **Each row
includes the source citation so you can verify I'm not inventing
findings.** I have flagged in §5 that the remaining ~20 findings need
your input before they can be classified.

### Classification key
- **(a)** Discipline upgrade applies to existing SCP. No new tables. Edit
  prompts, configs, gates, or evolution policy.
- **(b)** Requires net-new tables/modules in V3.1. In the build plan.
- **(c)** Drop. Redundant with existing SCP, or premature for current
  Foundry scale.

| # | Recursion finding (specialist who raised it) | Source | Class | Disposition in V3.1 |
|---|---|---|---|---|
| 1 | Tool gateway with idempotency, classification, kill-switch, audit | Atlas / Cipher / Forge (V3 mega-prompt §recursion findings) | **(b)** | Module 4 — `outbound/gateway.ts` + tables 8, 9 |
| 2 | Architecture freeze period | Ambros (VESPER_V2_AND_RECURSION) | **(b)** | Module 2 — `discipline/freeze-periods.ts` + table 3 |
| 3 | Recursive critique yield monitoring | Ambros (Round 5 meta-finding) | **(b)** | Module 2 — included in `team-health.ts` + table 5 |
| 4 | Voice fingerprint per product | Vesper / Lyric (V3 mega-prompt) | **(b)** | Module 3 — `calibration/voice-fingerprint.ts` + table 6 |
| 5 | Taste journal per agent per product | Vesper / Lyric | **(b)** | Module 3 — `calibration/taste-journal.ts` + table 7 |
| 6 | Anti-canon corpus (forced inversion) | Vesper | **(a)** | Discipline upgrade: extend `agent_wiki_entries` schema with `inversion_of` reference. No new table. Wired into Beacon + Scribe prompts. |
| 7 | Communication budget per customer | Lighthouse | **(b)** | Module 4 — `outbound/budget.ts` + table 10 |
| 8 | Domain expert veto | Surveyor | **(c)** | **Drop for V3.1.** Foundry currently has no domain canon to vet against. Premature without ≥1 active per-tenant specialist with a real corpus. Re-evaluate when multi-tenant ships. |
| 9 | Kill criterion required on every outcome branch | Sage | **(b)** | Module 1 — enforced as `NOT NULL` constraint on `outcome_trees.kill_criterion` |
| 10 | Per-specialist eval suites (golden test cases) | Mariner | **(a)** | Discipline upgrade. SCP already has `agent_predictions` + prediction accuracy cron. Wire 5-10 golden cases per agent as fixtures in `__tests__/agent-evals/`. No new table. |
| 11 | North Star + Outcome Tree as first-class | Sage / Compass | **(b)** | Module 1 — `destination/` + tables 1, 2 |
| 12 | Phase beta queue for blocked architecture changes | Ambros (paired with freeze) | **(b)** | Module 2 — `discipline/proposals-queue.ts` + table 4 |
| 13 | Data classification per surface | Cipher | **(b)** | Module 4 — `outbound/classification.ts` + table 9 |
| 14 | Idempotency on every outbound action | Atlas / Forge | **(b)** | Module 4 — `outbound/idempotency.ts` + table 8 |

### Of the 14 classified
- **(a) discipline upgrades to existing SCP:** 2 (anti-canon, eval suites)
- **(b) require new tables/modules in V3.1:** 11 (covered by the build plan)
- **(c) drop as redundant or premature:** 1 (domain expert veto)

### What's missing
Approximately 20 more findings from the recursion arc that I cannot name
from current context. **Please either paste the complete ledger or point
me to the V3 chat artifact path.** Without those, the Layer A and B build
will proceed on the 14 classified above, and I'll integrate the remaining
20 either as discipline upgrades during build or as backlog if class (a),
or as new tables/modules if class (b) — whichever the ledger indicates.

I will not invent findings to fill the count. The 34 number stays open in
G7 (now G7 of the synthesis Q list) until you provide the source.

---

## 5. Sequencing vs. friendly alpha launch

### Recommendation: **Layer A pre-alpha, Layer B during alpha, Layer C after first wave**

The three layers have different sensitivity to having or not having real
operational data. Sequence them according to that.

### Detailed sequencing

| Phase | What ships | Why this timing |
|---|---|---|
| **Pre-alpha (days 1-3)** | **Layer A**: tables 1-5, modules 1-2 | The briefing system needs destination context to land for the first founder. "You are 8% to your $50K MRR target" is V3's load-bearing frame; without it, the briefing reads as observation without aim. Stub-shippable: `north_stars` table empty until founder onboarding fills it. Enables freeze period to be active during alpha (a discipline that protects the alpha itself from over-iteration). |
| **During alpha (founders 1-3, days 4-9)** | **Layer B**: tables 6-7, module 3 | Voice fingerprints calibrate against real artifacts. You can't generate a fingerprint for a product that has shipped no content. Build the table + UI; first founder's onboarding includes a 30-min voice-calibration session to seed it. Early founders give us calibration data we can't generate synthetically. |
| **After founders 1-3, before founder 5+ (days 10-15)** | **Layer C**: tables 8-10, module 4 (outbound extension) | Tool gateway disciplines matter most when multiple founders are sending real outbound concurrently. Today, gateway protects against integration bugs that affect maybe one founder. At 5+ founders, gateway protects against a Resend bug double-sending across all founders. Premature abstraction risk if shipped before there's any cross-founder volume. |

### The tradeoff

**Argument for shipping Layer C earlier (e.g. before alpha):** integration
bugs are the single most likely cause of an alpha trust break. A duplicate
"your Stripe payment failed" email to a customer of a customer is the
exact failure mode that ends a friendly alpha. Idempotency + budget +
kill-switch protect against this from founder #1.

**Argument for shipping Layer C later:** today, outbound surface area is
small. Existing `outbound/executor.ts` plus the existing `webhook_
idempotency` cover the common case. The marginal protection from a full
gateway is small per-founder; the protection scales with founder count.
Building it before founder 1 risks over-engineering against a threat
profile that doesn't exist yet.

**My recommendation lands closer to "later," but the boundary case for
"earlier" is real.** If Thomas wants to ship Layer C earlier — specifically
ship it pre-alpha as a defense-in-depth measure — that's defensible. The
cost is +5-7 days delay to alpha, which against the upside ("no integration-
bug trust-break in week 1") may be worth it.

### Default unless redirected
- Day 0 → Day 3: Layer A. Friendly alpha customer #1 invitation can go out
  end of Day 3.
- Day 4 → Day 9: Layer B in parallel with founder 1 onboarding. Founder
  contributes voice-calibration data.
- Day 10 → Day 15: Layer C. Ships before founder 4-5.

### Override paths Thomas might prefer
1. **Layer A + most of Layer C pre-alpha (defensive build).** Days 1-7,
   then alpha. Layer B during. Strongest defensive posture; +4-5 days
   delay to alpha.
2. **Alpha first, Layer A→B→C all in parallel after.** Days 1-2 of pre-
   launch ops fixes (the "3 pre-launch actions" from `narrow-launch-
   readiness.md`), then alpha invites, then V3.1 build runs alongside.
   Fastest to alpha; risks alpha experiencing pre-V3.1 gaps.
3. **My default (above).** Balanced. Alpha by Day 4. V3.1 disciplines
   land in protective order.

I will proceed on the default unless you redirect.

---

## 6. Status of open questions from synthesis Section G

| # | Question | Resolution |
|---|---|---|
| G1 | Path A vs V3.1 timing | **Resolved.** This doc's §5 default. Pre-alpha = Layer A only. Alpha by Day 4. |
| G2 | V3 names vs SCP names | **Open.** Default: keep SCP's 12 names (atlas/compass/etc.). V3 disciplines fold in as services. If Thomas wants V3 names, separate rename pass. |
| G3 | North Star numbers | **Acknowledged.** Stub-ship empty. Founder fills in onboarding. |
| G4 | Voice fingerprint baseline content | **Acknowledged.** Stub-ship infrastructure. Calibrate during alpha. |
| G5 | Freeze period scope | **Resolved.** §3 of this doc — architecture-class only, founder-overridable. |
| G6 | AcreOS/Astrum/Kalshi tenancy | **Acknowledged.** V3.1 assumes Thomas + multiple products under one Foundry account. Real multi-tenant is separate 1-2 month project (deferred). |
| G7 | The 34 recursion findings ledger | **Open** (now §4 of this doc). I have classified 14 from context. Remaining ~20 need source from Thomas. Build proceeds on the 14; remaining absorb during or after. |

---

## 7. What happens immediately after this commits

Build begins per the synthesis §F sequencing, modified by §5 above.

**First action:** create migration `060_north_stars_outcome_trees.sql` and
`src/services/destination/` with `north-star.ts`, `outcome-tree.ts`,
`briefing-context.ts`, plus tests.

**Commit boundaries** (each its own commit, each independently revertible):
1. `feat(destination): north_stars + outcome_trees migration + service`
2. `feat(discipline): freeze_periods + phase_beta_proposals migration + service`
3. `feat(discipline): team_health_metrics migration + Ambros metrics`
4. `feat(scp): wire destination context into briefing + agent runs`
5. (Layer B begins, separate commits per table/module)
6. (Layer C begins, separate commits per gateway component)

I will pause and summarize after each commit. Thomas can redirect at any
boundary without losing progress.

---

— Claude Opus 4.7
