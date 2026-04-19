# Mental Model: Causal User -> Foundry

## What they expect (from Causal experience)
1. Build financial models with human-readable formulas and structured variables
2. Compare multiple scenarios side-by-side with assumption toggles
3. Consolidate multi-entity financials with automatic currency conversion
4. Create dashboards from model outputs for stakeholder reporting
5. Learn the tool's core concepts in under 30 minutes and be productive in hours

## Where they look in Foundry
- Model builder: They look for a formula/variable editor. Foundry has no user-facing model construction -- the intelligence layer generates analysis autonomously. The "Causal way" of defining variables and relationships has no counterpart.
- Scenario comparison: Foundry's intelligence layer generates best/base/stress scenarios, but there is no side-by-side comparison UI or assumption toggling. Scenarios appear in decision context, not as a standalone planning tool.
- Multi-entity consolidation: The portfolio layer provides basic cross-product views, but no financial consolidation with currency conversion or inter-entity elimination. Entities are "Products" not financial reporting units.
- Dashboards: The Signal Dashboard and product dashboards exist but display agent signals, not model-derived KPIs. No custom dashboard builder.
- Quick onboarding: Foundry's conceptual surface (12 agents, 5 gates, 5 lifecycle stages, risk states) is significantly larger than Causal's model/variable/scenario triad. Progressive disclosure would need to hide most complexity initially.

## Vocabulary differences
- "Variable" -> No equivalent (Foundry uses "Metric" or "Signal" but these are observed, not defined)
- "Formula" -> No equivalent (intelligence is agent-generated, not formula-driven)
- "Scenario" -> Foundry uses "Scenario" (same word, but agent-generated vs user-built)
- "Consolidation" -> Foundry uses "Portfolio" (aspirational cross-company views)
- "Template" -> Foundry uses "Audit" (pre-built analysis pipeline, not a user model template)
- "Dashboard" -> Foundry uses "Signal Dashboard" (agent output, not model output)

## Mental model mismatch severity: HIGH
## Key translation needed: Causal users expect to define their own analytical logic through formulas and variables; Foundry provides pre-built autonomous intelligence where the agents own the analytical logic and the founder governs outcomes.
