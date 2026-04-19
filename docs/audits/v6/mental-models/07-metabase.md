# Mental Model: Metabase User -> Foundry

## What they expect (from Metabase experience)
1. Connect to a database and explore data with a visual query builder or SQL
2. Build custom dashboards with drag-and-drop charts, filters, and drill-through
3. Set up alerts and scheduled reports (pulses) when metrics cross thresholds
4. Ask natural language questions about their data via Metabot
5. Embed analytics into their own product for customer-facing dashboards

## Where they look in Foundry
- Data exploration: They look for a query builder or data browser. Foundry has no user-facing data exploration -- all analytics are agent-mediated. The founder sees Signal Dashboard outputs, not raw data with query tools.
- Custom dashboards: They look for a dashboard builder. Foundry's dashboards are pre-built (59 authenticated page routes). No drag-and-drop customization, no user-created charts or collections.
- Alerts / pulses: They look for threshold-based notifications. Foundry has digests (weekly/yellow/red) and the notification system, which partially maps. Risk state transitions (Green->Yellow->Red) are the alert mechanism, but the user cannot define custom alert conditions.
- Natural language queries: Foundry has conversation threads with AI context. This maps reasonably well -- the founder can ask questions and get contextual answers. However, the AI reasons across SCP context, not against a queryable data model.
- Embedded analytics: No equivalent. Foundry has no embeddable components for external products. The portfolio layer has an API but no embeddable widgets.

## Vocabulary differences
- "Question" -> Foundry uses "Conversation" (AI chat) or "Signal" (agent-surfaced insight)
- "Dashboard" -> Foundry uses "Signal Dashboard" (pre-built, not customizable)
- "Collection" -> No equivalent (Foundry organizes by Product, not data collections)
- "Pulse" / "Alert" -> Foundry uses "Digest" (scheduled) or "Risk State Change" (event-driven)
- "Metric" / "Dimension" -> Foundry uses "Signal" (agent-detected) or "Stressor" (risk indicator)
- "Semantic Layer" -> No equivalent (agents use raw data + golden lessons, not a curated model)
- "Tenant" -> Foundry uses "Product" (the scoped entity)

## Mental model mismatch severity: MEDIUM
## Key translation needed: Metabase users expect self-service data exploration and custom visualization; Foundry provides agent-curated intelligence where the analytical work is done for you -- the tradeoff is control for autonomy.
