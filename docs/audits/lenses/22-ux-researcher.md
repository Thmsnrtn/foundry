# Lens 22 — UX Researcher Audit

**Auditor perspective:** UX researcher
**Scope:** User research mechanisms, feedback loops, analytics integration, NPS collection, learning from users
**Date:** 2026-04-16

---

## Executive Summary

Foundry has **zero mechanisms to learn from its own users**. There is no product analytics on Foundry itself (no page-view tracking, no funnel instrumentation, no feature adoption metrics). There is no in-app feedback mechanism, no NPS survey, no user interview pipeline, and no session recording. The only feedback signal is implicit: whether a founder resolves decisions and submits metrics. The behavioral trigger system and AI calibration service show awareness that user behavior matters, but neither feeds back into product decisions -- they only optimize the AI output for the individual founder.

**P0 findings:** 1
**P1 findings:** 3
**P2 findings:** 3

---

## Finding 01 — No product analytics on Foundry itself

**Severity: P0**
**Files:** `src/views/layout.ts`, `src/index.ts`

The HTML layout includes no analytics snippet -- no PostHog, no Plausible, no Google Analytics, no Mixpanel, no Amplitude, no Segment. The layout template has zero tracking scripts beyond HTMX and the service worker. There is a PostHog integration (`src/services/integration/posthog.ts`), but it pulls analytics from the **founder's product**, not from Foundry itself.

This means there is no data on:
- Which dashboard pages founders visit (or never visit)
- How long they spend on the Decision Chamber
- Whether they complete onboarding
- Funnel conversion (signup -> GitHub connect -> audit -> first decision)
- Feature adoption rates (e.g., what percentage use Product DNA, competitive intel, scenarios)

**Impact:** Product decisions are made blind. Cannot answer "what features do founders actually use?" or "where do they drop off in onboarding?"

**Remediation:**
1. Add a lightweight, privacy-respecting analytics tool (PostHog or Plausible) to the layout template.
2. Instrument key events: page views, decision resolutions, tour completion, DNA completion, query bar usage.
3. Build a product dashboard (internal) showing adoption funnels.

---

## Finding 02 — No in-app feedback mechanism

**Severity: P1**
**Files:** Entire codebase (absence)

There is no feedback button, no satisfaction survey, no thumbs-up/down on AI outputs, no "was this helpful?" prompt on briefings, and no contact/support form. The only way a founder can communicate dissatisfaction is by churning.

The AI calibration service (`src/services/ai/calibration.ts`) has a `recordFeedback` function that tracks whether founders interact positively with AI outputs, but this is implicit (based on behavioral signals like response length patterns), not explicit feedback.

**Impact:** No qualitative signal on product quality. Cannot detect confusion, frustration, or unmet needs until they manifest as churn.

**Remediation:**
1. Add a persistent feedback widget (e.g., small floating button) or contextual "Was this helpful?" on AI-generated content (briefings, insights, decisions).
2. Store feedback in a `product_feedback` table with page context.
3. Surface feedback in Founder Ops for the operator.

---

## Finding 03 — No NPS or satisfaction measurement for Foundry's own users

**Severity: P1**
**Files:** `src/db/schema.sql` (metric_snapshots table)

The schema has an `nps_score` field in `metric_snapshots`, but this tracks the **founder's product NPS** (their customers), not Foundry's NPS from founders. There is no mechanism to ask founders "How likely are you to recommend Foundry?"

**Impact:** Cannot benchmark founder satisfaction. Cannot detect trending dissatisfaction before it becomes churn. No data for investor reporting on customer health.

**Remediation:**
1. Implement a periodic (monthly or quarterly) in-app NPS prompt after the founder has been active for 14+ days.
2. Store responses and track trend over time.
3. Use NPS as a leading indicator for churn risk in billing cohort analysis.

---

## Finding 04 — No onboarding completion tracking or funnel analysis

**Severity: P1**
**Files:** `src/routes/dashboard/onboarding.ts`, `src/services/ux/tour.ts`

The tour system (`onboarding_tour` table) tracks whether a founder completed or skipped the tour, and there is `onboarding_completed_at` on the founders table. However:
- There is no timestamp for each onboarding step (GitHub connect, repo select, competitors, first audit). Only the final audit redirect triggers `onboarding_completed_at`.
- There is no "abandoned onboarding" detection beyond the behavioral trigger emails that fire after 24 hours.
- There is no aggregate view of onboarding funnel metrics (what percentage drop off at GitHub connect vs. repo selection vs. audit).

**Impact:** Cannot optimize the onboarding funnel. Cannot identify which step causes the most drop-off.

**Remediation:**
1. Record timestamps for each onboarding step in a `founder_onboarding_steps` table.
2. Build an aggregate funnel query for Founder Ops.
3. Use the data to prioritize onboarding improvements (e.g., if 40% drop off at GitHub, prioritize the no-code path).

---

## Finding 05 — Behavioral triggers are fire-and-forget with no effectiveness tracking

**Severity: P2**
**Files:** `src/services/triggers/behavioral.ts`

The behavioral trigger system sends emails when founders stall (24h without GitHub, 7d without action after audit), but:
- There is no tracking of whether the email was opened or the founder returned.
- There is no A/B testing infrastructure for trigger email content.
- Trigger effectiveness is not measured (did sending the email correlate with the founder completing the action?).

**Impact:** Cannot tell if behavioral triggers are working or if they are spam that degrades founder trust.

**Remediation:**
1. Track trigger outcomes: did the founder take the target action within 48h of the trigger firing?
2. Record open/click rates via Resend's webhook callbacks.
3. Use outcome data to tune trigger timing and content.

---

## Finding 06 — AI calibration feedback is implicit only

**Severity: P2**
**Files:** `src/services/ai/calibration.ts`

The calibration service infers preferences from behavioral signals (response length acceptance, follow-up patterns) and adjusts AI output style. This is a good implicit feedback loop. However:
- There is no explicit "rate this response" mechanism.
- The calibration only affects communication style (length, jargon level, directness), not content quality or relevance.
- There is no way for founders to correct factual errors in AI outputs.

**Impact:** AI quality issues go undetected. If the AI gives bad advice in a briefing, there is no mechanism to surface that.

**Remediation:**
1. Add a thumbs-up/thumbs-down on AI-generated content (briefings, insights, decision recommendations).
2. Log negative ratings with context for quality review.
3. Feed explicit ratings into the calibration system alongside implicit signals.

---

## Finding 07 — No session recording or heatmap capability

**Severity: P2**
**Files:** Entire codebase (absence)

There is no session recording tool (FullStory, Hotjar, PostHog recordings) and no heatmap capability. For a server-rendered HTMX application, understanding how founders navigate the UI is especially important because traditional SPA analytics patterns do not apply.

**Impact:** Cannot observe real user behavior. UX decisions are made on assumption rather than observation.

**Remediation:**
1. Consider PostHog session recordings (already a known integration pattern in the codebase).
2. Focus recordings on key flows: onboarding, Decision Chamber, Product DNA completion.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | No product analytics on Foundry itself | P0 | `views/layout.ts` |
| 02 | No in-app feedback mechanism | P1 | Entire codebase |
| 03 | No NPS measurement for Foundry's users | P1 | `db/schema.sql` |
| 04 | No onboarding funnel analysis | P1 | `routes/dashboard/onboarding.ts` |
| 05 | Behavioral triggers have no effectiveness tracking | P2 | `services/triggers/behavioral.ts` |
| 06 | AI calibration is implicit only, no explicit feedback | P2 | `services/ai/calibration.ts` |
| 07 | No session recording or heatmap capability | P2 | Entire codebase |

---

## Cross-References

- **Lens 30 (Analytics reviewer):** Directly related -- Lens 22 covers user research mechanisms while Lens 30 covers internal analytics instrumentation.
- **Lens 29 (Customer success):** Feedback loops are a prerequisite for customer success health scoring.
- **Lens 27 (Growth strategist):** Funnel analytics (Finding 04) are a prerequisite for growth optimization.
