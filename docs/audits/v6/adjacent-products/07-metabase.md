# Metabase — Open-Source BI Dashboards

**Category:** D — BI / Ops Dashboard
**Last researched:** 2026-04-18

## What It Does

Metabase is an open-source business intelligence platform that enables anyone to create
dashboards, charts, and reports without SQL knowledge. It connects to databases,
provides a visual query builder, supports SQL for power users, and offers embedded
analytics for SaaS products. Recent additions include Metabot (AI-powered natural
language querying), Data Studio (semantic layer workbench), and multi-tenant embedded
analytics with tenant isolation.

## Target User

Primary: data-curious team members at startups and mid-market companies who need
self-service analytics without writing SQL. Secondary: developers embedding analytics
into their own SaaS products (embedded analytics). Tertiary: data teams building
curated semantic layers for their organizations.

## Positioning (How They Describe Themselves)

"Open source business intelligence and embedded analytics." Metabase frames itself as
the democratization layer for data — the tool that lets everyone (not just analysts)
work with data. The open-source positioning creates trust and reduces vendor lock-in
perception.

## Pricing

- Open Source (self-hosted): Free
- Starter (cloud): $100/mo base + $6/user/mo (5 users included)
- Pro (cloud): $575/mo base + $12/user/mo (10 users included)
- Enterprise: ~$20,000+/year, negotiated
- Metabot AI add-on: $100/mo for 500 requests (paid cloud plans only)

## Key Vocabulary

Question, dashboard, collection, model, metric, dimension, filter, segment, drill-
through, pulse, alert, embedding, tenant, permission group, native query, visual
query builder, semantic layer, Data Studio, Metabot.

## Onboarding Flow

Connect database, explore data with visual query builder or SQL, build first
dashboard. Self-serve for open source. Paid plans include specialized onboarding
(weeks, not months). Data Studio enables curating governed datasets and metrics that
improve Metabot accuracy. Progressive complexity: start with visual queries, graduate
to SQL, then semantic layer curation.

## Multi-Entity Handling

Metabase's multi-tenant embedded analytics ("Tenants") provide entity isolation for
SaaS use cases — each tenant sees only their data, with permission groups within
tenants. For internal use, collections and permissions can separate business units.
However, this is data isolation, not business entity modeling — Metabase doesn't
understand "companies," only "who can see what data."

## Agent Handling

Metabot is an AI assistant, not an autonomous agent. It answers natural language
questions by generating SQL against the semantic layer, creates charts from
descriptions, fixes query errors, and analyzes existing visualizations. Embeddable
Metabot allows SaaS products to offer AI-powered analytics to their customers.
No autonomous operation, no proactive analysis, no decision-making.

## Novelty Positioning

Category familiarity with open-source differentiation. BI dashboards are a mature
category (Tableau, Looker, Power BI). Metabase differentiates on open-source
accessibility and embedded analytics, not category creation. Metabot adds AI but
doesn't redefine the category.

## What Foundry Can Learn

1. **Semantic layer as agent context.** Metabase's Data Studio — where teams curate
   models, metrics, and business definitions that Metabot uses for accurate answers —
   is analogous to what Foundry's agents need. Each company's data should have a
   semantic layer that agents reason against, not raw database tables.

2. **Embedded analytics as a distribution strategy.** Metabase's embeddable components
   (including AI chat) show how analytics can live inside other products. Foundry
   could offer embeddable fleet intelligence widgets for investor dashboards, board
   decks, or founder tools.

3. **Multi-tenant isolation as trust infrastructure.** Metabase's tenant isolation
   (each customer only sees their data) maps to Foundry's cross-company data isolation
   requirement. The "consent model and isolation proof" from the orientation doc should
   be as rigorous as Metabase's tenant architecture — demonstrably secure separation
   with explicit cross-entity sharing.
