# Carta — Cap Table + Portfolio Management

**Category:** A — Portfolio Operator Tools
**Last researched:** 2026-04-18

## What It Does

Carta is the industry-standard platform for cap table management, equity plan
administration, 409A valuations, and fund administration. Used by 50,000+ private
companies and 2.5M+ shareholders. Carta connects the workflows of fundraising, equity
management, investor reporting, and fund operations into a single platform — now
positioning itself as an "agentic ERP for private capital."

## Target User

Primary: startup founders and CFOs managing cap tables and equity. Secondary: VC/PE
fund managers using Carta for fund administration, LP reporting, and portfolio
oversight. Tertiary: employees tracking vesting schedules and exercising options.

## Positioning (How They Describe Themselves)

"The end-to-end suite connecting private capital." Recent shift toward "agentic ERP
for private capital" — framing Carta as the operating system for the entire private
market lifecycle, from formation to exit. This is a notable positioning escalation
from "cap table software."

## Pricing

- Startups: $3,000-$12,000/year depending on stakeholder count
- 409A valuations: $2,000-$5,000 per valuation
- Fund administration: $5,000-$50,000+/year per fund
- Annual price escalators (5-10%) built into contracts
- Enterprise: custom pricing with negotiated terms

## Key Vocabulary

Cap table, stakeholder, share class, 409A valuation, equity plan, vesting schedule,
fund administration, LP, GP, SPV, management company, raising entity, fund family,
portfolio company, board consent, ASC 820, waterfall analysis.

## Onboarding Flow

Entity-type-dependent. Simple entities onboard in hours via AI-assisted data ingestion.
Complex fund families go through a dedicated onboarding team that handles data transfer
and reconciliation. AI workflows read, load, and verify LP data and documents.
Migration from legacy providers (e.g., Gen II) is a managed process with reconciliation
checkpoints.

## Multi-Entity Handling

Deep multi-entity architecture. Carta natively models the three-entity fund structure
(Delaware LP + LLC management company + GP entity), manages inter-entity accounting,
and handles multi-vehicle fund families with consolidated reporting. Portfolio
companies, funds, and SPVs are all first-class entity types.

## Agent Handling

Carta's "agentic ERP" positioning is nascent — primarily AI-assisted data entry,
validation, and document parsing. No autonomous agents making decisions or executing
on behalf of companies. The "agent" vocabulary appears to be marketing positioning
rather than deployed capability as of early 2026.

## Novelty Positioning

Hybrid. Carta owns the "cap table management" category (category familiarity) but is
actively attempting category expansion to "agentic ERP for private capital" (category
creation). The expansion is aspirational — the product is still fundamentally a
record-keeping and compliance platform.

## What Foundry Can Learn

1. **"Agentic ERP" as a positioning cautionary tale.** Carta's attempt to claim "agentic"
   positioning without deployed agents shows the risk of vocabulary inflation. Foundry
   has actual autonomous agents — this is a real differentiator, but only if the
   vocabulary maps to demonstrated capability.

2. **Entity-as-primitive architecture.** Carta's deep modeling of entity types (LP, GP,
   SPV, fund family) is architecturally instructive. Foundry's "company" primitive
   needs similar richness — lifecycle stage, entity type, governance structure, and
   relationship graph should be first-class concepts.

3. **Price escalators as retention moat.** Carta's 5-10% annual escalators and data
   lock-in create switching costs. Foundry should design its data model so that
   cross-company intelligence compounds — the more companies managed, the harder it
   is to replicate the institutional knowledge elsewhere.
