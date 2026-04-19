# Mental Model: Runway User -> Foundry

## What they expect (from Runway experience)
1. Build and maintain a connected financial model with live data from 750+ integrations
2. Run scenario analysis (best/base/worst) to evaluate strategic decisions
3. Forecast cash runway, headcount costs, and revenue trajectories
4. Collaborate with team members on shared financial plans with variance tracking
5. Ask an AI analyst natural language questions about their financial model

## Where they look in Foundry
- Financial modeling: They look for a model builder or planning workspace. Foundry has Ledger (Finance agent) and a financial simulator in the intelligence layer, but no user-editable model -- the agent produces insights, not a manipulable model.
- Scenario analysis: Foundry has scenario modeling (best/base/stress) in the intelligence layer for Gate 3 decisions. This partially maps, but scenarios are agent-generated rather than user-constructed. The user cannot define custom assumptions.
- Cash runway / forecasting: The intelligence layer tracks MRR decomposition and revenue metrics. Cash runway is derivable but not a first-class display. No headcount modeling.
- Collaboration: Foundry is single-founder. No collaborative editing, no team roles beyond the founder, no shared workspace for finance teams.
- AI analyst: Foundry has conversation threads (AI chat with context), which is the closest analog. However, the context is SCP-wide (all agents), not narrowly financial.

## Vocabulary differences
- "Model" -> Foundry uses "Intelligence Layer" (agent-generated, not user-built)
- "Driver" / "Assumption" -> No user-editable equivalent; agents use internal parameters
- "Variance" -> Foundry uses "Risk State" (Green/Yellow/Red) as the anomaly signal
- "Forecast" -> Foundry uses "Scenario" (agent-generated projections)
- "Headcount Plan" -> No equivalent
- "Actuals vs Plan" -> Foundry surfaces "Signals" and "Stressors" instead

## Mental model mismatch severity: MEDIUM
## Key translation needed: Runway users expect to build and manipulate their own financial models; Foundry's financial intelligence is agent-driven and opinionated -- the founder reviews and approves rather than constructs.
