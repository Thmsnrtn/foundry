# Journey 07 — Company Retirement / Archival

## Goal

A founder decides to wind down one company in their fleet — either the product is shutting down, being sold, or is no longer worth monitoring. The company should be cleanly removed from the active fleet without affecting other companies, and historical data should be archived and accessible.

## Starting State

- Authenticated founder with 2+ companies.
- One company is being retired (SCP agents still running, data still accumulating).
- Founder has decided this company no longer needs active monitoring.

## Steps (Happy Path)

1. Navigate to company settings → "Retire Company" or equivalent.
2. System explains what retirement means: agents stop, data archived, billing adjusted.
3. Founder confirms retirement decision.
4. SCP agents for this company are gracefully stopped (pending decisions resolved or dismissed).
5. Company moves to "Archived" state — visible in fleet history but not in active fleet.
6. Billing adjusts: per-company pricing decreases by one unit.
7. Founder can view archived data read-only but no new agent activity occurs.

## Success Criteria

- Retirement flow is self-service (no support ticket required).
- Clear explanation of what stops, what is preserved, and how billing changes.
- Other companies in the fleet are completely unaffected.
- Archived company data remains accessible for at least 90 days.
- Retirement is reversible within a defined window (e.g., 30 days).

## Abandonment Criteria

- No retirement option — only full company deletion (data loss).
- Retiring a company breaks fleet-level aggregations for remaining companies.
- Billing does not adjust — founder is still charged for the retired company.

## Fleet-Size Relevance

Company retirement is a fleet lifecycle operation. Studios and holding companies regularly spin down products. If retirement is painful, founders will avoid adding companies to Foundry in the first place. Test at fleet sizes 2→1 (last active company edge case), 5→4 (mid-fleet), and 15→14 (at scale).
