# Implementation State

> Last verified: 2026-08-14. Baseline commit: `cc4af98a3e7afc5c0dc291f8dd3734e8c67dd9d8` on local branch `work` (no Git remote was configured in this checkout). This manifest is evidence, not a claim that every listed surface has been exhaustively audited.

## Tranche 0 baseline reality manifest

| Area | Verified reality | Maturity / unknown |
|---|---|---|
| Build, test, CI | Node 20 TypeScript/Hono application. CI runs install, typecheck, ratchets, build, Vitest, advisory audit, SQL column drift, deterministic evals, walkthrough simulation, cron contention, and schema snapshot checks. Baseline typecheck, ratchets, kernel boundary, and public-claim audit passed locally. | E2 for the local checks named above; full baseline suite was not run before the first fix. CI/deployment state is unknown without a remote. |
| Routes | `src/index.ts` is the composition root. Static/public, signed webhooks, internal service-key routes, Clerk-authenticated founder/API routes, and API-key `/api/v1` routes coexist. Static scan found 95 route/API files and about 901 verb declarations; counts are orientation, not coverage. | E1 inventory. Route authorization must be proven by boundary tests, not counts. |
| Middleware/auth | Global request ID, security headers, logging and CORS precede route groups. Founder routes use Clerk, internal routes use a service key, public ingest/share use capability tokens, webhooks use provider signatures, and `/api/v1` declares API-key auth internally. The baseline blanket Clerk `/api/*` middleware ran before `/api/v1`, consuming machine bearer keys and blocking v1 health. | **Verified P0; fixed in this tranche with an exact namespace exception and regression/adversarial near-prefix tests. E2 locally after tests pass.** |
| Schema/migrations | libSQL/Turso; 134 migration files through `098_autonomy_consent.sql`. Startup applies lexically sorted migrations and records filenames. Duplicate-column/`already exists` errors are broadly swallowed. A generated schema snapshot and fresh-DB/column checks exist. | E1 inventory; broad error swallowing and production migration history need separate proof. No schema change in this slice. |
| Scheduler/jobs | A large `JOB_REGISTRY` runs only in worker/all roles in production and uses distributed job locks. Static scan found 87 schedule declarations across jobs/services; the header claiming “All 14” is stale. | E1/E2 components; institutional reason-to-run-now, cost, overlap, and ownership are not yet established job by job. |
| Consequential mutations | Stripe, email, GitHub, Linear, Slack, MCP and other effects exist. `services/outbound/gateway.ts` has kill-switch, classification, budget, idempotency and audit controls, but explicitly documents incomplete migration of existing integrations. Action verification exists. | **Verified governance convergence gap, not repaired here.** Exact direct-write call-site manifest and cutover order remain proof debt. |
| Providers / ControlPaths | Integration and gateway implementations exist for GitHub, Stripe, Resend, Intercom, Linear, PostHog, Sentry, Slack, MCP, webhooks, CLI and founder/browser routes. Current code still treats many as integration-specific services rather than uniformly governed ControlPaths. | E1 inventory; semantic capability mapping is unknown. |
| AI calls | Central OpenRouter client supports Opus/Sonnet/Haiku aliases, prompt caching, retries/timeouts, persisted daily product/founder/global spend accounting, and post-response cost recording. Numerous higher services call central wrappers; simple text search undercounts indirect calls. | **Verified material-spend race:** ceiling check is cached/read before the provider call and cost is incremented afterward, so concurrent calls can exceed caps; reads fail open. Requires reservation/reconciliation design, not a cosmetic patch. |
| User surfaces | Current navigation and routes remain agent/SCP-heavy across dashboard, decisions, plans, integrations, controls, briefs, talk, portfolio and settings. | E1. Not yet cut over to TODAY / ASK / COMPANY / ACTIVITY / CONTROL. |
| Legacy agent ownership | Permanent named-agent concepts remain pervasive in routes, services, tables, schedules, prompts and UI. Some newer autopilot/action semantics coexist. | E1. Ownership, shadow comparison, cutover, and deletion map remain unknown; no dual-write is approved as permanent. |
| Credentials | Clerk, Turso, GitHub OAuth, OpenRouter/Anthropic, Resend, Stripe, ecosystem key and encryption key are documented. GitHub onboarding encrypts tokens; integration and MCP connection flows use encryption helpers; investor share credentials are hashed. | Partial E1. A complete write/read/rotation/redaction audit by credential type is still required; configuration consistency is not yet proven. |
| Authority/autonomy | Gates, RBAC, autopilot policy, envelopes, consent, kill switches, MCP grants and action verification exist. Some gateway checks accept caller-supplied `agent`, `surface`, and `dataClass`, and omit checks when optional fields are absent. | **Verified constitutional mismatch requiring contract work:** callers can omit classification/budget inputs. Exploitability and safe migration are not yet fully traced. |
| Cost controls | AI daily ceilings, usage tracking, per-request rate limits, communication budgets and transparency surfaces exist. | Non-atomic AI enforcement above is verified. Overspend/underspend routing regret and per-job reason-to-run-now are absent or unverified. |
| Semantic duplicates | `services/integration/` and `services/integrations/` coexist; multiple outbound/execution, agent/action, and credential concepts appear to overlap. | E1 indication only. Canonical truth and deletion candidates require call-graph/runtime comparison. |
| Proof/evaluation | Vitest unit/simulation suites, deterministic AI evals, golden simulations, walkthrough, load contention, ratchets, schema drift checks, audit documents and action verifier exist. | Mostly E1–E2. Frozen independent benchmarks, responsibility-transfer measures, economics comparisons and production outcome evidence remain proof debt. |

## Historical P0 re-verification

| Historical class | Current finding |
|---|---|
| `/api/v1` machine auth vs blanket Clerk `/api/*` | **Verified.** Middleware ordering blocked API-key traffic before `apiV1` authentication and blocked the documented public health route. Selected as the first fix. |
| Model-controlled content reaching unsafe HTML | **Not yet verified as exploitable.** Raw HTML sinks exist, but initial inspection found primarily generated SVG/known UI fragments. Do not call this fixed; trace provenance of every raw/`innerHTML` value. |
| External mutation outside canonical governance | **Verified structurally.** The outbound gateway itself documents incomplete adapter migration. Inventory and migrate by effect/consequence; do not bolt on a second truth system. |
| Insufficiently source-grounded remediation | **Unknown.** Remediation and audit services exist; source/provenance coverage needs sampled runtime fixtures and adversarial evaluation. |
| Credential inconsistencies | **Partially observed, not fully classified.** Several flows encrypt or hash, but end-to-end storage, rotation, logs and legacy columns have not been exhaustively traced. |
| Ambiguous effect / reconciliation gaps | **Verified at architecture level.** Gateway handler completion is recorded as allowed/succeeded, while provider acceptance and business outcome are not uniformly separated; action verification covers only some actions. |
| Non-atomic material AI/spend enforcement | **Verified.** Read/check occurs before external spend; persisted increments occur after completion, with a cache and fail-open read behavior. Concurrent spend can cross ceilings. |

## Active slice: machine API authentication boundary

- **Baseline:** API v1 declared its own API-key middleware and a public health route, but earlier blanket Clerk middleware intercepted all `/api/*` requests.
- **Requirement:** ControlPath credentials must reach their owning authenticator; bypassing Clerk for machine API v1 must not bypass API-key authentication on protected v1 routes or session authentication on any neighboring namespace.
- **Implementation:** the blanket session boundary delegates exact `/api/v1` and `/api/v1/*` paths unchanged; `apiV1` remains the sole owner of v1 public/protected routing and API-key validation.
- **Tests/challenge:** public v1 health passes; a machine bearer token remains intact; ordinary `/api/*` and adversarial `/api/v10/*` do not inherit the exception.
- **Economics:** deterministic path discrimination adds no model/provider spend and negligible request cost.
- **Evidence maturity:** E2 after focused and full local checks pass; production behavior remains E4/E5 proof debt.
- **Migration/cutover:** direct cutover of conflicting middleware ordering; no dual-write or data migration.
- **Deletion opportunity:** none yet. Longer term, route groups should make authenticator ownership structural rather than exception-based.

## Next safe work

1. Build a tested consequential-effect inventory and select one high-consequence direct provider mutation for shadow/compare migration into the governed execution boundary.
2. Design an atomic AI spend reservation ledger with bounded estimates, settlement, expiry and ambiguous-call reconciliation; compare it against the current ceiling tests before cutover.
3. Trace all raw HTML/DOM sinks back to provenance and add model-controlled adversarial fixtures where a real path exists.
4. Convert optional caller-declared gateway safety fields into server-derived policy inputs without creating a competing authority system.
