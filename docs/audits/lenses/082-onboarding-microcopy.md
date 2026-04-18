# Lens 082 — Onboarding Micro-Copy Specialist

**Distinct value:** Evaluates the text quality in first-run experiences: onboarding wizard copy, conversational setup chat prompts, tour step text, hint text, and any first-run guidance. Is the copy clear, concise, confident, and in the product's voice?

**Tenancy-critical:** Yes. Onboarding quality directly impacts whether a founder activates their product and becomes a paying customer. Each new product added to a fleet goes through onboarding.

## Executive Summary

Foundry has two onboarding paths: a traditional step-by-step wizard (GitHub connect, repo select, competitors, audit) and a conversational chat setup. The wizard copy is functional but generic — it reads like a technical setup guide rather than an exciting product activation. The conversational chat is significantly better — it creates a human, dynamic experience. The tour system exists but the tour copy was not fully inspectable from the template level. Onboarding step labels are clear ("Connect GitHub", "Select Repository", "Identify Competitors", "Run First Audit") but the supporting copy could be more compelling and confidence-building.

## Findings

### OMC-01 Wizard Step Copy Is Functional But Uninspiring
- **Severity:** P2
- **Description:** The onboarding wizard steps use technical, feature-description copy:
  - Step 1: "Foundry analyzes your product to run a ten-dimension audit."
  - Step 2: "Choose the repository for your product's first audit."
  - Step 3: "Name up to 5 competitors so Foundry can monitor the competitive landscape."
  - Step 4: "Foundry will analyze your codebase across ten dimensions. This usually takes 2-5 minutes."
  
  These are accurate but lack energy. A founder connecting their product is a pivotal moment — the copy should build anticipation, not describe features.
- **Evidence:** `src/views/components.ts:711-773` — wizard step content.
- **Remediation:** Rewrite with outcome-focused, confident copy:
  - Step 1: "Let's connect your product. Once connected, 12 AI agents will start learning everything about it."
  - Step 2: "Pick the repo they'll analyze first."
  - Step 3: "Who are you up against? Your agents will track their every move."
  - Step 4: "Starting your first audit. Your agents are analyzing code quality, trust density, competitive defensibility, and 7 more dimensions."
- **Target Phase:** 2

### OMC-02 "I don't have a repo" Path Has Good Copy
- **Severity:** (Positive Finding)
- **Description:** The no-code path label is "I don't have a repo" with a footnote: "Built with Bubble, Webflow, Shopify, or an agency? The URL-based path is for you." This is inclusive and well-targeted — it immediately validates non-technical founders and names specific platforms they might use.
- **Evidence:** `src/views/components.ts:715-718` — no-code path button and footnote.
- **Remediation:** N/A — good segmentation copy.
- **Target Phase:** N/A

### OMC-03 Conversational Onboarding Chat Is Well-Written
- **Severity:** (Positive Finding)
- **Description:** The chat-based onboarding at `/setup` creates a conversational experience where an AI guides the founder through 5 questions. The header copy "Set up your AI team — Quick 5-minute conversation to get started" sets clear expectations. The "Skip" button provides an escape hatch. The progress indicator ("2 of 5 questions answered") gives positioning. The "Generate Your First Briefing" CTA is compelling.
- **Evidence:** `src/routes/dashboard/onboarding-chat.ts:122-126` — header copy. Lines 53-65 — briefing CTA with gradient background and clear value proposition.
- **Remediation:** N/A — the chat onboarding is the product's best micro-copy experience.
- **Target Phase:** N/A

### OMC-04 Audit Wait State Needs Better Copy
- **Severity:** P2
- **Description:** The audit step says "This usually takes 2-5 minutes." with a "Run Audit" button. After clicking, the user presumably sees a loading state, but there is no evidence of a rich waiting experience. A 2-5 minute wait is a long time in a web app. The copy should set expectations, provide real-time progress updates, and maintain engagement during the wait.
- **Evidence:** `src/views/components.ts:763-773` — audit step with timing estimate and submit button. No progress or engagement content during the wait.
- **Remediation:** Show a multi-stage progress indicator during the audit: "Scanning repository structure... Analyzing code quality... Evaluating trust density... Scoring competitive defensibility..." Each stage reveals as the audit progresses. Add: "While you wait: your 12 agents are being calibrated to your product."
- **Target Phase:** 2

### OMC-05 Competitor Identification Step Under-Motivates
- **Severity:** P2
- **Description:** The competitor step says "Name up to 5 competitors so Foundry can monitor the competitive landscape." The skip option is presented as equally weighted to continuing. This under-sells a feature that significantly improves the product experience. Competitive intelligence data makes the AI agents smarter and more relevant.
- **Evidence:** `src/views/components.ts:740-761` — competitor step with skip button given equal visual weight to the submit button.
- **Remediation:** Rewrite: "Who's competing for your customers? Naming competitors gives your agents competitive intelligence — they'll track hiring patterns, product changes, and market moves." De-emphasize skip: make it a small text link below the form, not a button next to the primary CTA.
- **Target Phase:** 2

### OMC-06 Step Numbers Use Generic Numbering
- **Severity:** P3
- **Description:** The onboarding wizard uses plain numbers (1, 2, 3, 4) with generic labels. This is functional but misses an opportunity to reinforce the product narrative. The steps could map to the product story: "1. Connect" "2. Analyze" "3. Compete" "4. Activate" — short verbs that feel like a launch sequence.
- **Evidence:** `src/views/components.ts:683-688` — step definitions with numeric labels.
- **Remediation:** Replace labels: "Connect GitHub" -> "Connect", "Select Repository" -> "Analyze", "Identify Competitors" -> "Compete", "First Audit" -> "Activate". Use verb-forward labels that feel like progress.
- **Target Phase:** 3

### OMC-07 Post-Audit Redirect Misses Celebration
- **Severity:** P2
- **Description:** After the first audit completes, the user is redirected to `/dashboard?tour=1`. There is no celebration, no summary of what was found, no "Here's your first Signal score" moment. The transition from onboarding to the product is abrupt. The `onboardingComplete` step in the wizard exists but may not be used (the redirect goes directly to dashboard).
- **Evidence:** `src/routes/dashboard/onboarding.ts:373` — `return c.redirect('/dashboard?tour=1')`. The complete step at `src/views/components.ts:775-780` exists but the flow skips it.
- **Remediation:** Show the complete step briefly before redirecting: "Your first audit is complete. Composite score: 6.2/10. Verdict: READY WITH CONDITIONS. Your 12 agents are now active. Let's see your Signal." Then redirect to dashboard with the tour. This provides a moment of achievement.
- **Target Phase:** 2

## Embarrassment Test
1. A founder completing their first audit sees a plain redirect to the dashboard with no celebration — the most exciting moment (their AI team activating) passes without acknowledgment.
2. The competitor identification step under-motivates with feature-description copy, leading founders to skip it and reducing the quality of their AI agent intelligence.

## Recommendations (Priority Order)
1. Add post-audit celebration moment before dashboard redirect (P2, Phase 2)
2. Rewrite wizard step copy to be outcome-focused and confident (P2, Phase 2)
3. Add progress stages during the 2-5 minute audit wait (P2, Phase 2)
4. Strengthen competitor step motivation and de-emphasize skip (P2, Phase 2)
5. Use verb-forward step labels (P3, Phase 3)
