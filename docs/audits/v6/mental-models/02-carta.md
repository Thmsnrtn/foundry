# Mental Model: Carta User -> Foundry

## What they expect (from Carta experience)
1. Manage cap table -- share classes, stakeholders, vesting schedules, option grants
2. Run 409A valuations and compliance workflows
3. Administer fund entities (LP, GP, SPV) with inter-entity accounting
4. Generate shareholder communications, board consents, and legal documents
5. View portfolio-level oversight with consolidated fund reporting

## Where they look in Foundry
- Cap table management: No equivalent. Foundry has no equity, share, or stakeholder primitives. A Carta user arriving at Foundry would immediately notice the absence of the entire financial structure layer.
- 409A / compliance: No equivalent. Foundry has Shield (Legal agent) but it provides advisory signals, not compliance automation or valuation workflows.
- Fund administration: The portfolio/investor layer models portfolio membership but not fund structures (LP/GP/SPV), capital calls, distributions, or waterfall analysis.
- Legal documents: No document generation for corporate governance. Foundry's Scribe agent produces content, not legal instruments.
- Portfolio oversight: The portfolio dashboard provides basic cross-product views, but not financial consolidation at the fund level.

## Vocabulary differences
- "Cap Table" -> No equivalent (Foundry has no equity layer)
- "Stakeholder" -> Foundry uses "Founder" (the operator, not investors/employees)
- "Valuation" -> No equivalent (Foundry tracks MRR/revenue, not enterprise value)
- "Fund Family" -> Foundry uses "Portfolio" (much simpler model)
- "Board Consent" -> No equivalent
- "Entity" -> Foundry uses "Product" (a SaaS product, not a legal entity)

## Mental model mismatch severity: HIGH
## Key translation needed: Carta users think in terms of legal entities, equity, and compliance; Foundry thinks in terms of operational intelligence for running SaaS products -- the overlap is only at the portfolio-overview level, not in the underlying data model.
