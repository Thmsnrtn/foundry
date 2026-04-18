# Red Team 06 — Confused First-Timer

**Persona:** Zero technical context. Found Foundry from a tweet. Has a SaaS product (a Bubble-built marketplace), $800 MRR, no GitHub repo. Wants to understand what this thing does and whether $79/month is worth it. Target: reach "aha" (first SCP instance productive) in under 15 minutes.

## Attack Surface / Review Scope

- Landing page comprehension (can a non-technical founder understand the value prop?)
- Signup flow end-to-end
- Onboarding wizard: both GitHub and no-code paths
- First dashboard experience
- Terminology clarity
- Pricing page honesty (does what you see match what you get?)

## Findings

### RT-06-01 Landing Page Uses Jargon That Means Nothing to a First-Timer

- **Severity:** P1
- **Description:** The hero text says "Sovereign Company Protocol" in uppercase letters before the headline. A first-timer does not know what SCP is. The tagline "Connect your product. Get a company." is poetic but unclear -- I already *have* a company. The subtext mentions "12 specialized AI agents -- Atlas the CTO, Oracle the analyst..." which reads as a feature dump, not a benefit statement. There is no social proof (no customer logos, no testimonials, no "trusted by X founders"), no demo video, no screenshot of the actual dashboard. The briefing mockup at the bottom is the single most compelling element on the page but it is buried below the fold.
- **Evidence:** `src/routes/public/landing.ts:21-22` -- "Sovereign Company Protocol" label above the fold. `src/routes/public/landing.ts:23-25` -- hero copy. No `<video>`, `<img>`, or testimonial elements anywhere on the page.
- **Remediation:** (1) Remove or demote "Sovereign Company Protocol" -- it is internal branding, not user-facing value. (2) Lead with the CEO Briefing mockup as the hero visual -- it is the only concrete demonstration of value. (3) Add a 60-second product walkthrough video. (4) Replace "Connect your product. Get a company." with something outcome-oriented: "Wake up to a briefing from your AI team -- every morning." (5) Add at least one social proof element even if it is "Currently serving X products in beta."

### RT-06-02 No-Code Path Exists But Is Not Discoverable from Landing or Onboarding

- **Severity:** P1
- **Description:** A non-technical founder who clicks "Give my product a team" goes to `/auth/signup`. After creating an account, they land at `/onboarding` which shows a GitHub OAuth connection step. The no-code path (`/onboarding/no-code`) exists but there is no visible link to it from the default onboarding page. You must know the URL. The `onboardingWizard` component is called with `'connect_github'` step, and I found no evidence that the wizard view includes a "Don't have a GitHub repo?" escape hatch -- that logic would have to live in `src/views/components.ts`'s `onboardingWizard` function, which renders the `connect_github` step. A Bubble founder hitting a GitHub OAuth screen will bounce immediately.
- **Evidence:** `src/routes/dashboard/onboarding.ts:49-71` -- GET `/onboarding` renders `connect_github` step with no alternate path visible. `src/routes/dashboard/onboarding.ts:74-103` -- `/onboarding/no-code` exists as a separate route but is never linked from the main onboarding.
- **Remediation:** Add a prominent link below the GitHub connect button: "No GitHub repo? Add your product by URL instead" linking to `/onboarding/no-code`. Better: detect the `build_platform` from the signup flow and route accordingly.

### RT-06-03 Pricing Page Shows Three Tiers But README Shows Different Tier Names and Prices

- **Severity:** P2
- **Description:** The pricing route renders Solo ($79), Growth ($199), and Investor-Ready ($399). The README.md lists "Founding Cohort ($99), Growth ($199), Scale ($399)." The orientation doc says "Solo ($79), Growth ($199), Investor-Ready ($399)." The README is stale but this is what a founder sees if they find the GitHub repo. More importantly, the "Founding Cohort" concept (30 slots at a locked rate) that is mentioned in README and implemented in `billing/cohort.ts` is nowhere on the pricing page. If founding cohort pricing is active, this is a missed conversion opportunity.
- **Evidence:** `src/routes/public/landing.ts:159-161` -- Solo $79. `README.md:170-174` -- Founding Cohort $99. `src/services/billing/cohort.ts` -- slot enforcement exists.
- **Remediation:** (1) Update README to match live pricing page. (2) If founding cohort is still active, add a "Founding cohort: $99/mo locked forever (X of 30 slots remaining)" callout to the pricing page.

### RT-06-04 After Signup, Dashboard Redirect Assumes Product Already Exists

- **Severity:** P2
- **Description:** The Clerk signup component redirects to `/dashboard` on success (`forceRedirectUrl: "/dashboard"`). The `/dashboard` route checks if the founder has zero products and redirects to `/onboarding`. This means every new signup hits a redirect chain: `/dashboard` -> `/onboarding`. This works but adds latency and a flash of the dashboard layout before redirect. More critically, if the auth middleware's auto-provisioning (`ensureFounderExists`) fails silently, the founder could see an error or empty state.
- **Evidence:** `src/routes/auth/clerk.ts:41-42` -- `forceRedirectUrl: "/dashboard"`. `src/routes/dashboard/index.ts:127-129` -- zero products redirects to `/onboarding`.
- **Remediation:** Change `forceRedirectUrl` to `/onboarding` for new signups. Use Clerk's `afterSignUpUrl` vs `afterSignInUrl` to differentiate new vs returning users.

### RT-06-05 Onboarding Competitor Step Is Not Skippable

- **Severity:** P2
- **Description:** After creating a product (either GitHub or no-code path), the user is redirected to `/onboarding/competitors?product_id=X`. This form collects up to 5 competitor names. A confused first-timer may not know their competitors yet, or may find this step intimidating. The form *does* technically accept empty submissions (the loop only inserts rows where `comp.name` is truthy), but there is no visible "Skip" button or messaging that says this is optional. This creates hesitation at a critical moment in onboarding.
- **Evidence:** `src/routes/dashboard/onboarding.ts:280-291` -- GET `/onboarding/competitors` renders the step. `src/routes/dashboard/onboarding.ts:294-323` -- POST handler processes competitors (gracefully handles empty). No "skip" CTA in the wizard.
- **Remediation:** Add a visible "Skip for now" link that submits an empty form or redirects directly to `/onboarding/audit?product_id=X`.

### RT-06-06 Audit Step May Take Minutes with No Progress Feedback

- **Severity:** P1
- **Description:** The audit step (`/onboarding/audit`) shows the `running_audit` wizard step, then the user presumably clicks a button that POSTs to `/onboarding/run-audit`. The `runAudit()` function performs an 8-step GitHub analysis pipeline including Claude Opus AI calls. This could take 30-60+ seconds. The handler blocks until the entire audit completes before returning a redirect to `/dashboard?tour=1`. There is no streaming response, no progress indicator, no SSE/WebSocket feedback. For a no-code product without GitHub, the audit may partially fail or return minimal results, and the user has no idea what is happening.
- **Evidence:** `src/routes/dashboard/onboarding.ts:335-374` -- `runAudit()` is awaited synchronously before redirect. `src/services/audit/engine.ts` -- full audit pipeline (8 steps + Claude Opus scoring). No timeout on the AI call (per orientation doc: "Zero external calls have retry logic, circuit breakers, or explicit timeouts").
- **Remediation:** (1) Run the audit asynchronously: return immediately with a "Your audit is running" page, then poll or use SSE for completion. (2) Add a progress bar that updates as each audit step completes. (3) Set a timeout on the Anthropic call (60s max). (4) If audit fails, still redirect to dashboard with a "We'll complete your audit shortly" message.

### RT-06-07 Agent Names Are Opaque -- No Persistent Glossary or Tooltip System

- **Severity:** P2
- **Description:** The dashboard, briefings, and agents page use names like "Atlas," "Harbor," "Forge" without persistent role labels. On the landing page, each agent has a role and domain listed. But once inside the product, the user is expected to remember that "Harbor" means "Customer Success" and "Forge" means "Revenue." There is no tooltip, glossary panel, or always-visible role label in the dashboard UI. The 12-agent model is the product's core differentiator, but it creates a 12-concept vocabulary the user must memorize.
- **Evidence:** `src/services/scp/types.ts:37-66` -- display names and roles are defined but roles are only used in briefing contributions, not consistently in the UI. `src/routes/dashboard/index.ts:204-215` -- briefing card references agents by name only.
- **Remediation:** Show "Atlas (CTO)" format everywhere an agent name appears. Add a persistent sidebar glossary or tooltip on hover/tap. Consider showing only 3-4 "active" agents initially and revealing the rest progressively.

### RT-06-08 Would I Pay $79/Month Based on Day-1 Experience?

- **Severity:** P1 (business risk, not a bug)
- **Description:** After 15 minutes as a confused first-timer: I signed up, could not figure out the no-code path without knowing the URL, entered a product URL, skipped competitors by submitting an empty form (no "skip" button), waited through an audit with no progress feedback, and landed on a dashboard showing a Signal score of probably 50-60 with no briefing (briefings are generated by a daily cron job, not on first login). The "Ask anything about your business" query bar is present but without integrated data, it has nothing meaningful to respond with. The SCP agents have been provisioned but have not run yet (they run on hourly/daily cadences). Day-1 value delivered: essentially zero. The product requires at least 24-48 hours of agent execution before the user sees any value.

  This is the critical gap: the product's value is *asynchronous* (agents run on schedules), but the user's evaluation is *synchronous* (they judge in the first 5 minutes). There is no "instant win" moment on day 1.
- **Evidence:** Agent cadences in `src/services/scp/types.ts:99-113` -- minimum 6 hours (Sentinel), most are 24-48 hours. Briefing generation in `src/jobs/index.ts` -- runs daily at 7:00 UTC. No on-demand briefing trigger in onboarding flow.
- **Remediation:** (1) Run at least Oracle and Atlas immediately after onboarding completes (not waiting for cron). (2) Generate a "first briefing" as part of the onboarding flow. (3) Show a "What happens next" timeline: "In the next 6 hours, Sentinel will check your infrastructure. By tomorrow morning, you'll have your first CEO briefing." (4) Send a welcome email with the first briefing within 4 hours. (5) Consider a free trial so the user can experience value before paying.

## Status: HAS P0-P1

Three P1 findings (landing page comprehension, no-code path discoverability, audit UX, day-1 value gap) represent serious conversion risks. A confused first-timer is unlikely to convert to paid within 15 minutes. The product requires onboarding redesign to front-load value and remove the GitHub-centric assumption.
