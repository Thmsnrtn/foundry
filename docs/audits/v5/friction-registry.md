# Foundry v5 — Friction Registry

## Statistics
| Metric | Count |
|--------|-------|
| Total entries | 54 |
| CRITICAL | 16 |
| HIGH | 25 |
| MEDIUM | 10 |
| LOW | 3 |
| Tenancy-critical | 0 |
| Boundary-confusion | 0 |
| Fleet-scale-dependent | 22 |
| FIXED | 0 |
| OPEN | 54 |

## Convergence Thresholds
- CRITICAL in final 3 runs: 1 (target: 0)
- HIGH in final 3 runs: 3 (target: < 5)
- MEDIUM in final 3 runs: 3 (target: < 20)
- Boundary-confusion in final 3 runs: 0 (target: 0)

---

<!-- Entries from Simulation Run 1 (runs 051-075) -->

### CRITICAL Findings

| ID | Run | Type | Description | Status |
|----|-----|------|-------------|--------|
| F-055-A | 055 | fleet-scale | Cross-company intelligence does not exist; J06 journey uncompletable | OPEN |
| F-055-B | 055 | reliability | No DB timeout or circuit breaker; 5-10s blank page under ERR-DB | OPEN |
| F-057-A | 057 | fleet-scale | No fleet-level triage dashboard; O(n) navigation required | OPEN |
| F-057-B | 057 | fleet-scale | Decision queue per-company only; no unified fleet decision view | OPEN |
| F-059-A | 059 | accessibility | Product switcher `<select>` has no aria-label or associated label (layout.ts:182) | OPEN |
| F-059-B | 059 | accessibility | Notification bell has no aria-label; icon-only without accessible name (layout.ts:195) | OPEN |
| F-059-C | 059 | accessibility | Delete modal lacks role="dialog", aria-modal, aria-label, focus trap (privacy.ts:291) | OPEN |
| F-060-E | 060 | accessibility | Auto-submit on select change causes accidental product switches during keyboard nav (layout.ts:182) | OPEN |
| F-061-B | 061 | ux | Deletion modal does not address GitHub artifacts or reversibility | OPEN |
| F-063-A | 063 | fleet-scale | No fleet-level or account-level deletion; O(n) individual deletions required | OPEN |
| F-064-A | 064 | fleet-scale | No fleet-wide export; filename collisions on per-product exports | OPEN |
| F-064-B | 064 | compliance | Audit log hard-capped at 100 entries; no bulk export (audit-log.ts:77) | OPEN |
| F-065-B | 065 | security | GitHub access tokens may not be revoked during deletion; stored in plaintext | OPEN |
| F-068-B | 068 | fleet-scale | No company archive/pause option; only permanent deletion exists | OPEN |
| F-068-C | 068 | fleet-scale | No SCP pause/retire; agents waste API credits on dead products | OPEN |
| F-069-B | 069 | reliability | Synchronous export may timeout under DB latency; no async mechanism | OPEN |
| F-070-B | 070 | fleet-scale | No archive/revive capability; permanent deletion incompatible with studio workflows | OPEN |
| F-073-C | 073 | reliability | Export times out under ERR-DB for non-technical users | OPEN |

### HIGH Findings

| ID | Run | Type | Description | Status |
|----|-----|------|-------------|--------|
| F-051-B | 051 | fleet-scale | Team members cannot be scoped to specific companies | OPEN |
| F-052-B | 052 | compliance | Audit log limited to 100 entries, no bulk export for compliance | OPEN |
| F-053-A | 053 | fleet-scale | No discoverable "Add Company" entry point at fleet size 1 | OPEN |
| F-053-C | 053 | fleet-scale | No fleet view at 2-company level; single-company-at-a-time only | OPEN |
| F-055-C | 055 | fleet-scale | Benchmarks is peer comparison, not fleet comparison | OPEN |
| F-055-D | 055 | fleet-scale | Network Intelligence is per-product, not cross-fleet | OPEN |
| F-056-B | 056 | workflow | Resolve/dismiss remediation does not trigger GitHub PR merge | OPEN |
| F-057-C | 057 | fleet-scale | Fleet triage is O(n); fails sub-linear scaling target at F15 | OPEN |
| F-057-D | 057 | ux | No multi-seat, no admin console, no usage analytics | OPEN |
| F-059-D | 059 | accessibility | Sidebar nav lacks aria-label to distinguish nav regions (layout.ts:293) | OPEN |
| F-060-B | 060 | accessibility | Add-company flow compound inaccessibility | OPEN |
| F-060-C | 060 | fleet-scale | No fleet-level view accessible via screen reader | OPEN |
| F-060-D | 060 | accessibility | No keyboard shortcuts for product switching | OPEN |
| F-061-A | 061 | ux | Company retirement hidden in Privacy settings, not product management | OPEN |
| F-061-C | 061 | ux | Post-deletion feedback is generic "Settings saved" not deletion confirmation | OPEN |
| F-062-C | 062 | ux | No feedback mechanism to improve agent recommendation quality | OPEN |
| F-063-B | 063 | fleet-scale | No fleet-wide data export | OPEN |
| F-063-C | 063 | ux | Deleted products remain in navigation during 30-day deletion window | OPEN |
| F-063-D | 063 | workflow | No billing cancellation prompt after all products deleted | OPEN |
| F-065-A | 065 | compliance | Deletion scope vaguely described; does not enumerate all data types | OPEN |
| F-065-C | 065 | fleet-scale | No fleet-level deletion; serial deletion required | OPEN |
| F-065-D | 065 | compliance | No deletion receipt or confirmation email | OPEN |
| F-065-E | 065 | ux | No founder account deletion; orphaned accounts after product deletion | OPEN |
| F-066-B | 066 | fleet-scale | No fleet view with sorting/filtering for companies | OPEN |
| F-066-C | 066 | fleet-scale | No batch operations across companies | OPEN |
| F-068-A | 068 | ux | No catch-up summary for returning users after extended absence | OPEN |
| F-068-D | 068 | ux | Binary choice: permanent deletion or continued wasteful operation | OPEN |
| F-069-A | 069 | reliability | 5-10 second page load under ERR-DB with no loading indication | OPEN |
| F-069-C | 069 | reliability | Audit log slow and incomplete under ERR-DB | OPEN |
| F-070-A | 070 | ux | Company retirement conceptually misplaced in Privacy | OPEN |
| F-070-C | 070 | fleet-scale | Zombie products during 30-day deletion may block new additions | OPEN |
| F-071-B | 071 | compliance | No account deletion; evaluation accounts cannot be fully cleaned up | OPEN |
| F-072-A | 072 | ux | Company removal not intuitive for non-technical users | OPEN |
| F-072-C | 072 | ux | Post-deletion zombie company in product switcher | OPEN |
| F-073-A | 073 | reliability | 5-10 second blank page under ERR-DB | OPEN |
| F-073-B | 073 | ux | JSON export unusable for non-technical founders | OPEN |
| F-073-D | 073 | ux | No human-readable export format (PDF, CSV, formatted report) | OPEN |
| F-074-B | 074 | fleet-scale | No fleet view at 4+ companies; single-company model strains | OPEN |
| F-074-C | 074 | fleet-scale | Command palette lacks product switching capability | OPEN |

### MEDIUM Findings

| ID | Run | Type | Description | Status |
|----|-----|------|-------------|--------|
| F-051-A | 051 | fleet-scale | No per-company billing breakdown for Investor-Ready fleet | OPEN |
| F-052-A | 052 | compliance | JSON-only export format, no CSV option for auditors | OPEN |
| F-052-C | 052 | fleet-scale | No fleet-wide bulk export; must repeat per company | OPEN |
| F-053-B | 053 | reliability | Silent SCP provisioning failure for second company | OPEN |
| F-054-B | 054 | ux | Upgrade path from Solo to Growth not clearly communicated | OPEN |
| F-056-A | 056 | ux | No inline diff review for remediations; must leave Foundry for GitHub | OPEN |
| F-056-C | 056 | fleet-scale | No cross-company remediation queue | OPEN |
| F-058-A | 058 | compliance | Data residency selection not enforced ("coming soon") | OPEN |
| F-058-C | 058 | compliance | 30-day deletion schedule with no cancellation window documented | OPEN |
| F-059-E | 059 | accessibility | Inconsistent sidebar sections: some details/summary, others div | OPEN |
| F-060-A | 060 | ux | Company count limits per tier not communicated | OPEN |
| F-061-D | 061 | workflow | Data deletion and subscription cancellation are separate workflows | OPEN |
| F-062-A | 062 | ux | No in-app tier downgrade with feature comparison | OPEN |
| F-062-B | 062 | retention | No value summary on billing page for churning users | OPEN |
| F-064-C | 064 | ux | Export filename does not include product name, causing collisions | OPEN |
| F-067-B | 067 | reliability | Audit pipeline lacks progress indication and resilience | OPEN |
| F-067-C | 067 | ux | Time-to-first-briefing may exceed 5-minute target | OPEN |
| F-069-D | 069 | ux | No date-range-specific export for compliance snapshots | OPEN |
| F-071-A | 071 | ux | 30-day deletion delay excessive for test/evaluation accounts | OPEN |
| F-071-C | 071 | compliance | No deletion receipt or confirmation | OPEN |
| F-072-B | 072 | ux | Deletion wording is intimidating; no partial preservation option | OPEN |
| F-074-A | 074 | ux | Growth tier company limit unclear | OPEN |
| F-075-A | 075 | mobile | Privacy not accessible via mobile bottom nav on tablet | OPEN |
| F-075-C | 075 | ux | Export recommendation in deletion modal may be overlooked | OPEN |

### LOW Findings

| ID | Run | Type | Description | Status |
|----|-----|------|-------------|--------|
| F-051-C | 051 | fleet-scale | Product switcher lacks search at 12+ companies | OPEN |
| F-054-A | 054 | mobile | Settings page may require horizontal scrolling on 390px mobile | OPEN |
| F-058-B | 058 | compliance | Export completeness not documented; JSON format only | OPEN |
| F-066-A | 066 | mobile | Tablet layout may have sidebar compression or dual-nav rendering | OPEN |
| F-067-A | 067 | reliability | Clerk webhook race condition, mitigated by auto-provisioning | OPEN |
| F-075-B | 075 | ux | No form submission loading indicator on slow network | OPEN |

---

## Cross-Company Boundary Summary (Runs 051-075)

| Run | Boundary Status | Notes |
|-----|----------------|-------|
| 051 | PASS | Product switching correctly isolates data via cookie + owner_id |
| 052 | PASS | Export correctly product-scoped |
| 053 | PASS | Boundary maintained during product switching |
| 054 | N/A | Single company |
| 055 | PASS | Manual product switching correct, but journey uncompletable |
| 056 | PASS | Remediation data correctly scoped per product |
| 057 | PASS | No boundary confusion during rapid switching across 5 companies |
| 058 | N/A | Single company |
| 059 | PASS (tech) / FAIL (a11y) | Data isolated but switching mechanism inaccessible |
| 060 | PASS (tech) / FAIL (a11y) | Auto-submit causes unintended switches during keyboard nav |
| 061 | N/A | Single company |
| 062 | N/A | Single company |
| 063 | PASS | Deletion correctly scoped per product |
| 064 | PASS | Export boundary correct |
| 065 | PASS | Product deletion scoped correctly |
| 066 | PASS | Data isolated during tablet-based switching |
| 067 | N/A | New account, single company |
| 068 | PASS | Dead and live company data correctly isolated |
| 069 | N/A | Single company |
| 070 | PASS | Data correctly isolated across 5 test companies |
| 071 | N/A | Single company |
| 072 | PASS | Company deletion does not affect siblings |
| 073 | N/A | Single company |
| 074 | PASS | Data correctly isolated across 4 companies during rapid switching |
| 075 | PASS | Deletion of one company does not affect siblings |

**Boundary confusion incidents: 0**
**Accessible boundary failures: 2** (runs 059, 060 -- product switcher inaccessible to screen reader users)
