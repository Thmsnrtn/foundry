# Journey 06 — Cross-Company Intelligence Investigation

## Goal

A founder with multiple companies uses Foundry's cross-company intelligence layer to identify patterns, correlations, or risks that are only visible when data from multiple SCP instances is analyzed together.

## Starting State

- Authenticated founder with 3+ companies, all with active SCP and at least 2 weeks of data.
- Companies share some characteristics (similar stack, overlapping customer segments, or correlated revenue patterns).

## Steps (Happy Path)

1. Navigate to fleet intelligence view (or receive a cross-company signal).
2. System surfaces a cross-company insight (e.g., "3 of your 5 companies saw MRR contraction this week — here's the common factor").
3. Founder investigates: drills into the pattern, sees per-company breakdowns.
4. Follows recommendations (e.g., "Company B's churn spike correlates with Company D's pricing change — consider whether customer overlap is a factor").
5. Takes action on one or more companies based on the fleet-level insight.

## Success Criteria

- Cross-company insights are genuinely novel — not just per-company insights repeated.
- Evidence chain is visible: which data points from which companies led to the conclusion.
- Insights link to actionable next steps, not just observations.
- Data isolation is respected — insights use only the founder's own companies.

## Abandonment Criteria

- "Cross-company intelligence" is just a table of per-company metrics side by side.
- Insights are generic ("your companies have different MRR") rather than specific.
- No evidence or reasoning chain — the system asserts correlations without proof.

## Fleet-Size Relevance

This journey is the primary justification for fleet-as-a-product. At fleet size 1, it is impossible. At fleet size 2, it is trivial. The value inflects at 3-5 companies and becomes essential at 10+. The condition matrix must test this journey at every fleet size above 2.
