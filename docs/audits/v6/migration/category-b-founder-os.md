# Consolidation: Category B (Founder OS / CEO Cockpit) -> Foundry

## Typical prospect's existing stack
- **Runway** or **Causal** for financial modeling, scenario planning, cash forecasting
- **Google Sheets / Excel** for ad-hoc financial analysis and board decks
- **QuickBooks / Xero** for accounting and bookkeeping
- **Stripe Dashboard** for revenue metrics and subscription analytics
- **Notion / Linear** for product roadmaps and team coordination
- **Mixpanel / PostHog / Amplitude** for product analytics

## What Foundry replaces vs integrates

### Replaces:
- Manual scenario analysis and ad-hoc financial modeling -- Foundry's intelligence layer generates best/base/stress scenarios automatically with agent-driven analysis, eliminating the need to build and maintain models in Runway or Causal
- CEO dashboard assembly from multiple tools -- Foundry's Signal Dashboard consolidates metrics, risk states, and decision queues into one founder-facing view, replacing the "tab between 6 tools" pattern
- Revenue metric tracking in Stripe Dashboard -- Foundry's MRR decomposition (new + expansion - contraction - churned) and cohort analysis replaces manual Stripe review
- Weekly status synthesis -- Foundry's digests and briefings replace the manual process of assembling weekly status from scattered sources

### Integrates with (stays):
- **QuickBooks / Xero** stays -- general ledger accounting, tax preparation, and compliance remain outside Foundry's scope; Foundry could ingest data from these
- **Notion / Linear** stays -- team-facing project management and documentation are collaborative tools; Foundry is founder-facing, not team-facing
- **PostHog / Mixpanel** stays as data sources -- Foundry integrates with analytics platforms to feed the intelligence layer but does not replace granular product analytics exploration

## Consolidation friction: MEDIUM

The prospect replaces 2-3 tools (financial modeling, revenue dashboard, status synthesis) but keeps 3-4 (accounting, project management, product analytics). The primary friction point is trust: founders using Runway or Causal have hand-built models they understand deeply. Switching to agent-generated intelligence means surrendering control over analytical methodology. The founder must trust that Foundry's agents produce analysis at least as good as their custom models.

## Key affordance to reduce friction: Provide a "model export" or "show your work" view where each agent-generated scenario displays the assumptions, data sources, and reasoning chain, so founders can verify the intelligence matches or exceeds what they built manually.
