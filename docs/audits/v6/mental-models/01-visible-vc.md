# Mental Model: Visible.vc User -> Foundry

## What they expect (from Visible.vc experience)
1. Send structured KPI requests to portfolio companies on a cadence
2. View a consolidated dashboard of all portfolio company metrics in one place
3. Generate LP-ready reports and board packets from collected data
4. Benchmark portfolio companies against each other and industry peers
5. Maintain an investor CRM with deal flow tracking and data room access

## Where they look in Foundry
- KPI requests: They look for a "request" or "data collection" workflow. Foundry has no outbound data collection mechanism -- SCP agents pull data from integrations, not from human-submitted forms. They find the Signal Dashboard instead, which surfaces agent-detected metrics.
- Consolidated dashboard: They navigate to the portfolio/investor layer. The portfolio dashboard exists but is basic -- no fund-level KPI roll-up comparable to Visible's views.
- LP reporting: They look for "reports" or "export." Foundry has board packet generation in the portfolio layer, which partially maps, but LP-specific formatting is absent.
- Benchmarking: They look for cross-company comparisons. Foundry's cross-company intelligence extraction is aspirational (not yet built), leaving a gap where their core expectation lives.
- Investor CRM: No equivalent. Foundry is founder-facing, not investor-facing. The portfolio layer models membership but not investor relationships.

## Vocabulary differences
- "KPI Request" -> Foundry uses "Signal" (agent-detected) or "Metric" (ingested)
- "Portfolio Company" -> Foundry uses "Product" (the managed entity primitive)
- "LP Report" -> Foundry uses "Board Packet" (partial overlap)
- "Fund" -> No direct equivalent; closest is "Portfolio" in the investor layer
- "Data Room" -> No equivalent in Foundry
- "Benchmark" -> Foundry aspires to "Cross-Company Intelligence" (not yet built)

## Mental model mismatch severity: HIGH
## Key translation needed: Visible users think in terms of passive data collection from companies they invest in; Foundry actively runs autonomous agents inside companies -- the relationship to the entity is operator, not observer.
