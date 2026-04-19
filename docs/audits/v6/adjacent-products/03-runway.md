# Runway (runway.com) — Financial Modeling for Founders

**Category:** B — Founder OS / CEO Cockpit
**Last researched:** 2026-04-18

## What It Does

Runway is an FP&A (Financial Planning & Analysis) platform that replaces spreadsheet-
based financial models with a collaborative, data-connected modeling environment.
It consolidates data from 750+ integrations (ERP, CRM, HRIS, data warehouse), enables
scenario planning, headcount modeling, and cash forecasting, and ships an AI Analyst
agent that can update models, explore scenarios, and surface insights conversationally.

## Target User

Finance teams and founders at high-growth startups and mid-market companies (Series A
through pre-IPO). Primary persona: head of finance / FP&A lead. Secondary persona:
CEO/founder who needs to understand runway, burn, and scenarios without building
spreadsheets.

## Positioning (How They Describe Themselves)

"The FP&A platform for high-growth teams." Runway frames itself as the modern
replacement for Excel-based financial planning — collaborative, connected to live
data, and now AI-powered. Not a banking product, not a BI tool — specifically financial
modeling and forecasting.

## Pricing

- Transparent, non-user-based pricing (differentiator vs. competitors)
- No implementation fees
- Unlimited collaboration included
- Exact tiers not publicly listed — positioned as "flexible for teams of all sizes"
- Backed by a16z, Garry Tan, Dylan Field ($27.5M Series B in 2023)

## Key Vocabulary

Financial model, forecast, scenario, assumption, driver, headcount plan, cash runway,
burn rate, consolidation, multi-entity rollup, variance analysis, actuals vs. plan,
dimension, segment, integration connector.

## Onboarding Flow

Self-guided onboarding with hands-on support available. Connect data sources first,
then build model on top of live data. Most teams build live forecasts within weeks
without external consultants. The AI Analyst accelerates onboarding by helping users
construct initial models through conversation.

## Multi-Entity Handling

Runway supports multi-entity consolidation and segmentation by product, department,
or region. Dimensional modeling allows a single model to represent multiple entities
with roll-up views. However, each "entity" is a dimension within one model, not a
truly independent company instance — the mental model is "one company with segments"
rather than "multiple independent companies."

## Agent Handling

Runway's AI Analyst is an embedded agent that "knows your model as well as you do."
It can update forecasts, explore what-if scenarios, and surface anomalies. This is a
single-purpose copilot — it assists with one model at a time, does not operate
autonomously, and does not coordinate across entities. It is reactive (responds to
prompts), not proactive (does not initiate analysis).

## Novelty Positioning

Category familiarity with modern execution. Runway competes in the established FP&A
category but differentiates on UX (spreadsheet-killing simplicity), integration depth
(750+ connectors), and AI assistance. No attempt at category creation — the goal is
to be the best FP&A tool, not to redefine what FP&A means.

## What Foundry Can Learn

1. **"Knows your model as well as you do" as the agent trust bar.** Runway's AI
   Analyst earns trust by demonstrating deep context awareness within the model.
   Foundry's SCP agents need to clear the same bar — each agent must demonstrably
   "know" the company it manages, not just have access to data.

2. **Self-guided onboarding with AI scaffolding.** Runway lets founders start building
   immediately with AI help, rather than requiring a multi-week implementation. Foundry
   should ensure the first SCP instance is operational within hours, with agents that
   explain what they're learning and doing during the setup phase.

3. **Scenario planning as the decision amplifier.** Runway's best/base/worst scenarios
   are how founders make decisions. Foundry already has scenario modeling in the
   intelligence layer — surfacing cross-company scenarios ("if Company A's churn
   hits X, here's the fleet impact") would be a unique capability no FP&A tool offers.
