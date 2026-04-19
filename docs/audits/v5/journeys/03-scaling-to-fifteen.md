# Journey 03 — Scaling to 15-Company Fleet

## Goal

A power user progressively adds companies until the fleet reaches 15. The system must remain performant, navigable, and useful at this scale. UI patterns that work for 2-3 companies must not break at 15.

## Starting State

- Authenticated founder on Investor-Ready tier.
- Currently has 5+ companies with active SCP instances.
- Adding companies in batches of 2-3 over several sessions.

## Steps (Happy Path)

1. Repeated execution of the "add company" flow (Journey 02).
2. Fleet view progressively fills with companies.
3. At 10+ companies, fleet sorting/filtering becomes necessary.
4. At 15 companies, batch operations become essential.
5. Fleet-level triage: scan all companies, identify outliers, drill into exceptions.

## Success Criteria

- Fleet view loads in under 2 seconds with 15 companies.
- Companies can be sorted by health, MRR, risk state, last-updated.
- Batch actions available: approve all low-risk remediations, dismiss info signals.
- Keyboard navigation supports rapid company switching (j/k or arrow keys).
- Fleet summary statistics (total MRR, companies in red, pending decisions) visible without scrolling.

## Abandonment Criteria

- Page load degrades noticeably beyond 8-10 companies.
- No sorting, filtering, or grouping — all 15 companies shown in a flat unsorted list.
- Triage requires clicking into each company individually (O(n) navigation).

## Fleet-Size Relevance

This is the primary fleet-scale stress test. Most UI and performance assumptions are calibrated for 1-3 companies. This journey validates that Foundry genuinely works as a fleet-management control plane at its advertised upper bound. Every condition axis (network speed, screen size, accessibility) should be tested at this fleet size.
