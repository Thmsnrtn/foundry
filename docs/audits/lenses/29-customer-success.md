# Lens 29 — Customer Success Reviewer Audit

**Auditor perspective:** Customer success reviewer
**Scope:** Post-signup success path, health scoring, churn signals, re-engagement flows
**Date:** 2026-04-16

---

## Executive Summary

Foundry has a **surprisingly sophisticated success path for the founder's product** (health scoring, churn signals, re-engagement via behavioral triggers, milestone celebrations, next-action engine). However, it has **no equivalent system for monitoring the health of Foundry's own customer relationship with the founder**. There is no "Foundry customer health score," no churn risk model for founders, no proactive outreach when a founder disengages, and no success milestones tied to Foundry subscription value. The irony is sharp: Foundry builds an autonomous customer success system (the Harbor agent) for the founder's product, but has none for itself.

**P1 findings:** 3
**P2 findings:** 4

---

## Finding 01 — No health scoring for Foundry's own founder-customers

**Severity: P1**
**Files:** `src/services/customers/intelligence.ts` (exists for founder's products, not for Foundry)

The `computeCustomerHealth` function scores the founder's customers based on usage, support, payment, and engagement. This is a robust health scoring model. But there is no equivalent model for scoring whether a *founder* is healthy as a Foundry customer.

Signals that could feed a Foundry founder health score:
- Login recency (available via `last_seen_at` in founders table, updated by auth middleware)
- Decision resolution rate (decisions approved/rejected vs. left pending)
- DNA completion percentage
- Metric submission frequency
- Tour completion
- Digest open rate (not tracked, per Lens 22)
- Active integrations count

These signals exist in the database but are never aggregated into a health score for the founder.

**Impact:** Cannot proactively identify at-risk founders. Churn detection is reactive (they cancel) rather than predictive (they disengage).

**Remediation:**
1. Create a `founder_health_score` computed daily from: login recency (35%), decision engagement (25%), metric submission frequency (20%), DNA completion (10%), integration count (10%).
2. Store snapshots in a `founder_health_snapshots` table.
3. Surface in Founder Ops for the operator.

---

## Finding 02 — No defined success milestones tied to Foundry value

**Severity: P1**
**Files:** `src/services/ux/milestones.ts`

The milestone system tracks product-level achievements (first audit, READY verdict, score improvement). These are valuable but they measure the founder's product progress, not the founder's *realization of Foundry's value*.

Missing Foundry-value milestones:
- "First decision resolved in under 2 hours" (demonstrates decision support value)
- "Weekly digest read for 4 consecutive weeks" (demonstrates intelligence value)
- "Automated PR merged that improved audit score" (demonstrates remediation value)
- "Agent-suggested action executed successfully" (demonstrates autonomous operation value)
- "Time saved: X hours estimated from automated actions this month" (demonstrates ROI)

**Impact:** Founders do not have a clear narrative of "Foundry is saving me time and making me money." Value realization is implicit, not celebrated.

**Remediation:**
1. Define 5-7 Foundry-value milestones that demonstrate the product's ROI.
2. Celebrate these with the existing milestone toast system.
3. Include value milestones in the weekly digest ("This week, Foundry saved you an estimated 4 hours").

---

## Finding 03 — No proactive re-engagement when founders disengage

**Severity: P1**
**Files:** `src/services/triggers/behavioral.ts`

The behavioral trigger system has 4 triggers, all focused on onboarding stalls:
1. `stuck_at_github` (24h without GitHub connect)
2. `stuck_at_repo` (24h without repo selection)
3. `audit_no_action` (7d without action after audit)
4. `decisions_growing` (3+ decisions pending for 5+ days)

There are no triggers for ongoing engagement decay:
- No trigger for "founder has not logged in for 14 days"
- No trigger for "founder has not submitted metrics for 3 weeks"
- No trigger for "founder ignored last 3 weekly digests" (not trackable -- see Lens 22)
- No trigger for "founder's subscription is about to renew but they have not logged in for 30 days"

**Impact:** Disengaged founders churn silently. The system detects stalled onboarding but not stalled ongoing usage.

**Remediation:**
1. Add re-engagement triggers:
   - `inactive_14d`: "Your product intelligence is waiting -- here's what your agents found while you were away."
   - `no_metrics_21d`: "Foundry is operating with stale data. Submit your latest metrics to keep stressor detection accurate."
   - `renewal_inactive`: (7 days before billing cycle, if no login in 30d) "Your Foundry subscription renews on {date}. Here's what your SCP team delivered this month."
2. Track trigger effectiveness (see Lens 22, Finding 05).

---

## Finding 04 — The "Your Move" next-action engine is excellent but has no escalation

**Severity: P2**
**Files:** `src/services/ux/next-action.ts`

The `getNextAction` function is a well-designed priority queue that surfaces the single most important action for the founder. The priority order (red risk > yellow risk > critical stressor > overdue decisions > pending decisions > DNA incomplete > open PRs > stale audit > missing metrics > competitive signal > all clear) is thoughtful.

However, it only surfaces *one* action. If the founder ignores it, the same action stays at the top indefinitely with no escalation:
- No "this has been your top action for 7 days" increased urgency
- No email notification when a top action goes stale
- No alternative pathway if the founder cannot or will not take the suggested action

**Impact:** Persistent ignored actions become invisible (banner blindness). The system nags but does not escalate.

**Remediation:**
1. Track how long each next-action has been the top action.
2. After 7 days, escalate urgency visually (change from normal to elevated styling).
3. After 14 days, send an email: "Your #1 action has been waiting 14 days."
4. Offer a "snooze" or "not now" option that rotates to the next action.

---

## Finding 05 — No cancellation survey or exit interview

**Severity: P2**
**Files:** `src/services/billing/stripe.ts`, `src/routes/dashboard/settings.ts`

When a founder cancels via the Stripe billing portal, the subscription is deleted via webhook. There is no:
- Pre-cancellation survey ("What could we do better?")
- Cancellation reason categorization (too expensive, not using, missing features, switching to competitor)
- Last-chance offer (downgrade to free/limited tier)
- Exit interview prompt

The `settings/manage-subscription` route redirects directly to Stripe's billing portal, which handles the cancellation flow. There is no Foundry-controlled interstitial.

**Impact:** Zero qualitative data on why founders churn. Cannot prioritize product improvements based on churn reasons.

**Remediation:**
1. Intercept the cancellation flow with a Foundry-controlled page before redirecting to Stripe.
2. Ask a required single-question survey: "What is the primary reason you're cancelling?"
3. Offer alternatives: downgrade, pause, or a 1-on-1 call with the founder.
4. Store cancellation reasons in a `founder_churn_events` table.

---

## Finding 06 — Onboarding tour can be skipped with no follow-up

**Severity: P2**
**Files:** `src/services/ux/tour.ts`

The `skipTour` function records `skipped_at` in the database, but there is no follow-up mechanism:
- No "You skipped the tour -- here's a quick guide" email
- No re-offer of the tour on the next login
- No contextual tooltips that replace the tour for skippers
- No tracking of whether skippers have lower engagement than completers

**Impact:** Founders who skip the tour may miss critical concepts (what the Signal means, how decisions work, what Product DNA unlocks) and disengage due to confusion.

**Remediation:**
1. If the tour was skipped, show contextual one-line hints on each page for the first 3 visits (the page hint system already exists -- use it).
2. Offer to restart the tour from settings.
3. Track skip-vs-complete rates and correlate with 30-day retention.

---

## Finding 07 — The Founding Story is a hidden success asset

**Severity: P2**
**Files:** `src/services/story/engine.ts`, `src/db/schema.sql` (founding_story_artifacts)

The Founding Story system captures narrative artifacts at key moments (first audit, READY verdict, milestones). This is a genuinely clever feature for investor relations and founder motivation. However:
- There is no "View your Founding Story" page prominently linked in the sidebar (it is under the Journey page, which is not in the primary nav group).
- The story is not referenced in the weekly digest.
- There is no "share your Founding Story" feature for social proof or fundraising.

**Impact:** A valuable success and retention asset is underutilized because founders may not discover it.

**Remediation:**
1. Reference the Founding Story in the weekly digest when new artifacts are captured.
2. Add a monthly "Your Founding Story grew by X chapters this month" email.
3. Make the Journey page more discoverable (primary nav or a link from the dashboard).

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | No health scoring for Foundry's own founder-customers | P1 | `services/customers/intelligence.ts` |
| 02 | No Foundry-value milestones (ROI celebration) | P1 | `services/ux/milestones.ts` |
| 03 | No re-engagement triggers for ongoing disengagement | P1 | `services/triggers/behavioral.ts` |
| 04 | Next-action engine has no escalation for ignored actions | P2 | `services/ux/next-action.ts` |
| 05 | No cancellation survey or exit interview | P2 | `services/billing/stripe.ts` |
| 06 | Tour skip has no follow-up mechanism | P2 | `services/ux/tour.ts` |
| 07 | Founding Story is underutilized as a retention asset | P2 | `services/story/engine.ts` |

---

## Cross-References

- **Lens 27 (Growth strategist):** Findings 03 and 05 here complement the retention and churn findings in Lens 27.
- **Lens 22 (UX researcher):** Health scoring (Finding 01) requires the analytics data identified as missing in Lens 22.
- **Lens 32 (Billing ops):** Cancellation flow (Finding 05) interacts with billing operations.
