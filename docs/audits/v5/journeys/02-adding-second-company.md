# Journey 02 — Adding Second Company (1 to 2)

## Goal

An existing founder with one company running SCP adds a second company and begins managing both from the fleet view. This is the first encounter with multi-company mechanics.

## Starting State

- Authenticated founder with one active company and running SCP.
- Subscription tier permits multi-company (Growth or Investor-Ready).
- Second product has a GitHub repository ready to connect.

## Steps (Happy Path)

1. Navigate to fleet view or settings → "Add Company."
2. Enter second company details: name, repo URL, description.
3. GitHub OAuth for second repo (may reuse existing token or require re-auth).
4. Audit pipeline runs for second company.
5. SCP provisions 12 agents for second company.
6. Fleet view now shows both companies side-by-side.
7. Founder can switch between companies and see fleet-level summaries.

## Success Criteria

- Adding a second company does not require re-entering information already known.
- Fleet view clearly distinguishes both companies with at-a-glance health.
- Cross-company comparisons are available immediately (even if limited by data).
- The "add company" flow is under 3 minutes.

## Abandonment Criteria

- Tier gate blocks the action with no upgrade path shown inline.
- Fleet view is identical to single-company view — no visible value from fleet.
- Second company's SCP initialization failures are not surfaced to the founder.

## Fleet-Size Relevance

This is the critical 1→2 transition. It is where the fleet concept either clicks or confuses. The UI must communicate that managing two companies together is meaningfully better than managing them separately. This journey stress-tests fleet view layout, company switching, and cross-company comparison at the smallest multi-company scale.
