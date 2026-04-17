# Lens 41 — Multi-Company Operations / Holding-Company Expert Audit

**Auditor perspective:** Multi-company operator / holding-company expert
**Scope:** 5-stage lifecycle model (setup, learning, operating, optimizing, scaling), growth-stage detection, lifecycle conditions, fleet management realism, cross-company intelligence
**Date:** 2026-04-16

---

## Executive Summary

Foundry defines a 5-stage company lifecycle (setup -> learning -> operating -> optimizing -> scaling) alongside a separate 5-stage growth classification (pre_launch -> early_traction -> growth -> scale -> mature). The lifecycle model is coherent in concept but fundamentally incomplete in execution: it covers 4 of 5 forward transitions, has no reverse transitions, no "scaling" entry criteria, and no mechanism for operators to manage a fleet of companies at different stages. The growth-stage detector is the stronger system -- it uses real metrics, allows founder overrides, and adjusts stressor thresholds per stage. The lifecycle model, by contrast, is driven by SCP session counts and success rates, making it an AI-system maturity measure rather than a business maturity measure. A real holding-company operator would find the single-company lifecycle useful but the fleet layer aspirational at best.

**P0 findings:** 0
**P1 findings:** 4
**P2 findings:** 5
**P3 findings:** 3

---

## Finding 01 — "Scaling" stage is unreachable

**Severity: P1**
**File:** `src/services/scp/instance.ts` (lines 306-356)

The `updateLifecycleState()` method on `SCPInstance` defines transitions for:
- setup -> learning (when totalSessions > 0)
- learning -> operating (when totalSessions >= 50 AND avgSuccessRate >= 0.85)
- operating -> optimizing (when totalEvoCycles >= 20 AND healthScore >= 75)

There is no transition from optimizing -> scaling. The "scaling" state is defined in the type system (`src/services/scp/types.ts` line 14) with a comment ("Largely autonomous; founder sets quarterly direction") but no code path ever assigns it. A company can never reach the final lifecycle stage.

**Impact:** The lifecycle model is marketed as a 5-stage progression, but the last stage is decorative. Any UI or documentation referencing "scaling" is misleading.

**Remediation:** Define explicit criteria for optimizing -> scaling (e.g., 3+ months in optimizing, healthScore >= 85, multiple products under management, majority of decisions at Gate 0/1).

---

## Finding 02 — Lifecycle is AI maturity, not business maturity

**Severity: P1**
**File:** `src/services/scp/instance.ts` (lines 306-356)

The lifecycle transitions are driven entirely by SCP metrics: total agent sessions, agent success rate, evolution cycles, and health score. None of these measure the actual business. A company with $0 revenue, no customers, and no product can reach "optimizing" stage if its AI agents run enough successful sessions.

Meanwhile, the separate growth-stage detection system in `src/services/lifecycle/stage-detection.ts` uses real business metrics (MRR, active users, monthly growth rates) to classify companies as pre_launch through mature. These two systems are completely disconnected.

A real holding-company operator expects the lifecycle to reflect the business, not the AI tooling.

**Impact:** The lifecycle board gives operators a false sense of business maturity. A pre-launch company could show as "optimizing" on the SCP lifecycle while showing "pre_launch" on the growth stage.

**Remediation:** Either merge the two systems (use growth stage as the primary lifecycle, with SCP maturity as a sub-indicator) or explicitly label the SCP lifecycle as "AI Operations Maturity" in the UI and keep it separate from business stage.

---

## Finding 03 — No reverse transitions (regression handling)

**Severity: P1**
**File:** `src/services/scp/instance.ts` (lines 338-355)

The lifecycle state machine only moves forward. If a company degrades (health score drops below 75, success rate collapses, critical stressors emerge), it stays in its current lifecycle stage. There is no mechanism to demote a company from "operating" back to "learning" when conditions deteriorate.

Real company fleets experience regression. A product that was "operating" may need to revert to "learning" after a major pivot, team change, or market shift.

**Impact:** Once a company advances, it never goes back, even if the conditions that justified the advancement no longer hold.

**Remediation:** Add regression conditions: if healthScore drops below 50 for 30 days, revert from optimizing to operating; if avgSuccessRate drops below 0.70, revert from operating to learning. Log regressions in the audit log.

---

## Finding 04 — No fleet-level orchestration

**Severity: P1**
**Files:** `src/services/scp/scheduler.ts`, `src/routes/dashboard/portfolio.ts`

The scheduler iterates all active products sequentially (`runDueAgentsForAllProducts` at line 28) with no fleet-level coordination:
- No concurrency control (if 50 products are active, all 50 run serially in one cron tick)
- No priority ordering (a Red-state company runs after an idle Green-state company if its DB row comes first)
- No fleet-level resource budgeting (no cap on total AI spend across all products in one run)
- No cross-company intelligence extraction (each product's agents run in isolation)

The portfolio view (`portfolio.ts`) is a basic Signal-score grid with product switching. It lacks: fleet-level health aggregation, cross-company stressor correlation, shared pattern detection, and comparative benchmarking.

**Impact:** At scale (50+ products per founder), the scheduler will time out, AI costs will be unpredictable, and the most urgent companies may not be serviced first.

**Remediation:**
1. Add concurrency limits (e.g., 5 products in parallel)
2. Sort products by risk state (Red first, then Yellow, then Green)
3. Add a fleet-level AI budget cap per scheduler run
4. Extract anonymized cross-company patterns after each run

---

## Finding 05 — Lifecycle condition system is prompt-based, not stage-based

**Severity: P2**
**File:** `src/services/lifecycle/monitor.ts`

The lifecycle conditions system (`ACTIVATION_CONDITIONS`) tracks progression through "prompts" (prompt_3 through prompt_9), which is a legacy concept from an earlier prompt-based methodology. This system is entirely separate from both the SCP lifecycle (setup/learning/operating/optimizing/scaling) and the growth stage (pre_launch through mature).

Foundry now has three independent lifecycle tracking systems:
1. SCP lifecycle state (on products table, driven by agent session counts)
2. Growth stage (on products table, driven by business metrics)
3. Prompt lifecycle (on lifecycle_state table, driven by activation conditions)

**Impact:** Confusion for both developers and operators. Which lifecycle is "the" lifecycle? The route at `/products/:id/lifecycle` shows the prompt-based one, not the SCP lifecycle or growth stage.

**Remediation:** Consolidate into a single authoritative lifecycle model. Use the growth stage as the business-facing lifecycle, the SCP lifecycle as the AI-operations sub-indicator, and deprecate or absorb the prompt system.

---

## Finding 06 — Growth-stage detection uses snapshot MRR, not cumulative

**Severity: P2**
**File:** `src/services/lifecycle/stage-detection.ts` (lines 28-31)

The MRR calculation in `detectGrowthStage` computes MRR from a single snapshot row: `new_mrr_cents + expansion_mrr_cents - contraction_mrr_cents - churned_mrr_cents`. This is the delta for that snapshot period, not cumulative MRR. A company with $50K cumulative MRR but $2K net new in the latest snapshot would show as $2K MRR and be classified as "early_traction" instead of "growth" or "scale."

**Impact:** Growth stage misclassification for established companies with low net-new in the most recent period.

**Remediation:** Use cumulative MRR (sum of all historical net MRR, or a dedicated `total_mrr_cents` field) rather than single-period delta.

---

## Finding 07 — Provisioner immediately promotes to "learning"

**Severity: P2**
**File:** `src/services/scp/provisioner.ts` (lines 138-149)

At the end of `provisionSCP`, the code sets `company_lifecycle_state` to "learning" (line 139) unless it is already past "setup." But the `updateLifecycleState` method also transitions setup -> learning when `totalSessions > 0`. The provisioner pre-empts this by promoting immediately, before any agents have actually run.

**Impact:** The "setup" stage is effectively skipped. The lifecycle dashboard may never show "setup" because provisioning happens during onboarding.

**Remediation:** Keep lifecycle_state as "setup" after provisioning. Let the first actual agent session trigger the transition to "learning."

---

## Finding 08 — No holding-company / parent entity concept

**Severity: P2**
**File:** `src/routes/dashboard/portfolio.ts`, `src/services/portfolio/`

The portfolio system treats all products as siblings under one founder. There is no concept of:
- A holding company that owns operating companies
- Shared resources between companies (brand, team, infrastructure)
- Roll-up financial reporting (aggregate MRR, aggregate health)
- Company group-level decision-making

For a single founder running 2-3 products, this is fine. For a portfolio operator or VC running 10+ companies, it is insufficient.

**Impact:** The product is positioned as a "multi-company autonomous control plane" but lacks the organizational hierarchy that holding-company operators expect.

**Remediation:** Add a `company_groups` entity (or use the existing `portfolios` table) with aggregate views, shared configuration, and group-level reporting.

---

## Finding 09 — Lifecycle MRR threshold check is snapshot-count based

**Severity: P2**
**File:** `src/services/lifecycle/monitor.ts` (lines 79-86)

The `mrr_3_months` condition for prompt_7 checks `r.rows.length >= 90` -- meaning it requires 90 snapshot rows, not 3 months of MRR data. If snapshots are daily, 90 rows = 90 days = 3 months. But if snapshots are weekly, 90 rows = 630 days. The condition conflates row count with time duration.

**Impact:** Products with weekly snapshots can never meet this condition. Products with multiple daily snapshots meet it too quickly.

**Remediation:** Use a date-range query (`WHERE snapshot_date >= date('now', '-90 days')`) instead of counting rows.

---

## Finding 10 — No stage-appropriate agent behavior

**Severity: P3**
**File:** `src/services/lifecycle/stage-detection.ts`

The `getStageConfig()` function defines which stressors are suppressed and which dimensions are focused per growth stage. This is good design. However, the SCP agents themselves do not reference the growth stage when running. The stage config affects stressor thresholds and digest focus, but agents like Atlas (CTO) and Forge (Revenue) run the same analysis regardless of whether the company is pre_launch or scale.

**Impact:** A pre-launch company receives the same depth of revenue analysis as a scale company, which is both wasteful (AI cost) and noisy (irrelevant insights).

**Remediation:** Inject growth stage into agent run context. Let each agent adapt its analysis scope and depth based on the company's stage.

---

## Finding 11 — No lifecycle transition notifications

**Severity: P3**
**File:** `src/services/scp/instance.ts` (lines 348-355)

When `updateLifecycleState()` detects a transition (e.g., learning -> operating), it updates the database but does not create a notification, milestone event, audit log entry, or briefing contribution. The founder may not notice the transition.

**Impact:** Lifecycle progress -- one of the most meaningful signals in a multi-company operation -- happens silently.

**Remediation:** On state change, create a milestone event (via `checkAndAwardMilestones`), an audit log entry, and a notification to the founder.

---

## Finding 12 — Portfolio view lacks comparative metrics

**Severity: P3**
**File:** `src/routes/dashboard/portfolio.ts`

The portfolio view shows each product's Signal score and one sentence of prose. It does not show: lifecycle stage, growth stage, risk state color, MRR, active stressors, pending decisions, or last briefing date. An operator with 5 products cannot compare their health at a glance.

**Impact:** The fleet view is too sparse for operational decision-making.

**Remediation:** Add lifecycle stage badge, risk state indicator, MRR, and pending decision count to each portfolio card.

---

## Embarrassment Test

**Would a multi-company operator be embarrassed by this?** Partially. The 5-stage lifecycle concept is sound and the growth-stage detector is well-designed. But having three disconnected lifecycle systems, an unreachable final stage, and no regression handling would not survive a demo to an experienced portfolio operator.

## Pride Test

**What would make a holding-company expert proud?** The growth-stage system with suppressed stressors and adjusted thresholds per stage is genuinely thoughtful. The stagger-offset provisioning (30-min gaps between agents) shows awareness of fleet-level resource management. The portfolio Signal view, while sparse, is the right UX pattern.
