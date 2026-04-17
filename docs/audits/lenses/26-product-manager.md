# Lens 26 — Product Manager Audit

**Auditor perspective:** Product-market fit, user journeys, feature completeness, onboarding experience, time-to-value, activation metrics.
**Date:** 2026-04-16

---

## Executive Summary

Foundry has a compelling core value proposition — "connect your product, get a company" — and the landing page communicates it with unusual clarity. The Signal-centric dashboard, Decision Chamber, and agent evolution engine form a genuinely differentiated product loop. However, the product suffers from three structural problems that will kill conversion and retention:

1. **The "Get Started Free" button on the landing page is a lie.** There is no free tier. Users who sign up hit a paywall before seeing any value.
2. **SCP agents are not provisioned during onboarding.** After completing a 5-step onboarding flow and waiting 2-5 minutes for an audit, the founder lands on a dashboard with zero agents, zero briefings, and a manual "Set up your AI team" button. The core promise — "your product gets a team" — is not delivered at onboarding completion.
3. **The sidebar has 25+ navigation items across 6 sections.** For a product that promises simplicity ("one number, three sentences, one query bar"), this is a feature graveyard that will overwhelm new users within minutes.

---

## Journey 1: Signup to First Value (Time-to-Value Analysis)

### Path Traced
`Landing → /auth/signup (Clerk) → /dashboard (redirect → /onboarding) → Connect GitHub → Select Repo → Identify Competitors → Run Audit (2-5 min) → /dashboard?tour=1`

### Step-by-Step Assessment

| Step | Time | Friction | Notes |
|------|------|----------|-------|
| Landing page | 30s | Low | Clear messaging. "Give Your Product a Team" is strong. |
| CTA: "Get Started Free" | 0s | **P0: MISLEADING** | No free tier exists. Signup leads to Clerk auth, then to features gated behind $79+/mo. |
| Clerk signup | 1-2 min | Low | Standard Clerk widget. Redirects to /dashboard. |
| Dashboard redirect | 0s | None | No products → redirects to /onboarding. Good. |
| Connect GitHub (Step 1) | 1 min | Medium | Two paths: GitHub OAuth or URL-based ("no code"). Good. |
| Select Repo (Step 2) | 30s | Low | Repos rendered as buttons. Simple. |
| Identify Competitors (Step 3) | 1-2 min | Medium | Optional (skippable). Good. Only asks for names, not deep info. |
| Run Audit (Step 4) | **2-5 min** | **P1: HIGH** | Synchronous wait. No progress indicator. No loading animation. User stares at a button that says "Run Audit" then a full-page block. |
| Dashboard (post-audit) | 0s | **P1: CONFUSION** | Tour starts, but agents are NOT provisioned. Dashboard shows Signal score but no briefing, no agents, no decisions. The CEO Briefing card is empty. |

### Findings

**F-01 (P0): "Get Started Free" is false advertising.**
The landing page CTA says "Get Started Free" (`/auth/signup`). The pricing page has no free tier. The tier-gate middleware maps `tier === null` to "Free Trial" display label but `canAccess()` returns `false` for ALL gated features when tier is null. The only features accessible without a subscription are the core dashboard routes (`audit`, `dashboard`, `decisions`, `lifecycle`, `digest`) — but the FEATURE_GATES config lists these as requiring `['solo', 'growth', 'investor_ready']` tiers. This means a user with no subscription can access them (since `requireTier` middleware is not applied to every route), but the product experience is undefined for tier-null users. There is no explicit free trial period, no trial-to-paid conversion flow, and no visibility into what happens when a "Free Trial" user tries to do anything.

**File:** `src/routes/public/landing.ts:136`, `src/middleware/tier-gate.ts:50-52`, `src/middleware/tier-gate.ts:155`

**F-02 (P1): Agents are NOT provisioned during onboarding.**
After the audit completes, the user is redirected to `/dashboard?tour=1`. The onboarding flow (`src/routes/dashboard/onboarding.ts`) never calls `provisionSCP()`. SCP provisioning only happens in two places: (1) `POST /agents/provision` (manual button click on the Agent Roster page), and (2) server startup (`src/index.ts:476-491`, which provisions for existing products). This means a brand-new user who just completed onboarding will see the Agent Roster page with a "Set up your AI team" button and zero agents. The landing page promised "Connect your product. Get a company." The reality is: connect your product, get an audit score, then find a manual button buried in a sidebar to provision agents.

**File:** `src/routes/dashboard/onboarding.ts:226-260` (no provisionSCP call), `src/routes/dashboard/agents.ts:136-155` (manual provision button)

**F-03 (P1): Audit step is synchronous with no progress feedback.**
The "Run Audit" step (`POST /onboarding/run-audit`) calls `runAudit()` synchronously, which involves an 8-step GitHub analysis pipeline and a Claude Opus 10-dimension scoring call. This takes 2-5 minutes. The only UI is a static "This usually takes 2-5 minutes" message and a submit button. There is no progress bar, no streaming updates, no skeleton loader, and no background polling. If the AI call fails (no retry, no circuit breaker per the orientation doc), the user gets a raw error.

**File:** `src/routes/dashboard/onboarding.ts:226-260`, `src/views/components.ts:755-765`

**F-04 (P1): Competitor skip link is broken for the no-code path.**
The "Skip" button on the competitor identification step links to `/onboarding/run-audit?product_id=${productId}` — but `/onboarding/run-audit` is a POST endpoint, and there is no GET handler for it. The skip link will 404. The no-code path (`/onboarding/create-product`) redirects to `/onboarding/competitors?product_id=${productId}`, so no-code users must either enter competitors or hit a broken skip link.

**File:** `src/views/components.ts:750` (skip link as `<a href>` to a POST-only route)

---

## Journey 2: Daily Founder Workflow

### Expected Loop (per landing page)
"Open Foundry → Read CEO briefing → Approve/reject decisions → Move on with your day."

### Actual Loop
1. Open `/dashboard` → See Signal score (0-100), daily insight, stressor report.
2. Check CEO Briefing card → Only shows if `getLatestBriefing()` returns data (requires SCP agents to have run at least one cycle).
3. Click "X decisions waiting" → Navigate to `/decisions`.
4. Click individual decision → Enter Decision Chamber (focused layout).
5. Optionally: Ask a question in the query bar → Calls `/api/ask` (AI-powered).

### Findings

**F-05 (P2): The CEO Briefing link goes to Agent Roster, not to the briefing.**
On the dashboard, the CEO Briefing card has a link: `Agent Roster -->` (`/agents`). The actual briefing content is at `/agents/briefings/latest`. This misdirects founders who want to read more detail. The sidebar has "Briefing" as a primary nav item pointing to `/agents/briefings/latest`, but the dashboard card does not.

**File:** `src/routes/dashboard/index.ts:208`

**F-06 (P2): Query bar has no type-ahead, no suggested questions, and no empty-state guidance.**
The "Ask anything about your business" query bar is a powerful feature, but for new users with no data, it will return unhelpful answers. There are no example questions, no "Try asking..." hints, and no indication of what the AI can actually answer. For a product that positions the query bar as 1 of 3 core elements ("one number, three sentences, one query bar"), this is under-invested.

**File:** `src/routes/dashboard/index.ts:218-229`

**F-07 (P2): Daily insight is collapsed by default.**
The "Today's focus" daily insight is rendered inside a `<details>` element, meaning it is collapsed and invisible unless the user explicitly clicks to expand it. For the single most actionable piece of daily guidance, this should be visible by default.

**File:** `src/routes/dashboard/index.ts:191-201`

---

## Journey 3: Decision Approval Flow

### Path Traced
`Dashboard → /decisions (queue) → /decisions/:id (Decision Chamber) → Resolve or Reflect`

### Assessment

This is the strongest user journey in the product. The Decision Chamber is genuinely well-designed:

- **Focused layout** (no sidebar, dedicated `chamberLayout`).
- **Structured resolution** with chosen option + reasoning fields.
- **AI reflection** ("What are you most uncertain about?" → "Get clarity" button → AI response).
- **Scenario models** (best/base/stress case visualization).
- **Cross-product patterns** ("67% of similar decisions had positive outcomes at this stage").
- **Outcome logging** with valence tracking (Worked / Mixed / Didn't work).
- **Decision Intelligence analytics** page with speed-vs-quality analysis.
- **Gate 3 enforcement** (requires reasoning for high-stakes decisions).

### Findings

**F-08 (P2): Empty decision queue has no proactive guidance.**
When there are zero pending decisions, the `decisionList([])` component renders whatever the default empty state is. There is no explanation of how decisions get generated (agents propose them), no timeline for when to expect the first decision, and no link to the agent roster to check agent status.

**F-09 (P3): Resolved decisions show "outcome log" form but no prompt to return.**
After resolving a decision, the user is redirected to `/decisions` after a 1-second delay. But for resolved decisions with no outcome logged yet, the outcome logging form is shown inline on the detail page. There is no reminder system to prompt founders to return and log outcomes. Decision Intelligence quality depends entirely on outcome data, but there is no mechanism to surface "You have 5 decisions from last month with no outcomes logged."

---

## Journey 4: Multi-Product Management (Investor-Ready Tier)

### Path Traced
`/dashboard → redirect to /portfolio (if >1 product and no cookie) → Select product → /dashboard (single-product view)`

### Assessment

The portfolio view is minimal but functional:
- Products sorted by Signal score (lowest/most-urgent first).
- Each product card shows Signal score, name, and first-sentence prose.
- Clicking a card sets a cookie and redirects to the single-product dashboard.
- Product switcher in the header (dropdown `<select>`) allows switching without returning to portfolio.

### Findings

**F-10 (P1): Pricing page says Growth tier gets "1 company" but product limit code says `growth: 1`.**
The pricing page feature list for Growth ($199/mo) does not mention a product limit at all. Solo says "1 company." Growth's differentiator is integrations, team mode, and intelligence network. But the `productLimits` map in `onboarding.ts:125-129` limits Growth to 1 product, same as Solo. Meanwhile, the pricing page for Investor-Ready says "Up to 5 companies." This creates a confusing situation: Growth costs $120 more than Solo but gets the same product limit. The FEATURE_GATES config has `multi_product` gated to `investor_ready` only, confirming Growth cannot have multiple products. This should be made explicit on the pricing page, or Growth should support 2-3 products to justify the price.

**File:** `src/routes/dashboard/onboarding.ts:125-129`, `src/routes/public/landing.ts:168-181`

**F-11 (P1): Portfolio page has no cross-product intelligence.**
The portfolio view only shows Signal scores per product. There is no aggregate health view, no cross-product trend comparison, no fleet-level recommendations. The orientation doc confirms: "Cross-company intelligence: No." For founders paying $399/mo for Investor-Ready, this is a thin experience. The `multi_product` value proposition is "manage multiple products" but the only thing you can do is switch between them.

**File:** `src/routes/dashboard/portfolio.ts`

---

## Journey 5: Billing Upgrade

### Path Traced
`/settings → Stripe Checkout → Webhook → Tier update → Feature unlock`

### Assessment

- Settings page shows current plan with upgrade buttons.
- Checkout creates a Stripe customer if needed, then redirects to Stripe Checkout.
- Webhook handles `checkout.session.completed` and `customer.subscription.deleted`.
- Gate pages (shown when accessing tier-locked features) are well-designed: they show a wireframe preview of the feature, an explanation of what it does, and an "Upgrade Plan" CTA.

### Findings

**F-12 (P1): No upgrade path is shown from within gated features contextually.**
The gate page redirects to `/settings` for all upgrades, regardless of which feature triggered the gate. There is no deep-link to a specific tier checkout. A founder who clicks "Remediation Engine" and hits a gate page has to: click "Upgrade Plan" → land on Settings → find the right upgrade button → click it → enter Stripe. This is 4 clicks to upgrade. The gate page should include a direct checkout button for the minimum required tier.

**File:** `src/middleware/tier-gate.ts:90, 137`

**F-13 (P2): Settings page upgrade buttons disappear after subscription.**
If `founder.tier` is truthy (i.e., they have any subscription), the Solo/Growth/Investor-Ready buttons are hidden. Only the "Upgrade to Investor Ready" button shows for non-investor-ready tiers, and "Manage Subscription" for existing Stripe customers. There is no way for a Solo user to see the Growth tier option — they can only jump straight to Investor-Ready.

**File:** `src/routes/dashboard/settings.ts:81-91`

---

## Feature Coherence Assessment

### Navigation Surface Area

The sidebar contains **25+ items across 6 sections**: Signal, Briefing, Decide, Actions, Roster, Debate, Accuracy, Transparency, Intelligence, Scenarios, Investor Board, Exit, Weekly Brief, Multi-Modal, Network, Memory, Competitive, Standing Orders, Ambient, ROI, Benchmarks, Privacy, Settings, Audit Log, Playbooks, Revenue, Product DNA.

**F-14 (P1): The sidebar is a feature graveyard.**
At least 8 of these items are Investor-Ready-gated but still visible in the sidebar for Solo users (they may or may not show a lock icon depending on implementation). The grouping is unclear — why is "Debate" under Agents but "Scenarios" under Forward? Why is "ROI" under Autonomy? A Solo founder paying $79/mo will see ~25 nav items, most of which either have no data or are locked behind higher tiers. This will make the product feel empty and overwhelming simultaneously.

**F-15 (P1): Hardcoded admin-only nav item exposed in sidebar.**
The sidebar contains a conditional item: if `founderEmail === 'thmsnrtn@gmail.com'`, show "Founder Ops" link. This is a hardcoded admin check against a specific email address in client-rendered HTML. Beyond the security concern (other lenses will flag), from a product perspective this means the admin experience is not a proper role — it is a hack that will break if the founder changes their email.

**File:** `src/views/layout.ts:316`

---

## Onboarding Experience Rating

| Criterion | Score | Notes |
|-----------|-------|-------|
| Time to first value | 3/10 | 5-10 min to audit, but no agents, no briefing, no decisions at completion. Real value takes 24+ hours (first SCP cycle). |
| Clarity of next steps | 4/10 | Tour exists (6 steps) but fires before agents are provisioned, so references to features that don't exist yet. |
| Progress visibility | 3/10 | Wizard has step indicators (1-4) but no progress after onboarding. No "Your agents are learning" status. |
| Error recovery | 2/10 | Audit failure = raw error. GitHub auth failure = JSON `{ error: 'GitHub auth failed' }`. No retry. |
| No-code path completeness | 5/10 | URL-based onboarding exists but competitors skip link is broken (F-04) and no audit runs for URL-only products. |
| Activation milestone clarity | 4/10 | Milestones system exists but is not surfaced during onboarding. User has no idea what "activated" means. |

---

## Value Proposition Alignment

| Landing Page Promise | Reality |
|---------------------|---------|
| "Get a company" with 12 AI agents | Agents require manual provisioning after onboarding |
| "They operate...while you sleep" | Hourly execution only runs in production; agents start at maximum oversight (Level 2) |
| "Every morning, one briefing" | Briefing only generates after SCP scheduler runs; no briefing on Day 1 |
| "Get Started Free" | No free tier; $79/mo minimum |
| Agent evolution + golden lessons | Well-implemented; this promise is delivered |
| Decision queue with scenario models | Well-implemented; this promise is delivered |

---

## Recommendations (Priority-Ordered)

### P0 — Must fix before any marketing

1. **Remove "Get Started Free" or implement a real free trial.** Either add a 14-day trial period (set `trial_ends_at` on founder record, gate after expiry) or change the CTA to "Get Started" / "Start Your 14-Day Trial" / "See Pricing."

### P1 — Must fix before users encounter these paths

2. **Auto-provision SCP agents at the end of onboarding.** Add `await provisionSCP(body.product_id, founder.id)` in the `POST /onboarding/run-audit` handler, immediately after the audit completes. This is a single function call.
3. **Fix the competitor skip link.** Change the `<a href>` to a `<form method="POST">` or add a GET handler for `/onboarding/audit` that shows the audit step.
4. **Add async progress for the audit step.** Run the audit in the background, return immediately with a polling page, and use HTMX or SSE to show progress updates.
5. **Reduce sidebar to 8-10 items for Solo users.** Hide all locked features entirely (not locked icons — hidden). Show them progressively as the user explores.
6. **Make the pricing page explicit about product limits per tier.** Solo: 1 company. Growth: 1 company. Investor-Ready: up to 5 companies.
7. **Add direct checkout buttons on gate pages.** Instead of linking to /settings, include a form that posts directly to `/checkout` with the required tier pre-selected.
8. **Fix the Settings upgrade flow.** Show all available upgrade tiers (Solo → Growth, Solo → Investor-Ready), not just the jump to Investor-Ready.

### P2 — Should fix for a quality experience

9. **Open daily insight by default** (remove `<details>` wrapper or add `open` attribute).
10. **Add suggested questions to the query bar** for new users with sparse data.
11. **Fix CEO Briefing card link** to point to `/agents/briefings/latest` instead of `/agents`.
12. **Add outcome logging reminders** — surface "You have N decisions with no outcomes logged" in the dashboard or weekly digest.
13. **Add a "Your agents are learning" state** for the first 24 hours after onboarding, explaining what the agents are doing and when to expect the first briefing.

### P3 — Would improve the experience

14. **Add cross-product aggregate metrics** to the portfolio view for Investor-Ready users.
15. **Add an "Agent Health" summary card** to the main dashboard showing aggregate agent activity.
16. **Add empty-state guidance to the decision queue** explaining how decisions are generated.

---

## Summary Verdict

Foundry has a genuinely differentiated product concept and strong execution in the Decision Chamber and agent evolution engine. The core daily loop (Signal → Briefing → Decide) is sound. However, the onboarding journey has a **broken promise chain**: the landing page says "Connect your product, get a company," but onboarding delivers an audit score with no agents, no briefing, and no decisions. The product also has a **feature surface area problem** — 25+ sidebar items for a product whose pitch is "one number, three sentences, one query bar." The P0 and P1 items above represent the gap between what Foundry promises and what it delivers on Day 1. Fixing them transforms a 24-48 hour time-to-value into a sub-15-minute activation experience.
