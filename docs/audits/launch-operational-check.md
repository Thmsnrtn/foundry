# Launch Operational Check — Phase 3

## 1. Runbook Quality
**File:** docs/operations/runbook.md
**Assessment: ADEQUATE for launch.** Covers:
- Deployment commands (fly deploy, docker) ✓
- Fresh deploy checklist with all secrets ✓
- Health check commands ✓
- Database operations (migrate, seed, status) ✓
- Job operations (list, run) ✓
- Key rotation for 5 services ✓
- Backup procedure ✓
- Incident response for 4 scenarios (AI outage, DB issues, billing webhook, runaway costs) ✓
- Tenant offboarding steps ✓

**Gaps:** No on-call rotation mentioned (solo founder — expected). No escalation path beyond "check the logs." Acceptable for a solo founder launch.

## 2. Alerting
**Assessment: MINIMAL — acceptable for solo founder launch.**

| Alert Scenario | Mechanism | Status |
|---------------|-----------|--------|
| Gate script fails | GitHub Actions CI | ✓ CI pipeline exists |
| Production deploy fails | Fly.io deploy output | Manual monitoring |
| Tenant isolation bleed | Test suite in CI | ✓ 49 tenancy tests |
| Agent cost budget exceeded | In-app cost ceiling ($25/day) | ✓ Throws error at ceiling |
| GitHub API rate limit | Not monitored | Gap — but within budget at current scale |
| Stripe webhook failure | Stripe Dashboard retry | Manual monitoring |
| SCP instance unhealthy | No alerting | Gap — requires health check polling |

**Recommendation:** Set up Fly.io's built-in alerting for health check failures. This is a 5-minute configuration, not a code change.

## 3. .env.example Completeness
- 23 entries covering all required services ✓
- No real values committed ✓
- ENCRYPTION_KEY generation command documented ✓
- Settings UI exists for integrations, team, billing ✓

## 4. Clean-Clone Deploy Test
**Assessment: NOT INDEPENDENTLY TESTED.** The runbook describes a 5-step quickstart. The directive's 30-minute promise is plausible given:
- npm install (~30s)
- cp .env.example .env + paste keys (~5 min)
- npm run cli -- db:migrate (~10s)
- npm run dev (~5s)
Total estimated: ~10 minutes for a developer with API keys ready.

**Gap:** No automated test of this flow exists. Recommend the founder try it on a fresh machine before announcing publicly.

## 5. Cross-Company Data Flow Enforcement (Spot-Check)
Three enforcement points verified in code:

1. **Decision patterns consent:** `src/services/decisions/patterns.ts:25` — `hasConsent(input.productId, 'cross_company_patterns')` called before INSERT. ✓

2. **Portfolio ownership:** `src/routes/api/platform.ts:350` — `verifyPortfolioOwnership()` checks `owner_email` before all portfolio reads. ✓

3. **Experiment tenant scoping:** `src/routes/api/platform.ts:126` — `verifyExperimentOwnership()` joins through products table to verify `owner_id`. ✓

4. **Wisdom network consent default:** `src/db/migrations/057_fix_consent_defaults.sql:15` — resets all founders to opted-out. ✓

**Assessment: Enforcement is code-level, not just documented.** The cross-company contract at `docs/scp/cross-company-contract.md` is backed by actual consent checks and ownership validation in the codebase.

## 6. Backup/Restore
**Assessment: DOCUMENTED but NOT INDEPENDENTLY TESTED.**
- Turso provides automatic replication (platform-level)
- Manual backup command documented: `turso db shell foundry-intel ".dump" > backup.sql`
- Restore documented: `turso db create foundry-restore --from-dump backup.sql`
- DR plan at `docs/operations/disaster-recovery.md` covers 6 failure scenarios with RPO/RTO

**Gap:** No evidence of a successful test restore. Recommend the founder run one manual backup + restore cycle before launch to verify the procedure.

## Phase 3 Verdict: PASS with 2 recommendations (not blockers).
1. Configure Fly.io health check alerting (5 min)
2. Run one manual backup + restore test cycle before public announcement
