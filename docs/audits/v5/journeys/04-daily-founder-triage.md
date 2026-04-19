# Journey 04 — Daily Founder Triage Across Companies

## Goal

A founder with multiple companies performs their daily morning check: scan the fleet for anything requiring attention, review and act on pending decisions, check agent briefings, and move on — all within 15 minutes regardless of fleet size.

## Starting State

- Authenticated founder with 3-15 companies, all with active SCP.
- Overnight agent cycles have produced new signals, decisions, and briefings.
- Some decisions are pending founder approval (Gate 2+).

## Steps (Happy Path)

1. Log in → land on fleet dashboard.
2. Scan fleet-level summary: any companies in red/yellow? Any critical decisions?
3. Review pending decision queue (cross-company, prioritized).
4. Approve, reject, or defer decisions with inline context.
5. Read today's briefing for any company that changed state.
6. Optionally drill into a specific company for deeper investigation.
7. Log out or move on to other work.

## Success Criteria

- Fleet-level triage completes in under 15 minutes for 15 companies.
- Decision queue is sorted by urgency, not chronology.
- Each decision shows enough context to act without drilling into the company.
- Briefings are concise (under 2 minutes of reading per company).
- Zero unnecessary clicks — every action available from the triage surface.

## Abandonment Criteria

- Morning triage takes longer than managing the companies without Foundry.
- Decision queue mixes low-priority noise with critical items.
- Briefings are repetitive or contain no actionable information.

## Fleet-Size Relevance

Triage time should scale sub-linearly with fleet size. At 3 companies, triage might take 5 minutes. At 15 companies, it should take 15 minutes, not 45. This journey is the primary measure of whether Foundry delivers time savings proportional to fleet size.
