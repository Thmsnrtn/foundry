# Lens 104 — Zero-State Handling

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** Brand new founder, zero products, zero metrics, zero agents, empty dashboard, first-load experience

---

## Executive Summary

Foundry has an onboarding flow that guides founders from signup to first product, but the zero-state handling for individual pages after product creation is inconsistent. The Signal dashboard handles zero metrics gracefully (computing a default score of 85), and empty states exist for stressors and decisions. However, several pages query data that may not exist for a new product and render empty or broken UI. The lifecycle state is created in-memory but not persisted to the database during initial product setup, creating a ghost state that disappears on the next request.

---

## Findings

### ZERO-01 — Lifecycle state defaults not persisted to DB (Severity: High)

**Description:** When the tenant middleware encounters a product with no `lifecycle_state` row, it creates a default object in memory but does not INSERT it into the database. The next request will again find no row and create a new in-memory default. Any mutation to lifecycle state on this first request is lost.

**Evidence:**
- `src/middleware/tenant.ts:72-101`: When `lifecycleResult.rows.length === 0`, a default `LifecycleState` is constructed in memory and set via `c.set()`. No INSERT statement follows.
- This was called out in the orientation document as suspected problem #11.

**Remediation:** After creating the default lifecycle state, persist it with an INSERT. Use `INSERT ... ON CONFLICT DO NOTHING` to avoid races.

---

### ZERO-02 — Dashboard computes Signal for product with zero data (Severity: Medium)

**Description:** The Signal score computation handles zero metrics by using a base score of 85, which is correct. However, the Signal anatomy dialog shows "stressor penalty: 0, MRR penalty: 0, backlog penalty: 0, lifecycle bonus: 0" which, while technically accurate, gives a misleadingly optimistic view of a product that simply has no data.

**Evidence:**
- `src/routes/dashboard/index.ts:40-98`: Signal anatomy dialog renders all zeros as a "healthy" state.
- A new product with zero metrics gets Signal = 85 ("high tier"), which is the same score as a product with healthy metrics.

**Remediation:** Detect the zero-data state explicitly and show a distinct "No data yet" state rather than a misleading score. Consider a "Signal: Pending" state until at least one metric snapshot exists.

---

### ZERO-03 — SCP agents may not be provisioned for new products (Severity: Medium)

**Description:** SCP provisioning happens during server startup for existing products and during onboarding for new products. If onboarding provisioning fails (swallowed error), the product has no agent instances and agent-related pages will render empty.

**Evidence:**
- `src/index.ts:498-510`: Startup provisioning catches and logs errors but continues. `ensureProvisioned` failures are non-fatal.
- `src/services/scp/provisioner.ts:33`: `provisionSCP` returns an error result object rather than throwing, but callers may not check it.
- Orientation document suspected problem #10: "SCP provisioning failures silently swallowed."

**Remediation:** Add a health check on the agents page that detects zero agent instances and offers a "Retry provisioning" button. Persist provisioning status in a column.

---

### ZERO-04 — Competitive intelligence page with zero competitors (Severity: Low)

**Description:** The competitive page renders a stressor report and competitive signals. With zero competitors and zero signals, it renders empty containers. No onboarding prompt or CTA guides the founder to add competitors.

**Evidence:**
- `src/views/components.ts:52-57`: Stressor report empty state says "No significant forward-looking risks identified this week" — misleading for a product with zero data.

**Remediation:** Detect zero competitors specifically and show a "Add your first competitor" CTA rather than the generic "no risks" message.

---

### ZERO-05 — Product switcher with zero products (Severity: Low)

**Description:** If a founder somehow reaches the dashboard with zero products (e.g., product deleted), the product switcher renders an empty select element. The dashboard code tries to use `setCookie`/`getCookie` to remember the selected product, but with no products this results in an undefined product context.

**Evidence:**
- `src/routes/dashboard/index.ts`: The dashboard route reads the product from cookie and falls back to the first product. If zero products exist, `products.rows[0]` is undefined and the page may throw.

**Remediation:** Redirect to `/onboarding` if zero products exist. This is likely already handled in some code paths but should be verified for all authenticated routes.

---

## Embarrassment Test

A founder signs up, connects GitHub, onboarding hangs during SCP provisioning, they refresh, and now they see Signal: 85 with "no risks" on a product with zero data and zero agents. They think the product is broken because nothing is happening. **Likelihood: Medium.**

## Pride Test

The onboarding flow itself (chat-based setup) is thoughtful, and the `stressorReport` empty state messaging is intentional. The team clearly thought about first-run experience for the happy path.

## Distinct-Value Declaration

This lens identifies the specific lifecycle_state persistence gap (in-memory only, never written to DB) as the most dangerous zero-state bug, and maps the misleading Signal score = 85 for zero-data products as a UX trust issue.

## Tenancy-Critical Flag

**No.** Zero-state issues affect individual founder experience but do not cross tenant boundaries.
