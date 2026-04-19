# Audit Documentation Reality Notice

The documents in v3/, v4/, v5/, and v6/ subdirectories were produced
across multiple rigor engagements between 2026-04-17 and 2026-04-19.

Some of those documents describe architecture that was never implemented
in code. Specifically:

- Fleet-level meta-agents (FleetOracle, FleetSentinel, PortfolioLedger,
  FleetObservatory) — specs only at `docs/scp/fleet-agents/`, no implementation
  on master or any branch (verified via `docs/audits/unmerged-work-inventory.md`)
- Multi-organization / multi-tenant control plane architecture — the
  current codebase is single-tenant with multi-product support (one founder,
  multiple products), not multi-organization
- Cross-company intelligence with consent enforcement — the
  `decision_patterns` table exists and consent gates writes, but no service
  reads it to generate cross-company insights for users
- Five-stage company lifecycle board — documented, not built
- SCP instance manager UI — documented, not built
- Fleet Observatory — documented, not built

For current product reality, see `docs/audits/reality-check.md`.
For git-state verification (branches, stashes, PRs), see `docs/audits/unmerged-work-inventory.md`.

These audit documents remain committed because:
1. The security, reliability, and compliance findings within them are
   real, were implemented, and the fixes remain valuable
2. They may serve as a forward-looking roadmap if Foundry chooses to
   build the fleet layer in the future
3. They represent honest working frames from the rigor engagements,
   not retrospective claims about what was shipped

---

## Fixes from v3-v6 engagements that ARE in shipped code

- **Token encryption** — AES-256-GCM envelope encryption (`src/services/encryption.ts`) for GitHub access tokens
- **CSRF protection** — Double-submit cookie middleware (`src/middleware/csrf.ts`) on all authenticated routes
- **XSS prevention** — HTML escaping on share page (`src/routes/share/index.ts`)
- **Security headers** — CSP, HSTS, X-Frame-Options (`src/middleware/security-headers.ts`)
- **GitHub OAuth CSRF** — State parameter + validation via `oauth_states` table
- **Prompt injection sanitization** — XML tag stripping + denylist (`src/services/ai/sanitize.ts`)
- **PII redaction** — Email/phone removal before LLM prompts (`src/services/ai/sanitize.ts`)
- **AI cost ceiling** — Per-product $25/day cap with timeout + retry (`src/services/ai/client.ts`)
- **Graceful shutdown** — SIGTERM/SIGINT handlers (`src/index.ts`)
- **Health check** — Database connectivity verification (`src/routes/internal/health.ts`)
- **Foreign key enforcement** — PRAGMA at client init (`src/db/client.ts`)
- **Webhook idempotency** — Stripe event dedup table (`src/db/migrations/055_webhook_idempotency.sql`)
- **Distributed job locks** — Prevent cron double-execution (`src/services/job-lock.ts`)
- **Batch transactions** — Atomic SCP provisioning (`src/services/scp/provisioner.ts`)
- **RBAC enforcement** — Role-based access on settings/team/billing routes
- **Tier gate enforcement** — `requireTier()` on API routes + portfolio
- **Dunning handler** — Failed payment + past-due notifications
- **Data deletion executor** — Processes scheduled deletions (`src/services/privacy/consent.ts`)
- **GDPR consent defaults** — All opt-out per Article 7
- **Portfolio view enhancement** — Signal scores, risk states, pending decisions per product
- **Company pause/resume** — Lifecycle management in settings
- **Fleet-wide export/delete** — Across all founder's products
- **Audit log pagination + CSV export** — Compliance-ready
- **DB query timeout** — 10s default
- **Returning-user catch-up summary** — Dashboard delta since last visit
- **Self-hosted HTMX** — Removed CDN dependency
- **OpenRouter migration** — Single API key for all LLM calls
- **Privacy Policy + Terms of Service** — Legal pages at `/privacy` and `/terms`
- **Disaster recovery plan** — `docs/operations/disaster-recovery.md`
- **GDPR Article 30 records** — `docs/compliance/gdpr-article-30.md`
- **CI pipeline** — GitHub Actions at `.github/workflows/ci.yml`
- **Landing page redesign** — Dual-layer positioning (v6)

## Architecture described in v3-v6 docs that is NOT in shipped code

- **FleetOracle** — Cross-company pattern identification agent (spec at `docs/scp/fleet-agents/fleet-oracle.md`)
- **FleetSentinel** — Risk correlation monitor across companies (spec at `docs/scp/fleet-agents/fleet-sentinel.md`)
- **PortfolioLedger** — Fleet financial intelligence agent (spec at `docs/scp/fleet-agents/portfolio-ledger.md`)
- **FleetObservatory** — Real-time agent activity dashboard (spec at `docs/scp/fleet-agents/fleet-observatory.md`)
- **Cross-company intelligence service** — No code reads `decision_patterns` to generate insights
- **Five-stage company lifecycle board** — Lifecycle states exist but no board UI
- **SCP instance manager** — No provision/pause/retire/migrate UI beyond basic settings pause
- **Multi-organization architecture** — No `organizations` table; single-founder-per-account model
- **Validated lifecycle state transitions** — No transition enforcement; any state can be set
- **Fleet-level cost ceiling** — In-memory per-instance, resets on deploy
- **150-lens convergence sweeps** — These audited the code that exists; the sweep format and some findings assume fleet-scale behaviors
- **Golden eval test suites** — Referenced in agent specs but not wired into CI
