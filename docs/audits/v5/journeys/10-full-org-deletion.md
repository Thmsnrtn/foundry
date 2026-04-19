# Journey 10 — Full Organization Deletion (Churn Path)

## Goal

A founder who has decided to leave Foundry permanently deletes their entire organization — all companies, all data, all agent history — cancels billing, and receives confirmation that no data is retained beyond what is legally required.

## Starting State

- Authenticated founder with 1-15 companies.
- Has made the decision to leave (frustration, cost, switching to competitor, or simply shutting down).
- May have already exported data (Journey 09) or may not care.

## Steps (Happy Path)

1. Navigate to settings → "Delete Organization" or "Close Account."
2. System warns: this is irreversible after the grace period (e.g., 30 days).
3. System itemizes what will be deleted: companies, agent data, billing info, integrations.
4. Founder is offered a final data export before deletion.
5. Founder confirms with explicit action (type org name, re-authenticate, or similar).
6. Stripe subscription cancelled immediately — no further charges.
7. All SCP agents stopped across all companies.
8. GitHub integrations disconnected (tokens revoked).
9. Grace period begins: data soft-deleted, account inaccessible but recoverable.
10. After grace period: hard deletion. Confirmation email sent.

## Success Criteria

- Entire deletion flow is self-service, completable in under 5 minutes.
- No hidden retention — founder is told exactly what is kept (e.g., anonymized aggregate data) and why.
- Billing stops immediately upon deletion initiation, not at period end.
- GitHub tokens and integration credentials are revoked, not just orphaned.
- Grace period allows recovery if the founder changes their mind.
- Post-deletion confirmation email includes timestamp and deletion receipt.

## Abandonment Criteria

- Deletion requires contacting support (dark pattern).
- Unclear what "deletion" means — soft delete masquerading as hard delete.
- Billing continues after deletion is initiated.
- No confirmation or receipt — founder cannot prove data was deleted.

## Fleet-Size Relevance

Deletion complexity scales with fleet size. At 15 companies, deletion involves stopping 180 agent instances (12 per company), revoking 15+ GitHub tokens, and cleaning up potentially gigabytes of accumulated data. Test at fleet sizes 1 and 15 to ensure deletion completes reliably and billing adjusts correctly in both cases.
