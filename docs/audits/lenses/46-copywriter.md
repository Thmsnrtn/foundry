# Lens 46 -- Copywriter Audit

**Auditor perspective:** Every word the user reads -- headlines, descriptions, button labels, empty states, error messages, tooltips, onboarding copy, marketing copy, email copy.  
**Date:** 2026-04-16  
**Scope:** Landing, pricing, onboarding, tour, hints, digest email, dashboard, decisions, agents, settings, components (empty states, error messages).

---

## Executive Summary

Foundry's copy is remarkably strong for an engineering-led product. The landing page tells a clear, differentiated story. The tour and hints layer is one of the best first-run experiences I have seen in a SaaS tool -- copy is data-aware, not boilerplate. The voice is direct and confident without being arrogant.

The problems are mostly consistency and polish: the product uses different names for the same concept across surfaces, some error messages are generic developer defaults, and the email digest template is visually raw compared to the in-product experience. There are also a handful of places where insider jargon ("prompt_1", "Gate 3") leaks into the UI without explanation.

---

## P1 -- Critical (confusing or misleading copy on critical flows)

### P1-1. Landing page title tag says "Give Your Product a Team" but page `<title>` renders as "Give Your Product a Team -- Foundry"
**File:** `src/routes/public/landing.ts:16`  
The `publicLayout('Give Your Product a Team', ...)` passes the title through `layout()` which appends " -- Foundry", producing the final title. But this is also the H1 of the page, which reads "Connect your product. Get a company." -- a completely different statement. The title tag and the hero headline are telling different stories. A visitor arriving from a search result expecting "Give Your Product a Team" lands on copy about "getting a company." This is a trust/coherence gap on the single most important page.

**Recommendation:** Align the title tag with the hero headline, or unify the concept. "Give your product a team" is actually the stronger line -- consider promoting it to the H1 and treating "Connect your product. Get a company." as the subhead.

### P1-2. "Get Started Free" CTA at the bottom of landing implies a free tier that does not exist
**File:** `src/routes/public/landing.ts:136`  
The bottom CTA reads `Get Started Free`. The pricing page shows Solo at $79/mo as the cheapest tier. There is no free tier. This is a trust-damaging bait-and-switch on the most important conversion surface. By contrast, the pricing page CTAs correctly say "Get Started" without "Free."

**Recommendation:** Remove "Free" unless there is actually a free trial. If there is a trial period, say "Start your free trial" with the duration. If not, use "Get Started" to match the pricing page.

### P1-3. Onboarding GitHub callback returns raw JSON on error
**File:** `src/routes/dashboard/onboarding.ts:100`  
When the GitHub OAuth code is missing, the route returns `c.json({ error: 'Missing code' }, 400)`. When token exchange fails, it returns `c.json({ error: 'GitHub auth failed' }, 400)`. These are raw JSON responses served to a user who was in the middle of a visual wizard flow. They will see `{"error":"GitHub auth failed"}` in their browser -- a completely broken experience.

**Recommendation:** Render these errors inside the onboarding wizard layout with human-readable copy: "GitHub connection failed. This usually means the authorization was cancelled or timed out. Try connecting again."

### P1-4. Product limit page sends user to /settings with no indication of what "upgrade options" means
**File:** `src/routes/dashboard/onboarding.ts:148`  
When a founder hits their product limit, the error page says the upgrade hint (good) and then links to `/settings` with the label "View upgrade options." But the settings page has no section labeled "upgrade options" -- the subscription section is titled "Subscription." A confused user in the middle of onboarding is sent to a generic settings page with no anchor or highlight.

**Recommendation:** Link to `/settings#subscription` or `/pricing` instead. Better: show the upgrade action inline on the limit-reached page itself.

---

## P2 -- Moderate (tone inconsistency, verbose copy, naming confusion)

### P2-1. The product can't decide what it calls itself: "Sovereign Company Protocol," "Sovereign Company Platform," "Foundry"
**Files:** Landing page line 22: "Sovereign Company Protocol" (eyebrow). Landing page line 142: "Sovereign Company Platform for SaaS Founders" (footer). Sidebar, nav, everywhere else: "Foundry."  
The orientation doc uses "Sovereign Company Protocol (SCP)." The footer uses "Sovereign Company Platform." The landing body never uses either term again. Three names for one product in one page. SCP is also used as internal jargon throughout the codebase (agent routes, sidebar sections), but is never explained to users.

**Recommendation:** Pick one external-facing name. "Foundry" is the product name; use it everywhere. "Sovereign Company Protocol" can be the methodology name if explained once. Remove "Sovereign Company Platform" -- it conflicts with "Protocol." The footer should read: "Foundry -- Autonomous business intelligence for SaaS founders."

### P2-2. Sidebar navigation labels are terse to the point of ambiguity
**File:** `src/views/layout.ts:250-287`  
Primary nav uses "Signal", "Briefing", "Decide", "Actions." These are fine in isolation but "Decide" is a verb while all others are nouns -- inconsistent part-of-speech grammar. Under FORWARD: "Exit" with no context means nothing to a new user (it refers to exit intelligence / acquisition readiness). Under AUTONOMY: "Ambient" is opaque jargon.

**Recommendation:**  
- "Decide" -> "Decisions" (matches the page heading and is grammatically consistent)  
- "Exit" -> "Exit Intel" or "Exits"  
- "Ambient" -> "Ambient Layer" or better, a descriptive label like "Background Ops"  
- Consider tooltips on first visit for non-obvious labels

### P2-3. Tour says 5 steps but has 10 steps; comment says 5, advanceTour checks TOUR_STEPS.length
**File:** `src/services/ux/tour.ts:117-120`  
The comment on line 117 says "If step 5 completed, calls completeTour" but TOUR_STEPS has 10 entries. The code itself is correct (checks `nextStep > TOUR_STEPS.length`), but the misleading comment aside, 10 steps is too many for a first-run tour. Steps 6-10 cover navigation, DNA, settings, stressors, and a completion message. This is cognitive overload -- the user just ran their first audit and is now reading about stressors and settings.

**Recommendation:** Trim to 5-6 steps max. Steps 1-5 (score, blocking issues, risk state, decisions, weekly rhythm) are essential. Steps 6-10 can become contextual hints that appear when the user first visits those pages, rather than front-loading everything.

### P2-4. Digest email is functionally a `<pre>` block -- visually disconnected from the product experience
**File:** `src/services/digest/delivery.ts:34-49`  
The weekly digest email uses `<pre style="white-space: pre-wrap;">` for the stressor list, plain `<p>` tags with pipe separators for metrics ("Signups: 12 | Active: 45 | Activation: 23.4%"), and no Foundry branding beyond the color-coded risk banner. Compare this to the in-product briefing with its accent-colored cards, sparklines, and structured layout. The email feels like a dev test, not a premium $79-399/mo product communication.

**Recommendation:** Invest in a proper email template with the Foundry logo, risk state card, structured metric table, and a clear CTA to open the full briefing in-product. The narrative section (AI-generated) is good content but deserves better presentation.

### P2-5. Email subject lines use emoji for yellow/red but not green -- inconsistent
**File:** `src/services/digest/delivery.ts:23-27`  
Red daily: "Red circle emoji ProductName -- Daily Recovery Briefing." Yellow pulse: "Yellow circle emoji ProductName -- Thursday Pulse." Weekly (green): "ProductName -- Weekly Digest" -- no emoji. The green case should either also use a green circle emoji for consistency, or none of them should use emoji (many corporate email filters flag emoji subjects).

**Recommendation:** Either use color emoji for all three states or none. The no-emoji approach is safer for deliverability.

### P2-6. "Ask anything about your business" query bar placeholder is vague
**File:** `src/routes/dashboard/index.ts:223`  
The AI Ask bar says "Ask anything about your business..." This undersells what it can do and doesn't prime the user with the kinds of questions that work well.

**Recommendation:** Rotate through specific example prompts: "What's driving churn this month?", "Should I raise prices?", "What did Harbor find this week?" This teaches the user what's possible while filling the empty state.

### P2-7. Inconsistent "Get Started" vs "Give my product a team" CTA language
**Files:** Landing hero: "Give my product a team" (specific, strong). Landing bottom: "Get Started Free" (generic). Pricing page: "Get Started" (3 times). Public header: "Get Started."  
"Give my product a team" is a much better CTA because it reinforces the value prop. "Get Started" is generic SaaS copy that could be on any product.

**Recommendation:** Use "Give my product a team" (or a shorter version like "Get a team") as the primary CTA everywhere. "Get Started" can be the secondary/pricing button.

### P2-8. Navigation section header "FORWARD" is unclear
**File:** `src/views/layout.ts:264-269`  
The sidebar section "FORWARD" contains Scenarios, Investor Board, Exit, Weekly Brief. The label "Forward" does not describe what these items have in common. "Forward-looking intelligence" is the implied meaning but "FORWARD" alone reads like a navigation action.

**Recommendation:** "FORECAST" or "PLANNING" would be clearer section headers.

---

## P3 -- Minor (wording tweaks, polish)

### P3-1. Landing page vision statement is a quote from... nobody
**File:** `src/routes/public/landing.ts:41-43`  
The italicized quote in a card with accent border is presented as a blockquote but has no attribution. It reads like manifesto copy. If it is the founder's vision, attribute it. If it is product copy, don't use quote marks and italic -- just state it as a declaration.

### P3-2. Landing "How It Works" step 2 uses insider language: "run on their cadences"
**File:** `src/routes/public/landing.ts:86`  
"They start cautious, run on their cadences, and earn trust by being right." The word "cadences" is internal product jargon (agents run on hourly/daily/weekly cadences). A prospect reading this page has no frame of reference for what "cadences" means in this context.

**Recommendation:** "They start cautious, work daily, and earn trust by being right."

### P3-3. "50 sessions with a 91% success rate" is oddly specific for marketing copy
**File:** `src/routes/public/landing.ts:110`  
"After 50 sessions with a 91% success rate, an agent transitions from Level 2 (approval required) to Level 0 (fully autonomous)." These numbers feel like config defaults pasted into marketing copy. They will confuse prospects who don't know what a "session" is.

**Recommendation:** Soften to: "Over time, agents that consistently deliver good results earn more autonomy -- from requiring your approval on every action to operating independently."

### P3-4. Lifecycle progress bar shows raw internal identifiers
**File:** `src/views/components.ts:281-291`  
The lifecycle bar renders prompts as "P1", "P2", "P2_5", "P3"... "P9". These are database column names (`prompt_1` through `prompt_9`), not user-facing labels. "P2_5" is particularly jarring.

**Recommendation:** Map to human-readable stage names: "Foundation", "Build", "Validate", "Launch", etc.

### P3-5. Competitor step says "Name up to 5 competitors" but only shows 3 input fields
**File:** `src/views/components.ts:734`  
The copy says "Name up to 5 competitors so Foundry can monitor the competitive landscape." But the form renders only 3 input fields (competitors[0], [1], [2]).

**Recommendation:** Either show 5 fields or change the copy to "Name your top competitors" without a specific number.

### P3-6. Empty states are inconsistent in voice -- some use "you", some are impersonal
**Files:** Various  
- `hints.ts:101`: "Foundry is operating autonomously. Decisions surface here when..." (good, explains the system)  
- `components.ts:333`: "No pending decisions." (terse, no context)  
- `components.ts:445`: "No cohort data yet. Cohorts are created as users sign up." (explains mechanism, but impersonal)  
- Agent roster empty: "Your AI team hasn't been set up yet." (good, uses "your")  
- ROI empty: "Add a product to start tracking Foundry's value delivery." (good, action-oriented)  
- Competitive empty: "No competitors configured." (terse, no CTA)

**Recommendation:** Standardize empty states to follow the pattern: [What this is] + [Why it's empty or what triggers content] + [CTA if applicable]. The hints.ts decision empty state is the gold standard.

### P3-7. "Something went wrong. Try again." appears 4+ times as a catch-all error
**Files:** `decisions.ts:232`, `decisions.ts:261`, `index.ts:301`, `onboarding-chat.ts:220`  
This is the generic fallback for all client-side fetch failures. It tells the user nothing about what went wrong or whether retrying will help.

**Recommendation:** Differentiate between network errors ("Connection lost -- check your internet and try again") and server errors ("Something unexpected happened. If this keeps happening, reach out to support."). The decisions reflect endpoint already has a nice fallback: "Unable to generate clarity right now. Trust what you know." -- extend this thoughtfulness everywhere.

### P3-8. "Resolve decision" button label is cold/bureaucratic
**File:** `src/routes/dashboard/decisions.ts:155`  
The Decision Chamber asks: "Resolve this decision" with a "Resolve decision" button. "Resolve" is technically correct but emotionally flat for what should be an empowering moment.

**Recommendation:** "Make the call" or "Decide" -- something that reinforces the founder's agency.

### P3-9. Pricing page "For scaling teams" on Growth tier is misleading for solo founders
**File:** `src/routes/public/landing.ts:170`  
Growth says "For scaling teams" but includes "Up to 3 team members." Many solo founders need integrations but don't have a team. The copy implies Growth is not for them.

**Recommendation:** "For founders ready to integrate their stack" or "For connected operations."

### P3-10. Mobile bottom nav uses "Plan" but sidebar has no "Plan" section
**File:** `src/views/layout.ts:342`  
The mobile bottom navigation has a "Plan" tab linking to `/plan`. The sidebar has no corresponding "Plan" label -- its equivalent content is under "FORWARD" section. This naming mismatch means the mobile and desktop experiences use different vocabulary for the same feature area.

**Recommendation:** Align mobile and desktop terminology. If the sidebar section becomes "PLANNING" (per P2-8), the mobile tab should also say "Plan" or "Planning."

### P3-11. Agent calibration messages are repetitive boilerplate
**Files:** `src/services/scp/agents/forge.ts:99`, `harbor.ts:111`, `shield.ts:108`, `prism.ts:96`, `scribe.ts:96`, `ledger.ts:116`, `crucible.ts:105`, `oracle.ts:120`, `atlas.ts:115`, `compass.ts:97`  
Every agent has a nearly identical empty-state observation: "No [domain] data available yet -- [AgentName] will [verb] as data accumulates." This is fine structurally but reads as templated when multiple agents surface their empty states in a briefing simultaneously.

**Recommendation:** Vary the phrasing slightly per agent to maintain the illusion of distinct personalities. Atlas (CTO) should sound different from Harbor (CS).

### P3-12. Tour step 5 headline "Your Weekly Rhythm" describes a concept never mentioned elsewhere
**File:** `src/services/ux/tour.ts:51-53`  
The tour introduces "Your Weekly Rhythm" as a concept (Friday synthesis, Sunday competitive scan, Monday digest). This cadence is not referenced anywhere else in the UI -- not in the sidebar, not in settings, not in any dashboard view. It is orphaned knowledge.

**Recommendation:** Either reinforce this concept in the sidebar (e.g., show current day in the weekly cycle) or remove it from the tour and let users discover the cadence organically through notifications.

---

## Voice and Tone Assessment

**Strengths:**
- The product voice is direct and confident. "You set the pace. They earn the trust." is excellent.
- Jargon is mostly well-managed on the marketing surface. Terms like "golden lesson," "stressor," and "risk state" are introduced with context.
- The tour body templates are outstanding -- they dynamically adapt copy to real data (score ranges, blocking issue counts, remediation status). This is best-in-class onboarding copy.
- The Decision Chamber "What are you most uncertain about?" prompt is psychologically sharp.
- Empty state copy in the hints system (decisions empty, first red state) is genuinely helpful rather than just decorative.

**Weaknesses:**
- Voice shifts between marketing (warm, visionary: "while you sleep"), product UI (neutral, functional: "No pending decisions"), and system messages (cold, technical: "Gate 3 decisions require resolution_reasoning").
- The founder is addressed as "you" on the landing page and in hints, but the product often defaults to third-person or impersonal constructions in UI chrome.
- Internal terminology ("Gate 0-4", "prompt_1", "cadences", "SCP") leaks into user-facing surfaces without explanation.

---

## Summary of Findings by Priority

| Priority | Count | Key themes |
|----------|-------|------------|
| P1 | 4 | Misleading "Free" CTA, raw JSON errors in onboarding, title/H1 mismatch, dead-end upgrade link |
| P2 | 8 | Identity confusion (3 product names), terse nav labels, bloated tour, raw email template, inconsistent CTAs |
| P3 | 12 | Jargon leaks, empty state inconsistency, generic error messages, internal IDs in UI, boilerplate agent copy |
