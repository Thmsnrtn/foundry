# Lens 48 — Onboarding Specialist Audit

**Auditor perspective:** Onboarding specialist / first-run experience expert
**Scope:** First-run experience from signup through first value moment, onboarding wizard, conversational setup, guided tour, milestone system, contextual hints, time-to-value, friction points, error recovery
**Date:** 2026-04-16

---

## Executive Summary

Foundry has invested significantly in onboarding, offering two parallel paths: a traditional wizard (GitHub connect -> repo select -> competitors -> first audit) and a conversational chat-based setup that aims for first AI briefing in under 10 minutes. Both paths are functional and lead to a clear first-value moment (first audit score or first CEO briefing). The post-onboarding experience is strong: a 10-step guided tour with real audit data, a contextual hints system that adapts per page, and a milestone system that celebrates progress. The conversational onboarding (`/setup`) is the standout -- it uses HTMX for responsive chat, tracks progress through 5 questions, and generates a first briefing from extracted context. Key gaps: error recovery is weak throughout (GitHub OAuth failure shows raw JSON), there is no progress persistence in the traditional wizard (browser back button restarts the flow), the tour has 10 steps (the code comment says "5-step walkthrough" but there are actually 10), and the no-code path creates a product without running SCP provisioning.

**P0 findings:** 0
**P1 findings:** 3
**P2 findings:** 4
**P3 findings:** 4

---

## Finding 01 — GitHub OAuth failure shows raw JSON error

**Severity: P1**
**File:** `src/routes/dashboard/onboarding.ts` (lines 100-101)

When the GitHub OAuth callback fails (missing code, token exchange failure), the route returns raw JSON:

```typescript
if (!code) return c.json({ error: 'Missing code' }, 400);
// ...
if (!tokenData.access_token) return c.json({ error: 'GitHub auth failed' }, 400);
```

A founder who cancels the GitHub authorization flow or encounters a network error during token exchange sees `{"error":"GitHub auth failed"}` in their browser. This is a user-facing route that should render an HTML error page with a "Try Again" button.

**Impact:** Founders who encounter OAuth errors see a technical JSON response with no recovery path. They must manually navigate back to `/onboarding`.

**Remediation:** Return an HTML error page with: a clear error message, a "Try Again" button linking back to `/onboarding`, and a "Continue without GitHub" link to the no-code path.

---

## Finding 02 — No-code path skips SCP provisioning

**Severity: P1**
**File:** `src/routes/dashboard/onboarding.ts` (lines 76-93)

The no-code onboarding path (`/onboarding/create-product`) creates a product and lifecycle state but does not call `provisionSCP` or `ensureProvisioned`. The product is created with no agents, no constitution, and no SCP instance. The founder is redirected to the competitors page and eventually to the audit step, but:

- The audit step requires a GitHub repo for code analysis, which the no-code path does not provide.
- Without SCP provisioning, the product will have no agents, no briefings, and no Signal score.
- The `web_audit_results` table is inserted into but there is no corresponding web-based audit engine.

**Impact:** Founders who use the no-code path get a product with no AI capabilities. The dashboard will show empty states everywhere.

**Remediation:**
1. Call `ensureProvisioned(productId, founder.id)` after product creation in the no-code path.
2. Implement the web-based audit path (using the product URL instead of GitHub repo).
3. If web audit is not yet implemented, redirect no-code users to the conversational setup (`/setup`) instead of the traditional wizard.

---

## Finding 03 — Traditional wizard has no progress persistence

**Severity: P1**
**File:** `src/routes/dashboard/onboarding.ts`

The traditional onboarding wizard passes state through URL parameters (`product_id`) and form submissions. There is no server-side session tracking for the wizard. If a founder:
- Navigates away during the competitors step, they lose their progress.
- Clicks the browser back button after selecting a repo, the repo selection is lost.
- Closes the browser tab during the audit step, they must restart from the beginning.

The conversational onboarding (`/setup`) handles this better with a persistent `onboarding_sessions` table, but the traditional wizard has no equivalent.

**Impact:** Founders who encounter any interruption during the 5-step wizard must restart entirely. The GitHub token (passed as a hidden form field) is lost on navigation.

**Remediation:**
1. Store wizard progress in a `wizard_state` table or the existing `onboarding_sessions` table.
2. On returning to `/onboarding`, resume from the last completed step.
3. Store the GitHub access token in the database immediately after OAuth (which already happens in the select-repo step), not as a form field.

---

## Finding 04 — GitHub access token passed as hidden form field

**Severity: P2**
**File:** `src/routes/dashboard/onboarding.ts` (line 115)

After GitHub OAuth, the access token is passed to the repo selection page as a template variable (`_token: tokenData.access_token`) and rendered in the HTML as a hidden form field. When the founder submits the repo selection form, the token is sent in the POST body.

This means the GitHub access token is:
1. Present in the HTML source of the page (visible via "View Source").
2. Sent in a form POST body (visible in browser dev tools).
3. Potentially logged by any request-logging middleware.

**Impact:** The access token is exposed in the browser context before being stored in the database. If the founder does not complete the wizard, the token is captured by GitHub but never stored, creating a dangling authorization.

**Remediation:** Store the token in the database immediately after OAuth exchange (associated with the founder, not yet with a product). Reference it by a session ID in the form rather than passing the raw token.

---

## Finding 05 — Tour says "5-step" but has 10 steps

**Severity: P2**
**File:** `src/services/ux/tour.ts` (lines 1-4, 17-84)

The file header comment says "5-step walkthrough" but `TOUR_STEPS` defines 10 steps. The `advanceTour` function checks `if (nextStep > TOUR_STEPS.length)` (line 127) which correctly handles all 10 steps, so the logic works. But the metadata is wrong.

Additionally, the `completeTour` function hardcodes `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]` (line 143) rather than generating from `TOUR_STEPS.length`, creating a maintenance hazard if steps are added or removed.

**Impact:** Minor -- the tour functions correctly. But the misleading comment and hardcoded array indicate the system was expanded from 5 to 10 steps without updating all references.

**Remediation:** Update the file header to say "10-step walkthrough." Replace the hardcoded array with `Array.from({length: TOUR_STEPS.length}, (_, i) => i + 1)`.

---

## Finding 06 — Tour step data is only partially populated

**Severity: P2**
**File:** `src/services/ux/tour.ts` (lines 165-202)

`buildTourStepData` populates template variables for steps 1-4 (score, blocking count, risk state, decisions) but not for steps 5-10 (weekly rhythm, navigation, DNA, settings, stressors, completion). Steps 5-10 use static `body_template` strings with no `{variables}`, so they work but are not personalized.

**Impact:** The first 4 tour steps are contextualized with real product data. The last 6 steps are generic text. This creates a noticeable quality drop mid-tour.

**Remediation:** Add contextual variables for steps 5-10:
- Step 5: Insert the founder's actual lifecycle position.
- Step 7: Insert the current DNA completion percentage.
- Step 9: Insert the current stressor count.

---

## Finding 07 — Milestone system fires N+1 queries

**Severity: P2**
**File:** `src/services/ux/milestones.ts` (lines 116-183)

`checkAndAwardMilestones` iterates all 10 milestone definitions. For each:
1. Queries `milestone_events` to check if already awarded (1 query).
2. Calls the milestone's `check` function (1 query each).
3. If awarded, inserts into `milestone_events` (1 query), creates a notification (1 query), and optionally creates a story artifact (1 query).

Best case (all already awarded): 10 queries.
Worst case (all newly awarded): 10 + 10 + 10 + 10 + 4 = 44 queries.

This runs on every audit completion, every decision resolution, and periodically via scheduled jobs.

**Impact:** Performance impact on every milestone check. At 44 queries per invocation, this is noticeable on a remote database like Turso.

**Remediation:** Batch the "already awarded" check into a single query: `SELECT milestone_key FROM milestone_events WHERE founder_id = ? AND product_id = ?`. Then only run `check` for milestones not in the already-awarded set.

---

## Finding 08 — Conversational onboarding has excellent UX (positive finding)

**Severity: P3 (positive)**
**File:** `src/routes/dashboard/onboarding-chat.ts`

The `/setup` chat interface is well-designed:
- Full-page immersive layout with no dashboard chrome (no sidebar, no header navigation).
- Real-time HTMX message exchange without page reload.
- Progress indicator showing "X of 5 questions answered" with animated progress bar.
- Ready-to-brief CTA that appears when 4+ questions are answered.
- Skip button for founders who want to bypass the conversation.
- Auto-scroll to bottom on new messages.
- Escape HTML in user messages (XSS prevention).
- OOB swaps for progress indicator updates without full-page re-render.

This is the strongest UX in the entire codebase.

**Recommendation:** Use this as the primary onboarding path. The traditional wizard should be the fallback, not the default.

---

## Finding 09 — Hint system is page-aware and state-aware (positive finding)

**Severity: P3 (positive)**
**File:** `src/services/ux/hints.ts`

The contextual hints system in `getPageHints` adapts per page and per product state:
- Dashboard: different hints for no-metrics vs. no-stressors vs. first-red-state.
- Audit: different hints for first audit, low composite, wisdom-blocked issues, and READY verdict.
- Decisions: different hints for empty queue vs. overdue decisions.
- DNA: section-specific explanations of what each DNA field unlocks.

Each hint has a type (empty_state, tip, warning, contextual), is dismissible or not, and can include an action link.

**Recommendation:** This is a model for how SaaS products should handle contextual guidance. Document it as a pattern for other parts of the system.

---

## Finding 10 — No error recovery in conversational onboarding

**Severity: P3**
**File:** `src/routes/dashboard/onboarding-chat.ts` (lines 218-220)

When `sendOnboardingMessage` throws an error, the catch block returns:
```typescript
return c.html(html`<div style="color:#ff6b6b;padding:8px;">Something went wrong. Please try again.</div>`);
```

This HTML fragment is appended to the message area via HTMX swap. But there is no retry mechanism -- the founder must type a new message. If the error was an Anthropic API timeout, the founder's original message is lost (it was sent to the server, processed, and the AI call failed, but the message may or may not have been persisted to the session).

**Impact:** Transient AI failures cause message loss in the onboarding conversation.

**Remediation:**
1. Persist the founder's message to the session before calling the AI.
2. On AI failure, return the error with a "Retry" button that re-sends the last message.
3. On page reload, the conversation should show all persisted messages including the failed one.

---

## Finding 11 — First audit blocks the onboarding flow

**Severity: P3**
**File:** `src/routes/dashboard/onboarding.ts` (lines 226-260)

The `POST /onboarding/run-audit` endpoint calls `runAudit` synchronously. This involves: fetching the GitHub repo tree, fetching up to 50 files, sending all file contents to Claude Opus for 10-dimension scoring, and processing the results. This can take 30-60 seconds.

During this time, the founder sees whatever the "running audit" wizard step shows. The response is a redirect to `/dashboard?tour=1`, so the founder waits for the full audit to complete before seeing anything.

**Impact:** 30-60 second blocking wait during onboarding. High risk of the founder closing the tab or thinking the app is broken.

**Remediation:**
1. Return immediately with a "running" state and a progress indicator.
2. Run the audit in the background.
3. Poll for completion via HTMX or redirect to the dashboard with a "first audit in progress" banner.

---

## Time-to-Value Analysis

| Path | Steps | Estimated Time | First Value Moment |
|------|-------|---------------|-------------------|
| Traditional wizard (with GitHub) | 5 steps: OAuth -> repo select -> competitors -> audit -> dashboard | 3-5 min (excluding 30-60s audit wait) | First audit score + tour |
| Traditional wizard (no-code) | 3 steps: product info -> competitors -> ??? | 2-3 min | **No clear value moment** (no audit, no SCP) |
| Conversational setup | 5 questions in chat -> generate briefing | 5-10 min | First CEO briefing |

The conversational path has the longest time but the highest-quality first-value moment. The no-code path has the shortest time but the weakest outcome.

---

## Embarrassment Test

**Would an onboarding specialist be embarrassed by this?** Not embarrassed -- the conversational onboarding and hint system are genuinely impressive. But the raw JSON error on OAuth failure, the broken no-code path, and the blocking audit wait are friction points that would be caught in any user testing session.

## Pride Test

**What would make an onboarding expert proud?** The conversational setup at `/setup` is a best-in-class onboarding experience for a developer-facing product. The contextual hints system that knows what the founder has not done yet and explains why it matters is the kind of intelligent guidance that separates great products from good ones. The milestone system with celebration notifications and founding-story artifact capture creates emotional engagement at exactly the right moments.
