# Lens 50 — Edge Case Auditor

**Auditor perspective:** Boundary tester. What happens at zero, one, max, broken, and mid-transition states?

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P0 (crash / data loss) | 3 |
| P1 (poor UX on common edge case) | 5 |
| P2 (uncommon but impactful) | 6 |
| P3 (rare / cosmetic) | 3 |

---

## Edge Case 1: Zero Products (New Founder)

**What happens:** Dashboard route (`/dashboard`) checks `products.rows.length === 0` and redirects to `/onboarding`. This is correct.

**Problem (P1):** The `getLayoutContext()` helper in `_shared.ts` returns `productId: null` and `productName: null` when zero products exist. Multiple downstream dashboard routes call `getLayoutContext` and then access `ctx.productId!` (non-null assertion) without checking. The dashboard index does this at line 139:

```ts
const productId = ctx.productId!;
```

If the redirect somehow fails (e.g. middleware ordering issue, direct API call), this non-null assertion causes silent undefined propagation into all subsequent DB queries, which would query with `productId = undefined`. Turso/libSQL would treat this as a string `"undefined"` and return no results rather than crashing, but the page would render with empty/broken data.

**Verdict:** P1 — The redirect is the only safety net; no defensive null check exists downstream. Any route that uses `ctx.productId!` without a preceding redirect guard has the same vulnerability.

**Files:** `src/routes/dashboard/index.ts:139`, `src/routes/dashboard/_shared.ts:73-91`

---

## Edge Case 2: First Product, No Audit Yet

**What happens:** After product creation via `/onboarding/select-repo` or `/onboarding/create-product`, the founder is redirected to `/onboarding/competitors` then `/onboarding/audit` then posts to `/onboarding/run-audit`, which runs the first audit synchronously.

**Problem (P1):** The audit is synchronous and calls `runAudit()` which involves an 8-step GitHub analysis pipeline including multiple Claude API calls. This can take 30-60+ seconds. The onboarding page shows a "running_audit" step (rendered by `onboardingWizard`), but the POST to `/onboarding/run-audit` blocks the HTTP response until the full audit completes. There is no timeout, no streaming progress, and no background processing. If the Anthropic API is slow or errors, the founder sees a hung browser for an indefinite period.

**Problem (P2):** If the audit fails (GitHub token expired, Anthropic timeout, rate limit), the error propagates as an unhandled exception. The `runAudit` call has no try-catch wrapper in the onboarding route. The founder gets a 500 error with no recovery path. They must manually navigate back to `/onboarding` and retry.

**Files:** `src/routes/dashboard/onboarding.ts:226-260`

---

## Edge Case 3: Product With No Metrics

**What happens:** The `computeSignal()` function in `signal.ts` handles this gracefully. When `getLatestMetrics` returns no rows, `metrics` defaults to `{}`, and the MRR health penalty defaults to 5 (the "unknown data" penalty). The prose generation also handles null MRR data with a "No MRR data available" fallback string.

**Problem (P1):** The default 5-point MRR penalty for "unknown data" is applied permanently to every new product until metrics are ingested. This means the Signal score starts at 80 (85 base - 5 MRR penalty), which is correct conceptually but is not explained to the founder. There is no visual indicator that the score is lower because metrics haven't been connected yet. The "Signal Anatomy" dialog shows "MRR health: -5" but does not explain this is due to missing data.

**Problem (P2):** The sparkline chart returns `raw('')` (empty string) when `history.length < 2`, so no crash. But the `getDailyInsight()` returns null for new products, and the briefing section returns null. The dashboard renders correctly but looks sparse — just a number and 3 sentences. No onboarding hint says "connect metrics to improve your Signal."

**Charts:** No crash. Sparkline handles < 2 data points. Signal score computation handles null metrics.

**Agents:** The SCP scheduler (`runDueAgentsForAllProducts`) only runs agents for products where `scp_status='active' AND company_lifecycle_state != 'setup'`. A product with no metrics that has been provisioned will still have agents run, and agents will work with empty metric context. Individual agents call `getLatestMetrics` and handle null gracefully (they just have less data to work with). No crash.

**Files:** `src/services/signal.ts:86-92`, `src/routes/dashboard/index.ts:180-185`

---

## Edge Case 4: Archived Product

**What happens:**

1. **Listing:** `getProductsByOwner()` filters out archived products (`status != 'archived'`). They vanish from the product switcher and dashboard.

2. **Direct access:** `getProductByOwner()` does NOT filter by status. It only checks `id = ? AND owner_id = ?`. This means a founder who bookmarks an archived product URL can still access it through any route using `getProductByOwner`. The tenant middleware also uses `getProductByOwner` without checking status.

**Problem (P0):** Archived products remain fully accessible via direct URL. The tenant middleware at `src/middleware/tenant.ts:37-39` loads any product owned by the founder regardless of status. An archived product's routes still work: viewing audit results, running agents, even submitting decisions. There is no status check anywhere in the middleware chain.

**Problem (P1):** Agents still run on archived products. The SCP scheduler queries `WHERE scp_status='active'`. When `deprovisionSCP()` is called, it sets `scp_status='archived'` and pauses agents. But `deprovisionSCP` must be called explicitly — archiving a product via status change alone does NOT call `deprovisionSCP`. There is no code path that transitions `products.status = 'archived'` AND calls `deprovisionSCP()` atomically.

**Problem (P2):** The `getAllActiveProducts()` function queries `WHERE status = 'active'`, so archived products are excluded from background jobs. But the SCP scheduler queries `WHERE scp_status='active'`, not `WHERE status = 'active'`. If a product is archived (`status='archived'`) but `scp_status` was never changed, agents continue running and consuming AI credits indefinitely.

**Files:** `src/db/client.ts:78-80`, `src/middleware/tenant.ts:37-39`, `src/services/scp/provisioner.ts:184-193`, `src/services/scp/scheduler.ts:29-31`

---

## Edge Case 5: Multiple Products on Solo Tier

**What happens:** The enforcement exists but only at onboarding time. In `onboarding.ts:125-151`, the `select-repo` POST handler checks:

```ts
const productLimits = { solo: 1, growth: 1, investor_ready: 5 };
```

It counts existing non-archived products and rejects with a "Product limit reached" page.

**Problem (P2):** The limit is only enforced in the `select-repo` handler, not in `create-product` (the no-code onboarding path at line 76-93). A Solo founder using the no-code path (`/onboarding/no-code`) can bypass the product limit entirely — `create-product` has no limit check.

**Problem (P2):** There is no runtime enforcement. If a founder downgrades from Investor-Ready (5 products) to Solo (1 product), their existing 5 products remain active. No job or webhook handler checks for over-limit products after a tier downgrade. The Stripe webhook at `src/services/billing/stripe.ts:73-88` only updates the `tier` column; it does not audit or archive excess products.

**Problem (P3):** The tier-gate middleware (`requireTier('multi_product')`) is not applied to any product creation route. The `multi_product` feature gate exists in the FEATURE_GATES map but is never used as middleware on any route.

**Files:** `src/routes/dashboard/onboarding.ts:76-93` (no limit), `src/routes/dashboard/onboarding.ts:125-151` (has limit), `src/middleware/tier-gate.ts:35` (gate defined but unused), `src/services/billing/stripe.ts:86-88`

---

## Edge Case 6: Expired / Cancelled Subscription

**What happens:** When Stripe fires `customer.subscription.deleted`, the webhook handler sets `tier = NULL` on the founder record. This is the only action taken.

**Problem (P0):** A founder with `tier = NULL` can still access every dashboard route. The auth middleware (`src/middleware/auth.ts`) resolves the founder and sets `c.set('founder', founder)` regardless of tier. The only routes that check tier are those wrapped in `requireTier()` middleware. The core routes — dashboard, signals, audit, decisions, lifecycle — are gated with `requireTier('dashboard')` and `requireTier('decisions')`, which require any of `['solo', 'growth', 'investor_ready']`. A null-tier founder hitting these routes would see the gate page correctly.

**However:** The dashboard index route (`/dashboard`) is NOT wrapped in `requireTier('dashboard')`. It calls `getLayoutContext` and renders the full dashboard including Signal score, stressors, briefings, and the query bar. A cancelled founder can still view their full dashboard, ask questions via the AI query bar (consuming Anthropic credits), and see all their data.

**Problem (P0):** SCP agents continue running for cancelled founders. The scheduler queries `WHERE scp_status='active'` on products, not founders. There is no join to check `founders.tier IS NOT NULL`. A cancelled founder's product continues to consume AI credits via hourly agent runs, briefing generation, competitive scans, weekly synthesis, and digest emails indefinitely.

**Problem (P1):** No data access is revoked. The founder can still view all historical data, signals, and audit results. The orientation doc says "tier gates enforce feature access" but the enforcement is opt-in per route — routes without explicit `requireTier()` calls are ungated.

**Files:** `src/services/billing/stripe.ts:86-88`, `src/routes/dashboard/index.ts` (no tier gate), `src/services/scp/scheduler.ts:29-31` (no tier check), `src/middleware/auth.ts` (no tier validation)

---

## Edge Case 7: GitHub OAuth Failure

**What happens:** The GitHub OAuth callback at `/onboarding/github/callback` exchanges the code for an access token. If the exchange fails (`!tokenData.access_token`), it returns a raw JSON error: `{ error: 'GitHub auth failed' }` with status 400.

**Problem (P1):** The error response is raw JSON, not the dashboard HTML layout. The founder sees `{"error":"GitHub auth failed"}` in their browser — a broken UX. No retry link, no back button, no explanation of what went wrong.

**Problem (P2):** If the GitHub OAuth code is missing entirely (the `?code=` parameter), the handler returns `{ error: 'Missing code' }` with status 400. Same raw JSON issue.

**Problem (P3):** The alternative no-code onboarding path (`/onboarding/no-code`) exists but is not presented as a fallback when GitHub auth fails. The founder has no discovery path to it.

**Recovery:** The founder must manually navigate to `/onboarding` to restart the flow. The state is not corrupted — no product is created until the repo is selected. So the recovery is possible but the UX is poor.

**Files:** `src/routes/dashboard/onboarding.ts:96-117`

---

## Edge Case 8: No Anthropic API Key

**What happens:** `ANTHROPIC_API_KEY` is marked as `required: false` in `env.ts`. The server starts without it. The AI client at `src/services/ai/client.ts:17-20` lazily creates the Anthropic client on first call and throws `Error('ANTHROPIC_API_KEY is required')` if missing.

**Problem (P0):** This throw is unhandled in nearly every call site. The Signal score prose generation (`generateProse` in `signal.ts:209-217`) does wrap the call in try-catch and falls back to `buildFallbackProse()` — this is correct. But:

- **SCP agents** import and call `callSonnet`/`callOpus` without try-catch around the AI call itself. The `runAllDueAgents` method in `instance.ts:152-178` catches per-agent errors, so individual agent failures don't cascade. But the error is only logged via the output array — no alerting, no circuit breaking.

- **The onboarding audit** (`runAudit`) calls Claude for 10-dimension scoring. If the API key is missing, the audit throws and the founder gets a 500 error during onboarding with no recovery path.

- **The evolution gate system** (`gates.ts`) does handle AI errors with fail-closed behavior (constitution gate rejects, safety gate rejects). The regression gate fails-open. This is correct for safety.

- **Competitive scans, weekly synthesis, digest generation** — all call Claude and will throw. These are background jobs with per-product try-catch, so the server stays up but every job fails silently.

**Verdict:** P0 for onboarding (complete block with no recovery), P2 for background jobs (silent failure, no alerting), P1 for dashboard (prose falls back gracefully but no indication AI is degraded).

**Files:** `src/services/ai/client.ts:17-20`, `src/env.ts:21`, `src/services/signal.ts:209-217`, `src/routes/dashboard/onboarding.ts:234-246`

---

## Edge Case 9: SCP Provisioning Failure

**What happens:** The `provisionSCP` function in `provisioner.ts` wraps the entire provisioning in a try-catch and returns a `{ success: false, error }` result. The `ensureProvisioned` helper throws if provisioning fails.

**Problem (P1):** SCP provisioning is never explicitly called during onboarding. The onboarding flow creates a product and runs an audit, but does not call `provisionSCP`. The product enters the system with `scp_status = NULL` (the column has no DEFAULT in the original schema, though migration 017 adds it as a column with default). The scheduler only picks up products with `scp_status='active'`, so agents never run.

**Question:** Where is `provisionSCP` actually called? Searching the codebase:

- `ensureProvisioned` is exported but there is no evidence it's called from the onboarding flow.
- The product is created with an INSERT that doesn't set `scp_status`.
- The migration adds `scp_status` with a default value, but the onboarding INSERT doesn't reference it.

**Actual behavior:** SCP provisioning happens in two places, neither of which is the onboarding flow:

1. **Server startup** (`src/index.ts:476-491`): `ensureProvisioned` is called for all active products. This is the main provisioning path.
2. **Agents page** (`src/routes/dashboard/agents.ts:245-249`): A manual "provision" action exists.

**Verdict (P2):** Products created during onboarding are NOT provisioned until the next server restart. Between product creation and server restart, the product has no agents and no briefings. This can be minutes or hours in production (Fly.io restarts on deploy). It's not a crash, but it's a gap in the "instant intelligence" promise. The onboarding flow completes and redirects to `/dashboard?tour=1`, but agents don't exist yet. If the founder visits `/agents` before a restart, the page would show empty agent roster (or offer the manual provision button).

Additionally, the startup provisioner calls `getAllActiveProducts()` which filters by `status = 'active'`. Products created via the no-code path set `status='active'` explicitly, but products created via `select-repo` do NOT set a status column (relying on the schema DEFAULT). This should work fine since the schema default is `'active'`.

The provisioning failure at startup is caught and logged as a warning — non-fatal. If provisioning fails for a product, it silently runs without agents until the next restart attempt.

**Files:** `src/index.ts:476-491`, `src/services/scp/provisioner.ts:32-168`, `src/routes/dashboard/onboarding.ts:120-168` (no provisionSCP call), `src/routes/dashboard/agents.ts:245-249`

---

## Edge Case 10: Red Risk State — Gate 0/1 Suspension

**What happens:** The `evaluateGate()` function in `src/services/ai/gates.ts:39-53` correctly implements Gate 0/1 suspension in Red state:

```ts
if (riskState === 'red' && gate <= 1) {
  const allowedInRed = ['behavioral_trigger_email', 'critical_support_routing'];
  const isAllowed = allowedInRed.includes(decision.action);
  if (!isAllowed) {
    return { effectiveGate: 2, escalated: true, reason: 'Red state: non-essential Gate 0/1 actions suspended, escalated to Gate 2' };
  }
}
```

This is well implemented. Gate 0 and Gate 1 actions are escalated to Gate 2 (recommend and wait) in Red state, except for two critical-path actions.

**Problem (P2):** The `evaluateGate` function is a pure function — it must be called by agents or the decision system. There is no evidence in the agent base class or scheduler that `evaluateGate` is consulted before executing agent-proposed actions. The function exists and is correct, but its integration into the agent execution pipeline needs verification. If agents bypass this gate check, Red state has no behavioral effect.

**Problem (P3):** The `isGateSuspended()` helper exists but is a separate function from `evaluateGate()`. Callers must know to use one or the other. There's no single authoritative "should this decision proceed?" entry point.

**What works well:**
- Risk assessment (`assessRiskState`) correctly handles stage-aware risk calculation (pre-launch products can't go Red from metric absence alone)
- Recovery protocol generation triggers automatically on Red transition
- Red state caps Signal at 40, Yellow at 72

**Files:** `src/services/ai/gates.ts:39-53`, `src/services/intelligence/risk-state.ts:70-74`

---

## Cross-Cutting Concerns

### Lifecycle State Default Not Persisted (P1)

The tenant middleware (`tenant.ts:66-95`) creates a default `LifecycleState` object in memory when `lifecycleResult.rows.length === 0`. This default is never written to the database. Every subsequent request for the same product re-creates the default in memory. If any route writes to `lifecycle_state` expecting the row to exist (via UPDATE), the update silently affects zero rows. The orientation doc flagged this as item #11.

**File:** `src/middleware/tenant.ts:66-95`

### Product Limit Bypass via No-Code Path (P2)

Already described in Edge Case 5. The `create-product` handler has no product count check.

**File:** `src/routes/dashboard/onboarding.ts:76-93`

### Cancelled Founder AI Cost Leak (P0)

Already described in Edge Case 6. No tier check in the SCP scheduler, briefing generator, competitive scanner, or any background job. A cancelled founder continues consuming AI credits.

**Files:** `src/services/scp/scheduler.ts`, `src/jobs/index.ts`

---

## Findings Table

| # | Edge Case | Severity | Status | Notes |
|---|-----------|----------|--------|-------|
| 1 | Zero products — `productId!` non-null assertion | P1 | Unhandled | Redirect is the only guard; no defensive check |
| 2 | First product — synchronous audit blocks onboarding | P1 | Unhandled | No timeout, no background processing |
| 2b | First product — audit failure = 500 with no recovery | P2 | Unhandled | No try-catch on `runAudit` in onboarding |
| 3 | No metrics — unexplained 5-point penalty | P1 | Partial | Score computation is safe; UX does not explain |
| 4 | Archived product — still accessible via direct URL | P0 | Unhandled | Tenant middleware does not check `status` |
| 4b | Archived product — agents may still run | P2 | Unhandled | `status` and `scp_status` are not synchronized |
| 5 | Solo tier — no-code path bypasses product limit | P2 | Unhandled | `create-product` has no limit check |
| 5b | Solo tier — downgrade does not enforce limit | P2 | Unhandled | Webhook only updates tier, no product audit |
| 6 | Cancelled subscription — dashboard still accessible | P0 | Unhandled | `/dashboard` has no `requireTier` gate |
| 6b | Cancelled subscription — agents still consume credits | P0 | Unhandled | Scheduler has no tier check |
| 7 | GitHub OAuth failure — raw JSON response | P1 | Unhandled | Broken UX, no retry path |
| 8 | No Anthropic key — onboarding blocked | P0 | Unhandled | `runAudit` throws, no catch in handler |
| 8b | No Anthropic key — prose falls back gracefully | OK | Handled | `signal.ts` catch + fallback works |
| 9 | SCP not provisioned until server restart | P2 | By design (gap) | Provisioning at startup, not in onboarding flow |
| 10 | Red risk — Gate 0/1 suspension logic | OK | Implemented | `evaluateGate` is correct; integration needs verification |
| 10b | Red risk — gate check integration with agents | P2 | Unverified | No evidence agents call `evaluateGate` before acting |
| 11 | Lifecycle state default not persisted | P1 | Unhandled | In-memory default, never written to DB |

---

## P0 Summary (Crash or Data Loss)

1. **Archived products remain fully accessible** — tenant middleware does not check product status. A founder can interact with, mutate, and run agents on archived products via direct URL.

2. **Cancelled founders continue consuming AI credits** — SCP scheduler, briefing generation, competitive scans, and all background jobs run against products regardless of founder subscription status. No tier check exists in any job.

3. **Missing Anthropic key blocks onboarding entirely** — The first audit is synchronous and unguarded. A missing API key throws during onboarding with a 500 error and no recovery.

---

## Recommended Fixes (Priority Order)

1. **Add tier check to SCP scheduler and all background jobs** — Join on `founders.tier IS NOT NULL` or check tier before running per-product jobs.

2. **Add `status = 'active'` check to tenant middleware** — Reject requests for archived/paused products with 404.

3. **Wrap onboarding audit in try-catch** — Return an error page with retry button instead of 500.

4. **Call `provisionSCP` during onboarding after audit** — Currently deferred to server restart. Provision immediately after product creation to eliminate the gap.

5. **Add `requireTier('dashboard')` to the `/dashboard` route** — Or create a lightweight tier check that redirects cancelled founders to a "reactivate" page.

6. **Add product limit check to no-code onboarding path** — Mirror the limit enforcement from `select-repo` into `create-product`.

7. **Synchronize `status` and `scp_status`** — When a product is archived, also call `deprovisionSCP`. Consider a single source of truth.

8. **Return HTML error pages from GitHub OAuth failure** — Render a dashboard-layout error page with retry link and no-code alternative.
