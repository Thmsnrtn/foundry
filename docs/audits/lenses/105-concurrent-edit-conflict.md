# Lens 105 — Concurrent-Edit / Conflict Resolution

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** Two browser tabs, same founder, editing same product settings simultaneously. Last-write-wins? Merge? Conflict detection?

---

## Executive Summary

Foundry has zero conflict detection or resolution. Every mutation is a blind last-write-wins UPDATE. There are no optimistic concurrency controls (version columns, ETags), no pessimistic locks, and no conflict detection. The HTMX-based UI naturally reduces the window for conflicts (server-rendered, form-submit-based), but multiple tabs, mobile + desktop, or autonomous agent actions running concurrently with founder actions can silently overwrite each other. The autonomous SCP agents make this especially dangerous — a founder could reject a decision in one tab while an agent simultaneously executes a Gate 0 autonomous action on the same product.

---

## Findings

### CONC-01 — No version column or ETag on any mutable entity (Severity: High)

**Description:** No table has an `updated_at`-based version check, a `version INTEGER` column, or any form of optimistic concurrency control. All UPDATEs overwrite unconditionally.

**Evidence:**
- `src/db/schema.sql`: `products` has `updated_at` but no `version`. `lifecycle_state` has `updated_at` but it is only written, never checked as a precondition.
- `src/middleware/tenant.ts`: Loads lifecycle state at request start. Any concurrent modification between load and the handler's UPDATE will be silently overwritten.

**Remediation:** Add a `version INTEGER DEFAULT 0` column to critical tables (`lifecycle_state`, `decisions`, `products`). Check `WHERE version = ?` in UPDATEs and return 409 Conflict if the row was not updated.

---

### CONC-02 — Agent autonomous actions race with founder decisions (Severity: High)

**Description:** SCP agents run hourly and can execute Gate 0 (autonomous) actions. A founder could be reviewing a Gate 2 decision in the browser while an agent autonomously approves a related Gate 0 decision. Neither party knows about the other's concurrent action.

**Evidence:**
- `src/services/scp/instance.ts`: Agent `analyzeAndAct()` writes signals and actions without checking if the founder is currently interacting.
- `src/routes/dashboard/decisions.ts`: Founder decision approval is a simple form POST with no concurrency check.
- No "lock" or "in-review" status on decisions.

**Remediation:** Add a `locked_by` column to decisions. When a founder opens a decision detail page, mark it as locked. Agents skip locked decisions. Unlock on page close (via a `beforeunload` HTMX request) or after a timeout.

---

### CONC-03 — Product DNA edits have no merge strategy (Severity: Medium)

**Description:** The Product DNA editor is a large form with ~20 text fields. Two tabs editing different DNA fields simultaneously will result in the second save overwriting the first's changes entirely, because the form submits all fields at once.

**Evidence:**
- `src/services/wisdom/dna.ts`: `upsertProductDNA` writes the entire DNA record as a single UPDATE.
- `src/routes/dashboard/products.ts`: DNA save endpoint receives the full form body and overwrites the entire row.

**Remediation:** Use field-level UPDATEs (only SET the changed fields) or implement optimistic locking with a version check.

---

### CONC-04 — Risk state transitions not atomic (Severity: Medium)

**Description:** Risk state transitions (Green -> Yellow -> Red) involve reading the current state, computing the new state, and writing. Without a transaction or CAS operation, two concurrent jobs (e.g., stressor check and SCP scheduler) could both read "green", both compute "yellow", and the second write overwrites the first without issue — but if one computes "yellow" and another computes "red", the final state depends on execution order.

**Evidence:**
- `src/services/intelligence/risk-state.ts`: `transitionRiskState` is called from multiple jobs.
- No transaction wrapping risk state assessment + transition.
- Orientation document: "No transaction support — multi-step operations not atomic."

**Remediation:** Use the `batch()` function in `db/client.ts` which supports transactional writes. Wrap risk state read + assess + transition in a single batch.

---

## Embarrassment Test

A founder opens two tabs. In Tab A, they approve a strategic decision. In Tab B (loaded before Tab A's approval), they see the same decision as "pending" and click "reject". The rejection overwrites the approval. The SCP agents have already begun executing the approved action. **Likelihood: Medium. Especially dangerous with mobile + desktop concurrent access.**

## Pride Test

The HTMX server-rendered approach naturally reduces conflict windows compared to a SPA with local state caching. Form submissions are immediate server roundtrips, limiting the duration of stale state.

## Distinct-Value Declaration

This lens highlights the unique risk that autonomous AI agents create concurrent-edit scenarios that do not exist in traditional multi-user applications. The "two tabs" scenario is standard, but "agent + founder" concurrency is specific to Foundry's architecture and has no conflict resolution at all.

## Tenancy-Critical Flag

**No.** Concurrent edits are within a single founder's product context. Tenants cannot interfere with each other's data (ownership scoping prevents cross-tenant writes).
