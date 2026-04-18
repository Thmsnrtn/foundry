# Lens 086 — Customer Onboarding Friction

**Distinct value:** Maps every click, wait, confusion point, and dead-end from signup to first value (first AI briefing). Measures time-to-value, step count, required information, and abandonment risk surfaces. No other lens walks the literal user journey step by step.

**Tenancy-critical:** No. Onboarding is single-product at time of first use. Fleet concerns (adding second product) are a separate flow gated by tier.

## Executive Summary

The signup-to-first-briefing path requires **a minimum of 12 discrete interactions** across 3 distinct UI surfaces (Clerk signup, onboarding chat, dashboard tour), with two external dependencies (Clerk CDN, Anthropic API) that can each independently stall the flow. The conversational onboarding chat is a genuine differentiator — it collects business context naturally rather than through a form. However, the path has 5 friction points that will cause real abandonment: (1) Clerk JS loads from a CDN with no loading indicator, (2) the Clerk webhook race condition can leave a founder with no DB record for several seconds, (3) the onboarding chat has no progress indicator showing how many questions remain, (4) the first briefing generation blocks the user with no skeleton/progress feedback while Claude runs (potentially 30+ seconds), and (5) GitHub OAuth is introduced but not required, creating confusion about whether it is mandatory.

## Findings

### ONB-01 Clerk JS CDN Load Has No Loading Indicator
- **Severity:** P1
- **Description:** The signup page (`/auth/signup`) mounts Clerk via a dynamic import from `cdn.jsdelivr.net`. Until the JS loads (~1-3 seconds on typical connections), the user sees an empty `<div id="sign-up">` with a fixed `min-height: 400px`. There is no spinner, skeleton, or loading text. On slow connections or CDN issues, the page appears broken. The error handler (`initClerk().catch(...)`) only fires on complete failure, not on slow loads.
- **Evidence:** `src/routes/auth/clerk.ts:28-49` — empty `#sign-up` div with no loading state. The `initClerk()` function has no timeout; it waits indefinitely for the CDN import.
- **Remediation:** Add a CSS-only loading spinner inside the `#sign-up` div that Clerk's `mountSignUp` replaces on mount. Add a 10-second timeout that shows a "Still loading..." message with a refresh link.
- **Impact:** First impression of the product. Users on mobile or degraded networks will see a blank page and leave.

### ONB-02 Clerk Webhook Race Condition Creates "Ghost Founder" Window
- **Severity:** P1
- **Description:** After Clerk signup completes, the user is redirected to `/dashboard`. The `forceRedirectUrl: "/dashboard"` fires immediately on Clerk's client side. However, the founder DB record is created by the Clerk webhook (`/auth/webhook` handling `user.created`), which is an asynchronous POST from Clerk's servers. The auth middleware (`src/middleware/auth.ts`) handles this with auto-provisioning (creating the founder record if the webhook has not arrived yet), but this race creates a window where the middleware must do extra work, and if auto-provisioning fails, the user sees an error on their first page load.
- **Evidence:** `src/routes/auth/clerk.ts:159-193` — webhook creates founder record asynchronously. `src/middleware/auth.ts` — auto-provisioning fallback. No retry or queue mechanism if both paths fail simultaneously.
- **Remediation:** The auto-provisioning fallback is the right pattern. Add a simple retry loop (3 attempts, 500ms delay) in the middleware's auto-provisioning path to handle the case where the DB write conflicts with the arriving webhook. Log a warning metric when auto-provisioning fires so you can measure webhook lag.

### ONB-03 Onboarding Chat Has No Progress Indicator
- **Severity:** P2
- **Description:** The onboarding chat (`src/services/scp/onboarding/chat.ts`) aims for 5-7 messages to collect: company name, problem, solution, target customer, revenue model, stage, biggest challenge, and north star metric. The `countAnsweredQuestions()` function tracks 5 key fields (solution, target_customer, stage, biggest_challenge, revenue_model). But the UI shows no progress bar, no "3 of 5 questions answered" indicator, and no estimated time remaining. The user has no idea how long the conversation will take.
- **Evidence:** `src/services/scp/onboarding/chat.ts:123-128` — `countAnsweredQuestions()` exists but is not surfaced in the UI. The `sendOnboardingMessage()` response includes `extractedContext` but no progress percentage.
- **Remediation:** Add a `progress` field to the `sendOnboardingMessage` response: `progress: countAnsweredQuestions(updatedContext) / 5`. Render a progress bar in the chat UI. Show "Almost there! One more question..." when 4/5 complete.

### ONB-04 First Briefing Generation Blocks With No Feedback
- **Severity:** P1
- **Description:** When the onboarding chat completes, `generateFirstBriefingFromContext()` is called. This function: (1) upserts product DNA, (2) updates the product name, (3) creates a synthetic metric snapshot, and (4) calls `generateDailyBriefing()` which invokes Claude. The Claude call alone can take 10-30 seconds. During this time, the user sees nothing — no skeleton, no "Your AI team is analyzing your business..." message. The function returns a URL path (`/agents/briefings/{date}`) but the user is waiting for the POST to complete.
- **Evidence:** `src/services/scp/onboarding/chat.ts:270-347` — `generateFirstBriefingFromContext()` is synchronous from the caller's perspective. The `generateDailyBriefing()` call within it invokes Claude Sonnet. No streaming, no progress callback.
- **Remediation:** Return a "generating" status immediately with a polling endpoint. Fire `generateFirstBriefingFromContext()` in the background. The UI polls every 2 seconds until the briefing is ready. Show an animated "Your AI team is assembling..." state during the wait.

### ONB-05 GitHub OAuth Presented But Purpose Unclear
- **Severity:** P2
- **Description:** The onboarding flow includes GitHub OAuth for repository connection (needed for the 8-step audit pipeline). However, the onboarding chat does not mention GitHub at all. The GitHub connection likely appears in a separate settings or onboarding step, but its relationship to the chat flow is disconnected. A founder who skips GitHub connection can still reach the dashboard but will have no audit data, no remediation PRs, and a degraded experience — yet there is no clear explanation of what they are missing.
- **Evidence:** `src/routes/dashboard/onboarding.ts` — handles GitHub OAuth flow with `encrypt`/`decrypt` for tokens. `src/services/scp/onboarding/chat.ts` — no mention of GitHub in the system prompt or conversation flow.
- **Remediation:** After the chat completes and the first briefing is generating, show a "Connect GitHub to unlock code audits and automated fixes" step with a clear explanation of what it enables and what the founder misses without it. Make it skippable but prominent.

### ONB-06 Skip Onboarding Drops Context Without Warning
- **Severity:** P2
- **Description:** The `skipOnboarding()` function simply marks the session as `'skipped'` and returns. No product DNA is populated, no synthetic metrics are created, and no briefing is generated. The founder lands on a dashboard with zero data, zero agents running, and no guidance on what to do next. The tour (`src/services/ux/tour.ts`) depends on audit data that does not exist if onboarding was skipped.
- **Evidence:** `src/services/scp/onboarding/chat.ts:351-358` — `skipOnboarding()` is a 3-line function that sets status to 'skipped'. No downstream actions. `src/services/ux/tour.ts:25-26` — Step 1 expects `{score}` from audit data.
- **Remediation:** Either remove the skip option entirely (the chat takes 2 minutes, there is no reason to skip) or have skip trigger a minimal-context setup: create placeholder DNA fields, generate a skeleton briefing, and show a "Complete your setup for better results" persistent banner.

### ONB-07 10-Step Tour Is Too Long For First Visit
- **Severity:** P3
- **Description:** The guided tour (`src/services/ux/tour.ts`) has 10 steps covering audit score, blocking issues, risk state, decisions, weekly rhythm, navigation, product DNA, settings, stressors, and a completion message. Research shows guided tours over 5 steps have >60% abandonment. The tour also depends on real data (audit score, blocking issues, risk state) that may not exist on the first visit if the audit has not completed yet.
- **Evidence:** `src/services/ux/tour.ts:17-84` — 10 `TourStep` entries. Steps 1-4 reference real audit data. `buildTourStepData()` at line 166 handles null `composite` but the resulting template text will say "Your composite score is /10" with no score value.
- **Remediation:** Reduce to 5 essential steps. Defer steps that depend on data that does not exist yet. Show contextual tooltips on first use of each feature rather than a sequential walkthrough.

## Step-by-Step Flow Map

```
1. [Landing page] → Click "Start Free" → /auth/signup
2. [Signup page] → Wait for Clerk JS CDN load (1-3s, no indicator)
3. [Clerk form] → Enter email + password (or OAuth)
4. [Clerk verify] → Email verification (if email signup)
5. [Redirect] → /dashboard (webhook race condition window)
6. [Dashboard] → Auto-redirect to /onboarding (if zero products)
7. [Onboarding] → Create product (name entry)
8. [Chat] → 5-7 conversational exchanges (2-4 minutes)
9. [Briefing gen] → Wait for Claude (10-30s, no indicator)
10. [Briefing view] → First value delivery
11. [Tour start] → 10-step guided walkthrough
12. [GitHub OAuth] → Optional, separate flow
```

**Minimum time to first value:** ~5-8 minutes (optimistic, no errors).
**Realistic time with friction:** ~10-15 minutes including verification, slow CDN, and briefing generation wait.

## Positive Findings

- The conversational onboarding chat is genuinely differentiated. It feels natural and collects rich context that forms the basis of Product DNA. The system prompt is well-crafted.
- The `hasMinimumContext()` gate (problem + solution + target_customer + stage) ensures the briefing has enough data to be useful.
- The CONTEXT_JSON extraction pattern is clever — it extracts structured data from natural conversation without forcing the founder into a form.
- Auto-provisioning in the auth middleware handles the webhook race correctly in the common case.
