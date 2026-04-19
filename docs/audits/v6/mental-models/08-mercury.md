# Mental Model: Mercury User -> Foundry

## What they expect (from Mercury experience)
1. Access a unified financial interface: bank accounts, cards, treasury, bill pay in one view
2. Automate banking operations with rules (sweeps, approval flows, categorization)
3. Onboard in minutes with minimal friction -- digital-first, no legacy process
4. Get a free core product that earns trust before upselling advanced features
5. Manage company finances with a founder-first UX that feels modern and fast

## Where they look in Foundry
- Unified financial view: They look for a financial dashboard showing cash position, burn, and transactions. Foundry's Ledger agent and intelligence layer track MRR and revenue decomposition, but there is no bank account integration, no transaction view, no cash management. Financial data is analytical, not transactional.
- Automation rules: They look for configurable rules (if X then Y). Foundry's agents act autonomously but through a gate system, not user-defined rules. The closest analog is the decision queue, where agents propose actions and the founder approves.
- Quick onboarding: Mercury's "done in 2 minutes" standard is far faster than Foundry's onboarding flow (Clerk auth -> product creation -> GitHub OAuth -> repo analysis -> first audit). Foundry requires integration setup before delivering value.
- Free tier: Mercury's free banking creates zero-friction adoption. Foundry starts at $79/mo (Solo tier), which means every prospect must make a purchasing decision before experiencing the product.
- Modern UX: Mercury sets a high bar for fintech UX. Foundry's server-rendered HTML via Hono + HTMX is functional but the aesthetic expectations of Mercury users are calibrated to best-in-class fintech design.

## Vocabulary differences
- "Account" -> Foundry uses "Product" (a SaaS product, not a financial account)
- "Transaction" -> No equivalent (Foundry tracks metrics/signals, not financial transactions)
- "Treasury" -> No equivalent
- "Rule" -> Foundry uses "Gate" (authority level) or "Decision" (agent-proposed action)
- "Sweep" -> No equivalent
- "Bill Pay" -> No equivalent
- "Automation" -> Foundry uses "SCP Agent" (autonomous intelligence, not rule-based automation)

## Mental model mismatch severity: LOW
## Key translation needed: Mercury users will not confuse Foundry with a banking product, so there is no dangerous overlap -- the risk is UX expectations, where Mercury's polish and speed set a bar that Foundry's server-rendered interface must meet to retain the same founder audience.
