# Lens 131 — Company Lifecycle State Machine Edge Cases

**Auditor perspective:** Edge-case hunter / domain adversary — invalid transitions, resurrection, and state skipping
**Distinct-value declaration:** Maps the full state machine (setup/learning/operating/optimizing/scaling + product status active/archived + SCP status active/archived/provisioning) and probes every illegal transition. No prior lens mapped the combined state space.
**Tenancy-critical:** Yes. Lifecycle state determines agent behavior, gate levels, and feature access per company.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 4 |

---

## Combined State Space

A company has three independent state dimensions:

1. **`products.status`**: `'active'` | `'archived'` (schema default: 'active')
2. **`products.scp_status`**: `'provisioning'` | `'active'` | `'archived'` | NULL
3. **`products.company_lifecycle_state`**: `'setup'` | `'learning'` | `'operating'` | `'optimizing'` | `'scaling'`

Valid state combinations: 2 x 4 x 5 = 40 possible states. But only a subset are meaningful:

| product.status | scp_status | lifecycle_state | Meaning |
|---------------|------------|-----------------|---------|
| active | active | learning | Normal operation |
| active | active | operating | Mature operation |
| active | provisioning | setup | Just created, awaiting provisioning |
| archived | archived | any | Retired company |
| active | NULL | setup | Product created but never provisioned |

---

## LS-01. No code path validates state transitions -- any combination is possible via direct DB write

**Severity: P1**
**Files:** `src/services/scp/instance.ts:306-357`

The `updateLifecycleState` method contains forward-only transition logic:
```typescript
if (current === 'setup' && totalSessions > 0) newState = 'learning';
else if (current === 'learning' && ...) newState = 'operating';
else if (current === 'operating' && ...) newState = 'optimizing';
```

But this is the ONLY code path that performs transitions. There is no state machine validator that rejects invalid transitions. Any code that directly writes to `products.company_lifecycle_state` can set any value, including:
- Regression: `operating` -> `setup`
- Skip: `setup` -> `optimizing`
- Invalid: `'retired'` (not in the enum)

**Evidence:**
- `src/services/scp/provisioner.ts:141`: Sets lifecycle state directly: `UPDATE products SET company_lifecycle_state=?`
- Multiple jobs write to `company_lifecycle_state` without going through `updateLifecycleState`
- No SQL CHECK constraint on the column
- No TypeScript runtime validation on the value

---

## LS-02. A retired company can be resurrected -- and it will be in an inconsistent state

**Severity: P1**
**Files:** `src/services/scp/provisioner.ts:184-193`

`deprovisionSCP` sets `scp_status='archived'` and pauses all agents. But there is no corresponding `reprovisionSCP` or `unarchiveSCP` function. If a founder or admin sets `products.status='active'` and `scp_status='active'` directly in the database:

1. The 12 agent instances have `status='paused'` -- they will not run until manually resumed
2. `next_run_at` values are stale (days/weeks old) -- if agents are resumed, all fire immediately
3. `company_lifecycle_state` is whatever it was at archival time -- no re-evaluation occurs
4. No SCP provisioning check runs (that only happens at server startup)

There is no "reactivation" ceremony that resets agent states, recalculates lifecycle position, and validates readiness.

**Evidence:**
- `deprovisionSCP` exists but no `reprovisionSCP`
- No route or API endpoint for reactivation
- `ensureProvisioned` at startup only runs for products where `isProvisioned` returns false (agent count < 12), which is true for fully provisioned-then-archived products

---

## LS-03. `'scaling'` state exists in types but has no transition logic

**Severity: P2**
**Files:** `src/services/scp/instance.ts:337-354`, `src/types/index.ts`

`CompanyLifecycleState` includes `'scaling'` as a valid value, but `updateLifecycleState` has no condition to transition from `'optimizing'` to `'scaling'`. A product that reaches `'optimizing'` will stay there forever.

**Evidence:**
- `src/services/scp/instance.ts:337-354`: Only transitions up to `'optimizing'`; no `'scaling'` transition
- The `'scaling'` state is referenced in the orientation doc as part of the SCP lifecycle

---

## LS-04. A setup company can skip to scaling via product creation with explicit state

**Severity: P2**
**Files:** `src/routes/dashboard/onboarding.ts`

The onboarding flow creates products with `INSERT INTO products (...)`. If the INSERT does not explicitly set `company_lifecycle_state`, the column default applies. But if a malicious or buggy client includes `company_lifecycle_state='scaling'` in the request body and the handler passes it through to the INSERT, the product starts at an advanced state.

The onboarding handler does construct the INSERT with specific columns, so body injection is not directly possible. But the absence of a CHECK constraint means any service code that writes this column can set arbitrary values.

**Evidence:**
- No SQL CHECK constraint: `ALTER TABLE products ADD CHECK (company_lifecycle_state IN ('setup','learning','operating','optimizing','scaling'))`
- TypeScript type `CompanyLifecycleState` exists but is not validated at the database boundary

---

## LS-05. `products.status` and `products.scp_status` are not synchronized

**Severity: P2**
**Files:** `src/services/scp/provisioner.ts:184-193`

Archiving a product (`status='archived'`) does NOT automatically call `deprovisionSCP` (`scp_status='archived'`). These are separate fields updated by separate code paths. A product can be `status='archived'` with `scp_status='active'`, causing agents to continue running on an archived product (consuming AI credits with no user to benefit).

Conversely, a product can be `status='active'` with `scp_status='archived'` -- visible in the dashboard but with no working agents.

**Evidence:**
- No code path that atomically updates both `status` and `scp_status`
- `getAllActiveProducts()` filters by `WHERE status='active'` but the SCP scheduler filters by `WHERE scp_status='active'` -- different predicates

---

## LS-06. The `lifecycle_state` table and `products.company_lifecycle_state` are parallel state stores

**Severity: P2**

There are TWO lifecycle state tracking mechanisms:
1. `products.company_lifecycle_state` column -- the SCP lifecycle (setup/learning/operating/etc.)
2. `lifecycle_state` table -- per-product row with `current_prompt`, `risk_state`, `dna_completion_pct`, `pending_decisions_count`, and 20+ other fields

These are related but distinct. The SCP lifecycle is about agent maturity. The `lifecycle_state` table tracks the founder's journey through a 9-prompt sequence. They can be out of sync: a product in `company_lifecycle_state='operating'` (SCP mature) but `lifecycle_state.current_prompt='prompt_2'` (founder early in journey).

No code enforces consistency between these two state dimensions.

---

## Recommendations

1. **Implement a state machine validator** -- `function validateTransition(from: State, to: State): boolean` that is the ONLY way to change lifecycle state. Reject invalid transitions.
2. **Add SQL CHECK constraints** -- `CHECK (company_lifecycle_state IN ('setup','learning','operating','optimizing','scaling'))` and `CHECK (scp_status IN ('provisioning','active','archived'))`.
3. **Synchronize `status` and `scp_status`** -- When archiving a product, always call `deprovisionSCP`. When reactivating, require an explicit reactivation flow.
4. **Implement `reactivateSCP`** -- Resume agents with fresh `next_run_at`, re-evaluate lifecycle state, and validate agent health.
5. **Add the `scaling` transition condition** -- Define what triggers `optimizing` -> `scaling` (e.g., 50+ evolution cycles, health >= 85, multiple products).
6. **Unify the two lifecycle tracking systems** -- Either merge `lifecycle_state` into the `products` table or clearly document the two-dimensional model.
