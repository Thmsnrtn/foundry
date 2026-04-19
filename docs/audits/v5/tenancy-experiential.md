# Phase 7 -- Tenancy Experiential Tests

Generated: 2026-04-16 | Auditor: v5 automated audit | Session: v5-phase-7

---

## Role 1: The Boundary Prober

Simulated user with 2+ companies who deliberately tests boundary confusion.

### Test: Product Switcher Scoping

**File reviewed:** `src/views/layout.ts` (lines 177-189), `src/routes/dashboard/index.ts` (switch-product handler), `src/routes/dashboard/_shared.ts` (lines 99-110)

**Mechanism:** The product switcher is a `<form>` that POSTs to `/switch-product` with the selected `product_id`. The handler:
1. Validates ownership via `getProductByOwner(productId, founder.id)` -- rejects if not owned.
2. Sets an `httpOnly` cookie `foundry_product` with `path=/`, `sameSite=Lax`, 1-year expiry.
3. Redirects to `/dashboard`.

**Scoping check:** Every dashboard route calls `getLayoutContext()`, which resolves the active product via: explicit override > `foundry_product` cookie > first product. The selected product ID is then passed to all queries on the page, and all queries in `src/db/client.ts` scope by `product_id`.

**PASS -- Product switcher correctly scopes all actions.** The cookie is server-set, httpOnly, and the server re-validates ownership on every page load through `getProductsByOwner()`. The `getLayoutContext` function only selects a product from the `allProducts` list (which is already ownership-filtered), so a tampered cookie pointing to a foreign product ID would simply fall back to the first owned product.

**Finding: No race-condition guard for concurrent tabs.** If a user opens Company A's dashboard in Tab 1 and Company B's in Tab 2, the last `/switch-product` POST wins the cookie. Tab 1 would silently reload data for Company B if refreshed. This is a UX confusion risk, not a security issue -- no cross-tenant data leaks -- but it could cause the user to take an action (e.g., approve a decision) believing they are in Company A when the server now resolves Company B.

**Severity:** Medium (UX confusion). **No data leak.**

### Test: Delete Modal Product Name

**File reviewed:** `src/routes/dashboard/privacy.ts` (lines 335-354)

The delete confirmation modal uses `ctx.productName` in both the heading and the confirmation button:
- Heading: `Delete all data for ${ctx.productName}?`
- Body: `permanently schedule deletion of all data for <strong>${ctx.productName}</strong>`
- Button: `Yes, Delete ${ctx.productName}`

`ctx.productName` comes from `getLayoutContext()`, which resolves the currently selected product from the ownership-filtered product list. The deletion POST handler also uses `ctx.productId` from the same resolution chain.

**PASS -- Delete modal names the correct product.** The product name displayed in the modal matches the product that will actually be deleted because both come from the same `getLayoutContext()` call.

**Residual risk:** Same concurrent-tab issue noted above. If the user opens the privacy page for Company A, then switches to Company B in another tab, the cookie changes. If the user then clicks "Delete This Product" on the stale Tab 1 page, the POST to `/privacy/delete` will call `getLayoutContext()` again, which now resolves Company B. The modal showed Company A's name but the server would delete Company B.

**Severity:** High (destructive action on wrong product due to stale tab). **DEFECT -- Deletion POST should include an explicit product_id in a hidden form field and validate it matches the context, rather than re-resolving from cookie.**

### Test: Product Switcher Cookie Scoping

**File reviewed:** `src/views/layout.ts` (productSwitcher function, lines 177-189), `src/routes/dashboard/index.ts` (switch-product, lines 103-116)

The cookie `foundry_product` is set with `path: '/'` and no domain restriction. It stores a plain product ID. The server re-validates ownership on every request. No product-scoped session data leaks because:
1. Every query function in `src/db/client.ts` takes `productId` as a parameter.
2. The `_shared.ts` layout context resolves product from ownership-validated list.
3. The tenant middleware (`src/middleware/tenant.ts`) validates `getProductByOwner(productId, founder.id)` for API routes with `:id` params.

**PASS -- Cookie properly scopes.** The cookie is a stateless pointer that is ownership-validated server-side on every request.

---

## Role 2: The Consent Auditor

### Test: Cross-Company Intelligence Consent Check

**File reviewed:** `src/services/decisions/patterns.ts` (lines 24-26)

The `generatePatternFromOutcome()` function has an explicit consent gate:
```typescript
if (!(await hasConsent(input.productId, 'cross_company_patterns'))) return null;
```

This is called BEFORE the INSERT, and returns `null` (no write) if consent is not granted. The consent check is per-product, using the specific `productId` that would contribute the pattern.

**PASS -- `hasConsent()` is called before every write to `decision_patterns`.**

### Test: Consent Defaults Are Opt-Out

**File reviewed:** `src/services/privacy/consent.ts` (lines 96-133)

The `getOrInitConsents()` function has explicit GDPR-compliant defaults:
```typescript
// GDPR: all defaults are opt-out (false)
return {
  benchmark_contribution: false,
  aggregate_insights: false,
  product_improvement: false,
  ai_training_opt_out: false,
  cross_company_patterns: false,
};
```

When no consent records exist, ALL sharing types default to `false`. The code includes inline comments referencing GDPR Article 7 (pre-ticked boxes are not valid consent).

The `hasConsent()` function (lines 58-66) returns `false` when no record exists (`result.rows.length === 0 => return false`), and only returns `true` when `granted === 1`.

**PASS -- All consent defaults are opt-out.** A new product starts with all sharing disabled. The founder must explicitly enable each consent type.

### Test: Opted-Out Company B Data Leaking Into Opted-In Company A

**Scenario:** Company A has `cross_company_patterns = true`. Company B has `cross_company_patterns = false` (default).

**Analysis:** The `generatePatternFromOutcome()` function only writes a pattern if the contributing product has consent. Company B will never contribute patterns because `hasConsent('company_b_id', 'cross_company_patterns')` returns `false`. Therefore Company B's decision outcomes are never written to `decision_patterns` and cannot appear in Company A's view.

**However:** The `getRelevantPatterns()` function in `src/db/client.ts` (lines 231-246) queries the `decision_patterns` table WITHOUT any product_id filter. This is by design -- the table contains anonymized, product-agnostic patterns. Since Company B's data was never written (consent gate prevents it), there is nothing to leak.

**PASS -- No leakage from opted-out company.** The consent gate operates at write time, preventing opted-out data from entering the shared pool. The read side is intentionally unscoped (it reads anonymized aggregate patterns).

**Note:** The `decision_patterns` table has no `product_id` column at all (the data is anonymized at write time). The orientation document flagged this as problem #17 ("no access controls"), but the consent-gated write is the intended access control.

---

## Role 3: The Exfiltration Tester

### Test: All Query Functions Scope by owner_id

**File reviewed:** `src/db/client.ts`

Every query helper that returns product-specific data scopes by either `product_id` (where ownership is pre-validated upstream) or `owner_id`:

| Function | Scoping | Line |
|----------|---------|------|
| `getProductsByOwner(founderId)` | `WHERE owner_id = ?` | 86 |
| `getProductByOwner(productId, founderId)` | `WHERE id = ? AND owner_id = ?` | 93 |
| `getLifecycleState(productId)` | `WHERE product_id = ?` | 100 |
| `getLatestAudit(productId)` | `WHERE product_id = ?` | 108 |
| `getPendingDecisions(productId)` | `WHERE product_id = ?` | 128 |
| `getActiveStressors(productId)` | `WHERE product_id = ?` | 145 |
| `getMetricSnapshots(productId, ...)` | `WHERE product_id = ?` | 161 |
| All other helpers | `WHERE product_id = ?` | Various |

The `getRelevantPatterns()` function (line 232) is the sole exception -- it queries `decision_patterns` without tenant scoping. This is intentional: the table stores anonymized cross-ecosystem patterns with no product_id column, and writes are consent-gated.

**PASS -- All product-specific queries scope by product_id or owner_id.** The tenant middleware and route handlers validate ownership before passing product_id to these functions.

### Test: Portfolio and Experiment Ownership in API Routes

**File reviewed:** `src/routes/api/platform.ts`

Every route handler follows the same pattern:
1. Extract `founder` from auth context.
2. Extract `productId` from URL param.
3. Call `getProductByOwner(productId, founder.id)` -- returns 404 if not owned.
4. Proceed only if ownership confirmed.

Specific ownership checks:
- **Experiments:** `verifyExperimentOwnership(experimentId, founderId)` joins `experiments` with `products` on `owner_id` (lines 126-134).
- **Portfolios:** `verifyPortfolioOwnership(portfolioId, founderEmail)` checks `portfolios.owner_email` (lines 350-353).
- **Voice sessions:** Session ownership verified via join to products table (lines 288-294).

**PASS -- All API routes validate ownership before operating on resources.**

**Finding:** Portfolio ownership is checked by `owner_email` rather than `founder.id`. This is a minor inconsistency (most checks use `id`), but not exploitable because `founder.email` is Clerk-authenticated.

### Test: Share Token Cross-Company Exposure

**File reviewed:** `src/routes/share/index.ts`

The share route:
1. Takes a `token` from the URL path (`/share/:token`).
2. Validates format: `/^[\w-]{8,64}$/` (rejects invalid tokens).
3. Queries: `SELECT p.*, f.name FROM products p JOIN founders f ON p.owner_id = f.id WHERE p.share_token = ?`.
4. Returns 404 if no match.

The share token is a per-product value stored in the `products` table. There is no authentication on this route -- the token IS the secret (as documented in the file header).

**Key question:** Can a share token from Company A expose Company B's data?

**Answer: No.** The query filters by `share_token` which is a column on the `products` table. Each product has its own independent share token. The share page then queries data only for the matching `productId`. There is no mechanism by which one product's share token could return another product's data.

**PASS -- Share tokens are product-scoped and cannot cross company boundaries.**

**Finding:** Share tokens have no expiry, no revocation mechanism, and no access logging. Anyone with the URL can view the data indefinitely. This is a pre-existing concern (not a cross-tenant issue).

---

## Summary of Findings

| Test | Verdict | Severity |
|------|---------|----------|
| Product switcher scopes all actions | PASS | -- |
| Delete modal names correct product | PASS (with defect) | High |
| Product switcher cookie scoping | PASS | -- |
| hasConsent() called before pattern writes | PASS | -- |
| Consent defaults are opt-out | PASS | -- |
| Opted-out company data cannot leak | PASS | -- |
| All queries scope by owner_id/product_id | PASS | -- |
| API route ownership validation | PASS | -- |
| Share token cross-company isolation | PASS | -- |

### Defects Found

**DEFECT-T7-01: Stale-tab destructive action on wrong product (High)**
- **Location:** `src/routes/dashboard/privacy.ts` POST `/privacy/delete`
- **Issue:** The deletion handler re-resolves product from the cookie, not from a form field. If the user switched products in another tab between viewing the modal and clicking delete, the wrong product is deleted.
- **Fix:** Include `<input type="hidden" name="target_product_id" value="${ctx.productId}" />` in the delete form, and validate that the POSTed product_id matches the cookie-resolved product_id before proceeding. Reject with an error if they diverge.

**DEFECT-T7-02: Concurrent-tab product context confusion (Medium)**
- **Location:** `src/routes/dashboard/index.ts` (switch-product), `src/routes/dashboard/_shared.ts` (getLayoutContext)
- **Issue:** The single global `foundry_product` cookie means switching products in one tab silently changes the product context for all other open tabs. No warning is shown.
- **Fix:** Consider using a per-tab product context (e.g., URL-based product scoping like `/company/:id/dashboard`) or showing a "product changed" banner when a page detects a cookie mismatch from its rendered state.
