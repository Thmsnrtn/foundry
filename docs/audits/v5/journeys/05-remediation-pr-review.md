# Journey 05 — Remediation Engine PR Review

## Goal

An agent identifies a blocking issue during an audit, classifies it as AUTO-remediable, generates a PR via the GitHub API, and the founder reviews, approves, and merges it — or rejects it with feedback.

## Starting State

- Company has completed at least one audit cycle.
- Audit scoring identified a blocking issue (e.g., missing rate limiting, plaintext secrets).
- Remediation engine classified the fix as AUTO (no human judgment needed for the fix itself, but founder approval required to merge).

## Steps (Happy Path)

1. Agent generates remediation: branch creation → code changes → PR opened.
2. Founder receives notification (in-app signal + optional email digest).
3. Founder navigates to the remediation detail view within Foundry.
4. Reviews: what changed, why, which audit dimension it addresses, risk assessment.
5. Clicks through to GitHub PR for code-level review.
6. Approves within Foundry → PR merged (or merges directly on GitHub).
7. Next audit cycle confirms the issue is resolved.

## Success Criteria

- PR description clearly explains what was found, why it matters, and what the fix does.
- Founder can understand the remediation without reading the raw diff.
- Approval/rejection flow is 2 clicks maximum from the notification.
- Rejected remediations accept founder feedback that improves future generations.
- Merged remediations are reflected in the next audit score.

## Abandonment Criteria

- PR is low-quality (breaks tests, introduces new issues, wrong file paths).
- No context provided — founder must read raw diff to understand intent.
- Approval flow requires leaving Foundry and navigating GitHub manually.

## Fleet-Size Relevance

At fleet scale, multiple companies may have pending remediations simultaneously. The triage surface (Journey 04) should allow batch review of remediations across companies. A founder with 15 companies should not need to visit 15 separate remediation queues.
