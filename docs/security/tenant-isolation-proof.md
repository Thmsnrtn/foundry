# Foundry — Multi-Tenancy Isolation Proof

Version: 1.0 | Date: 2026-04-18

## Proof Methodology

This document proves tenant isolation through three complementary methods:
1. **Static analysis tests** (automated, in `tests/unit/tenancy-isolation.test.ts`)
2. **Code path audit** (manual, documented below)
3. **Data flow contract enforcement** (documented in `docs/scp/cross-company-contract.md`)

## 1. Database Query Isolation

Every exported query function in `src/db/client.ts` scopes by `owner_id` or `product_id`:

| Function | Scoping Parameter | Verified |
|----------|------------------|----------|
| `getProductsByOwner(founderId)` | `WHERE owner_id = ?` | Yes (static test) |
| `getProductByOwner(productId, founderId)` | `WHERE id = ? AND owner_id = ?` (double-scoped) | Yes (static test) |
| `getLifecycleState(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getLatestAudit(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getPendingDecisions(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getActiveStressors(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getMetricSnapshots(productId, start, end)` | `WHERE product_id = ?` | Yes (static test) |
| `getLatestMetrics(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getCohorts(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getCompetitors(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getCompetitiveSignals(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getAuditLog(productId)` | `WHERE product_id = ?` | Yes (static test) |
| `getScenarioModels(decisionId)` | `WHERE decision_id = ?` (FK-scoped via decisions) | Yes |
| `getStoryArtifacts(productId)` | `WHERE product_id = ?` | Yes |
| `getBetaIntakes(productId)` | `WHERE product_id = ?` | Yes |
| `getLifecycleConditions(productId)` | `WHERE product_id = ?` | Yes |
| `insertAuditLog(entry)` | Requires `product_id` field | Yes |
| `getFounderByClerkId(clerkUserId)` | `WHERE clerk_user_id = ?` | Yes |
| `getAllActiveProducts()` | No scoping (job use only) | Acceptable — used only in background jobs which process per-product |

### Exception: `getRelevantPatterns()`
This function queries the `decision_patterns` table which is **intentionally cross-product**. The table contains no product_id, founder_id, or product name — it is anonymized by design. See cross-company data-flow contract.

### Exception: `getAllActiveProducts()`
Used by scheduled jobs to iterate products. Each job then processes per-product with proper scoping.

## 2. Middleware Isolation

### Tenant Middleware (`src/middleware/tenant.ts`)
- Validates product ownership: `getProductByOwner(productId, founder.id)`
- Returns 404 (not 403) for non-owned products — prevents enumeration
- Blocks access to archived products (`status === 'archived'`)
- Creates lifecycle state defaults in context only for owned products
- **Test coverage:** Static analysis tests verify these behaviors

### Auth Middleware (`src/middleware/auth.ts`)
- Clerk JWT validation — no cross-tenant token reuse possible
- Founder record resolved from JWT, not from request parameters
- Auto-provisioning creates founder records scoped to Clerk user ID

### Portfolio API Isolation (fixed in Phase 4)
- All portfolio routes now validate `owner_email` matches authenticated founder
- Returns 404 for non-owned portfolios
- **Commit:** 2f8b14d

### Experiment API Isolation (fixed in Phase 4)
- Experiment routes join through `products` table to verify `owner_id`
- Returns 404 for non-owned experiments
- **Commit:** 2f8b14d

## 3. Cross-Company Data Boundaries

### Level 1 (Strictly Isolated) — Enforced
- All product data, metrics, decisions, stressors, agents, integrations scoped by product_id
- GitHub tokens encrypted at rest (AES-256-GCM)
- No product name or founder identifier in shared tables

### Level 2 (Decision Patterns) — Anonymized
- `decision_patterns` table contains: decision_type, lifecycle_stage, risk_state, market_category, outcome
- Does NOT contain: product_id, founder_id, product_name, specific metric values
- **Static test verifies:** no product_id or founder_id columns exist
- De-anonymization risk mitigated per cross-company contract

### Level 3 (Fleet Intelligence) — Founder-Scoped
- Cross-company queries filter by `owner_id` (same founder's companies only)
- No data crosses founder boundaries

### Level 4 (Benchmarking) — Consent-Required
- Consent model defined in contract
- Contribution requires explicit opt-in (not yet enforced — tracked as remaining work)

## 4. Background Job Isolation

All 26+ scheduled jobs in `src/jobs/index.ts`:
- Call `getAllActiveProducts()` to get the product list
- Iterate per-product, performing all queries with product_id scoping
- No job queries across products within a single iteration step
- SCP agent scheduler runs per-product with product-scoped context

## 5. Logging Isolation

- Structured logger (`src/services/logger.ts`) includes `productId` context
- Console.log replacement in top 5 files includes job/product context
- PII masking: product names included in logs for debugging (acceptable — founder's own data)
- No cross-tenant data in shared log entries

## 6. Cache Isolation

- In-memory prose cache (`signalCache`) keyed by product_id
- Rate limiter keyed by IP (acceptable — rate limiting is per-client, not per-tenant)
- No shared cache across tenants for business data

## 7. Remaining Gaps (Tracked)

1. **Consent enforcement for Level 2/4:** `hasConsent()` function exists but is not called before decision_patterns writes. Tracked in defects.
2. **Benchmark pool K-anonymity:** Minimum cohort size not enforced. Tracked in defects.
3. **Internal ecosystem routes:** Expose any product's data with shared service key. Service key is timing-safe compared. Risk: key compromise exposes all tenants. Mitigation: key rotation documented in runbook.

## Automated Verification

```bash
# Run tenancy isolation test suite
npx vitest run tests/unit/tenancy-isolation.test.ts
```

All tests must pass for launch readiness gate.
