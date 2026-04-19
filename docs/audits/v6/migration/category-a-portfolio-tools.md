# Consolidation: Category A (Portfolio Operator Tools) -> Foundry

## Typical prospect's existing stack
- **Visible.vc** for portfolio monitoring, KPI collection, LP reporting
- **Carta** for cap table management, 409A valuations, fund administration
- **Airtable / Google Sheets** for deal flow tracking and custom portfolio views
- **DocSend / Dropbox** for data rooms and document sharing
- **Email + Slack** for investor-portfolio company communication

## What Foundry replaces vs integrates

### Replaces:
- Portfolio-level performance dashboards (Visible's consolidated KPI views) -- Foundry's portfolio layer and cross-company intelligence provide operational performance views that go beyond metric collection into autonomous analysis
- Manual portfolio health monitoring -- SCP agents running per company replace the "collect data, review manually" workflow with continuous autonomous monitoring
- Board packet generation -- Foundry's portfolio layer already generates board packets

### Integrates with (stays):
- **Carta** stays -- cap table management, equity administration, 409A valuations, and fund accounting are legal/financial record-keeping that Foundry does not and should not replicate
- **Visible.vc** partially stays -- LP reporting and investor-facing communication remain in Visible unless Foundry builds LP-specific outputs; Visible's MCP server could feed data into Foundry
- **DocSend / data rooms** stay -- document management is outside Foundry's scope
- **Airtable** for deal flow stays -- pre-investment pipeline is not Foundry's domain

## Consolidation friction: HIGH

Foundry does not operate in the investor's workflow -- it operates in the founder's workflow. Category A tools serve GPs, fund ops teams, and LPs. Foundry serves founders running companies. The portfolio/investor layer creates partial overlap, but a GP cannot replace Visible or Carta with Foundry because Foundry does not model fund structures, equity, or LP relationships. Consolidation is only possible for founders who also manage a portfolio of their own companies (serial founders, studio operators), not for institutional investors.

## Key affordance to reduce friction: Build a read-only investor portal that surfaces SCP intelligence per company in a format investors already expect (KPI tables, trend charts, health scores), so investors can consume Foundry data without needing to adopt Foundry as their primary tool.
