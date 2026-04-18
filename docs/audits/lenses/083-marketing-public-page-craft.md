# Lens 083 — Marketing / Public Page Craft

**Distinct value:** Evaluates the landing page, pricing page, and case studies as conversion-optimized marketing assets. Analyzes headline clarity, value proposition, social proof, CTA placement, pricing presentation, and persuasion flow.

**Tenancy-critical:** No. Public pages are the same for all visitors.

## Executive Summary

Foundry's landing page is remarkably well-crafted for a dev-built page. The headline "Connect your product. Get a company." is a one-line value proposition that communicates the transformation. The 12-agent grid provides credibility through specificity. The mock CEO briefing creates a vivid preview of the daily experience. The pricing page is clean with three tiers clearly differentiated. However, there are conversion gaps: no social proof (no testimonials, no customer count, no logos), no live demo or video, no competitive positioning, no FAQ, and the CTA copy ("Give my product a team") is used identically in 4 places. The case studies page relies on auto-generated content that may not exist yet. The pages are built entirely with inline styles, making them hard to maintain and responsive-unfriendly.

## Findings

### MPC-01 Landing Page Headline Is Strong
- **Severity:** (Positive Finding)
- **Description:** "Connect your product. Get a company." is a clear, memorable headline. The subheadline expands it: "Foundry gives your SaaS product a team of 12 specialized AI agents." The SCP (Sovereign Company Protocol) eyebrow adds intrigue. The overall narrative arc — connect → agents activate → read briefing → agents evolve — is logical and compelling.
- **Evidence:** `src/routes/public/landing.ts:22-29` — headline, subheadline, and CTAs.
- **Remediation:** N/A — strong copy. Consider A/B testing a more specific pain-point headline for founders who already know they need help.
- **Target Phase:** N/A

### MPC-02 Mock CEO Briefing Is Excellent Conversion Content
- **Severity:** (Positive Finding)
- **Description:** The daily CEO briefing preview on the landing page is the strongest conversion element. It shows specific agent names doing specific things ("Atlas: Closed a security gap", "Oracle: Churn improved 0.4%", "Harbor: 3 trial users went silent"). The monospace font and structured format create a "real product" feel. The specificity (agent names, percentages, dollar amounts) builds credibility.
- **Evidence:** `src/routes/public/landing.ts:117-130` — mock briefing with agent-specific updates, decisions, and MRR figures.
- **Remediation:** N/A — this is the most compelling marketing element. Consider making it interactive (scroll through 3 days of briefings) or personalized based on visitor's product category.
- **Target Phase:** N/A

### MPC-03 No Social Proof Anywhere
- **Severity:** P1
- **Description:** The landing page has zero social proof: no customer testimonials, no company logos, no "X founders use Foundry", no founding cohort status, no case study excerpts, no Twitter/social quotes. For a $79-399/month B2B product, social proof is critical for conversion. The pricing page mentions "Founding cohort: 30 slots at locked rate" in the orientation document but this is not reflected on the public pricing page.
- **Evidence:** No testimonials, logos, or social proof elements found on any public page. The case studies page relies on auto-generated artifacts which may not exist.
- **Remediation:** Add: (1) Founding cohort badge on pricing page: "X of 30 founding slots remaining — locked rate forever". (2) Testimonial section with 2-3 founder quotes. (3) Before/after Signal score example. (4) "Y decisions resolved" or "Z hours saved" aggregate stat.
- **Target Phase:** 2

### MPC-04 CTA Copy Is Repetitive
- **Severity:** P2
- **Description:** The primary CTA "Give my product a team" appears identically in 4 locations: hero section, bottom CTA, and the vision section. The pricing page uses "Get Started" (3 times). Varying the CTA copy based on context increases click-through: the hero CTA should be aspirational, the bottom CTA should be urgency-driven, and the pricing CTA should be action-specific.
- **Evidence:** `src/routes/public/landing.ts:31,133` — identical "Give my product a team" CTAs. `src/routes/public/landing.ts:171,187,205` — identical "Get Started" CTAs on pricing.
- **Remediation:** Vary CTAs: Hero: "Give my product a team" (aspirational). After briefing: "See my first briefing" (curiosity). Bottom: "Start your 12-agent team today" (specificity). Pricing Solo: "Start with Solo". Pricing Growth: "Upgrade to Growth". Pricing IR: "Go Investor-Ready".
- **Target Phase:** 3

### MPC-05 Pricing Page Is Clean But Lacks Anchor
- **Severity:** P2
- **Description:** The pricing page presents three tiers clearly with feature lists. The Growth tier is marked as "featured" (highlighted card). However: (1) no anchor price or "per agent" breakdown to make the price feel justified, (2) no "most popular" label, (3) no annual billing option with savings, (4) no "compare all features" table, and (5) no FAQ section addressing common objections.
- **Evidence:** `src/routes/public/landing.ts:152-213` — pricing grid with three cards.
- **Remediation:** Add: (1) "Most popular" badge on Growth tier. (2) Per-agent cost framing: "$199/mo = $16.58 per AI agent". (3) Founding cohort scarcity: "Founding rate — X slots remaining". (4) FAQ: "What happens when agents make mistakes?", "Can I control what agents do?", "How is my data protected?".
- **Target Phase:** 2

### MPC-06 All Public Pages Use Inline Styles
- **Severity:** P2
- **Description:** The landing page and pricing page are built entirely with inline `style="..."` attributes. This makes responsive design impossible (media queries cannot override inline styles), maintenance difficult, and CLS analysis unreliable. The landing page alone has 100+ inline style declarations.
- **Evidence:** `src/routes/public/landing.ts:20-148` — every element has inline styles. No CSS classes from the design system used on public page content.
- **Remediation:** Extract public page styles into CSS classes: `.hero`, `.agent-grid`, `.agent-card`, `.how-it-works-grid`, `.feature-highlight`, `.pricing-grid`, `.pricing-card`. The pricing grid already has `.pricing-grid` and `.pricing-card` classes in CSS.
- **Target Phase:** 2

### MPC-07 No SEO Metadata
- **Severity:** P2
- **Description:** The landing page has a `<title>` and `<meta charset>` but no `<meta name="description">`, no Open Graph tags, no Twitter Card tags, no structured data (JSON-LD), and no canonical URL. When the landing page is shared on social media or appears in search results, it will show generic or auto-extracted text.
- **Evidence:** `src/views/layout.ts:65-68` — only charset, viewport, theme-color, and title tags. No description, og:title, og:description, og:image, twitter:card.
- **Remediation:** Add to publicLayout: `<meta name="description" content="Foundry gives your SaaS product a team of 12 specialized AI agents. They operate, learn, and grow your business while you sleep.">`. Add Open Graph tags for social sharing preview.
- **Target Phase:** 2

### MPC-08 No FAQ Section
- **Severity:** P2
- **Description:** Neither the landing page nor pricing page has a FAQ section. For a product offering autonomous AI agents that can take actions on a founder's business, there are many natural objections and questions: "What if an agent makes a wrong decision?", "How do I control what they do?", "Is my data safe?", "Can I cancel anytime?". Addressing these on-page reduces friction.
- **Evidence:** No FAQ section in any public page route.
- **Remediation:** Add a FAQ section below pricing with 6-8 questions using the `<details>` pattern (already used elsewhere in the app). Focus on trust, control, safety, and pricing objections.
- **Target Phase:** 2

## Embarrassment Test
1. A founder shares the Foundry link on Twitter and the preview shows a generic title with no description or image — no social proof, no value proposition in the preview.
2. A potential customer visits the pricing page and sees no social proof, no FAQ, and no scarcity indicator — nothing to push them past "interesting" to "signup."

## Recommendations (Priority Order)
1. Add social proof section to landing page (P1, Phase 2)
2. Add founding cohort scarcity and FAQ to pricing page (P2, Phase 2)
3. Add SEO and Open Graph metadata to public pages (P2, Phase 2)
4. Extract inline styles to CSS classes for responsive design (P2, Phase 2)
5. Vary CTA copy by position and context (P2, Phase 3)
