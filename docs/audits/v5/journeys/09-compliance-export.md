# Journey 09 — Compliance Export (GDPR-Style)

## Goal

A founder exercises their right to a complete data export — either for internal compliance requirements, regulatory response, or personal data portability. The export must be comprehensive, machine-readable, and delivered within a reasonable time window.

## Starting State

- Authenticated founder with 1-15 companies.
- May have months of accumulated agent activity, signals, decisions, audits, and briefings.
- Triggered by either a regulatory requirement or pre-churn data preservation.

## Steps (Happy Path)

1. Navigate to settings → "Export My Data" or "Compliance Export."
2. Select scope: all companies, specific companies, or specific data categories.
3. Choose format: JSON (machine-readable) or CSV (spreadsheet-compatible).
4. Initiate export → system queues the job.
5. Receive notification when export is ready (email + in-app).
6. Download export archive (ZIP with structured directories).
7. Verify: export contains all agent logs, decisions, signals, audit reports, account data.

## Success Criteria

- Export is complete — no data categories silently omitted.
- Format is documented (schema included in the export archive).
- Export completes within 1 hour for even the largest accounts.
- Download link is time-limited and authenticated (no public URLs for sensitive data).
- Export manifest lists exactly what is included and what, if anything, is excluded (with justification).

## Abandonment Criteria

- No self-service export — requires emailing support.
- Export is incomplete (e.g., agent prompts/responses excluded, decision history missing).
- Export format is undocumented or proprietary.

## Fleet-Size Relevance

Export size and complexity scale with fleet size. At 15 companies with months of SCP data, the export could be substantial. Test export performance at 1, 5, and 15 companies. Also test selective export (single company from a fleet) to ensure data isolation — the export for Company A must not leak data from Company B.
