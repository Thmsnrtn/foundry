# Consolidation: Category D (BI / Ops Dashboard) -> Foundry

## Typical prospect's existing stack
- **Metabase** or **Looker / Tableau / Power BI** for dashboards and ad-hoc reporting
- **dbt** for data transformation and modeling
- **Snowflake / BigQuery / PostgreSQL** as the analytics warehouse
- **Fivetran / Airbyte** for data ingestion from SaaS tools
- **Datadog / Grafana** for infrastructure and application monitoring
- **Google Sheets** for metrics that don't fit neatly into BI tools

## What Foundry replaces vs integrates

### Replaces:
- Founder-facing KPI dashboards -- Foundry's Signal Dashboard and product dashboards replace the "Metabase dashboard for the CEO" pattern with agent-curated intelligence that surfaces what matters, not just what was queried
- Manual metric monitoring and threshold alerts -- SCP agents continuously monitor metrics and trigger risk state transitions, replacing Metabase pulses and manual alert configuration
- Periodic metric synthesis -- weekly digests and agent briefings replace the process of opening Metabase, reviewing dashboards, and synthesizing takeaways manually

### Integrates with (stays):
- **Metabase / Looker / Tableau** stays for team-wide analytics -- data analysts, product managers, and engineers need self-service query tools and custom visualizations that Foundry does not provide; Foundry serves the founder, not the analytics team
- **dbt + warehouse** stays as data infrastructure -- Foundry does not replace the data pipeline; it could consume warehouse data as an input but does not model, transform, or store analytical data at scale
- **Fivetran / Airbyte** stays as ingestion -- Foundry's integrations (GitHub, Stripe, Slack, etc.) are direct API connections, not a general-purpose data pipeline
- **Datadog / Grafana** stays for infrastructure monitoring -- Foundry's Sentinel agent monitors at the business level, not the infrastructure level

## Consolidation friction: LOW

Foundry does not compete with BI tools for the analytics team -- it competes for the founder's attention. A founder using Metabase to check daily metrics can replace that specific habit with Foundry's Signal Dashboard without disrupting the analytics team's Metabase usage. The consolidation is narrow (founder's personal dashboard) not broad (company-wide BI). Data migration is minimal because Foundry pulls from source systems directly.

## Key affordance to reduce friction: Provide a Metabase-style "ask a question" interface within the Signal Dashboard where founders can drill into agent-surfaced signals with natural language follow-ups, bridging the gap between curated intelligence and ad-hoc exploration.
