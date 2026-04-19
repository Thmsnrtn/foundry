# Visible.vc — Portfolio Monitoring for VCs/Investors

**Category:** A — Portfolio Operator Tools
**Last researched:** 2026-04-18

## What It Does

Visible.vc is an investor relationship management platform that streamlines portfolio
monitoring, data collection, and LP reporting for venture capital funds. It automates
the collection of portfolio company metrics via configurable "Visible Requests,"
consolidates KPIs/documents/notes into unified dashboards, and generates LP-ready
reports. Used by 540+ VC funds, including Antler (750+ portfolio companies across
20 countries).

## Target User

General Partners and fund operations teams at VC/PE firms managing 10-500+ portfolio
companies. Secondary persona: founders using Visible to send investor updates.

## Positioning (How They Describe Themselves)

"An investor relationship hub for best-in-class founders." For investors: "Portfolio
monitoring, management, and reporting." Visible frames itself as the connective tissue
between investors and portfolio companies — not a tool for running companies, but for
watching them.

## Pricing

- Founder plans: Free starter, paid from $59/mo
- Investor plans: From $449/mo for portfolio monitoring
- LP reporting: Custom pricing
- No per-company surcharge — flat platform fee

## Key Vocabulary

Portfolio company, fund, LP, investor update, KPI request, benchmark, data room,
portfolio monitoring, deal flow, raise tracking, investor CRM.

## Onboarding Flow

Template-driven: select fund type, import portfolio companies, configure KPI request
templates, invite portfolio company contacts to submit data. Emphasis on getting
first data collection cycle running within days, not weeks. Lightweight — no deep
integration required from portfolio companies.

## Multi-Entity Handling

Native multi-entity: the entire product is built around managing N portfolio companies
from one fund-level view. Each portfolio company is a discrete entity with its own
metrics, documents, and update cadence. Cross-portfolio benchmarking is a core feature.
Funds can manage multiple vehicles and cross-fund views.

## Agent Handling

No autonomous agents. However, Visible ships an **MCP server** that pipes portfolio
data into external AI agents and LLMs for custom workflows. This is infrastructure
for AI interoperability, not autonomy — Visible provides the data, the user provides
the intelligence layer.

## Novelty Positioning

Category familiarity. Visible operates in the well-established "portfolio monitoring"
category and competes on execution (better UX, faster data collection, AI-powered
parsing) rather than category creation. No attempt to redefine the category.

## What Foundry Can Learn

1. **Data collection as relationship infrastructure.** Visible's "Requests" system
   turns metric collection into a lightweight, repeatable ritual. Foundry's SCP agents
   could adopt a similar pattern — structured data pulls from each company instance
   that feel like check-ins rather than surveillance.

2. **MCP server as an AI surface area strategy.** Visible doesn't build agents — it
   builds an API surface that agents can consume. Foundry should expose its fleet data
   via MCP/API so external tools (Cursor, Claude, etc.) can query fleet state, giving
   Foundry ambient presence in the founder's existing toolchain.

3. **Benchmarking as the multi-entity value proof.** The moment you manage 2+ entities,
   comparison becomes the killer feature. Visible's cross-portfolio benchmarks are
   what justify the platform over spreadsheets. Foundry's cross-company intelligence
   extraction must be equally visible and immediate.
