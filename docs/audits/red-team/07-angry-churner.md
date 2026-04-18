# RT-07 -- Angry Churning Customer

**Persona:** Founder who signed up 3 months ago, paid $199/mo (Growth tier), connected GitHub, fed it metrics, let the agents run. Product is shutting down. I want every byte of my data, and then I want this thing gone from my life. NOW.

**Date:** 2026-04-16
**Objective:** Export everything. Delete everything. Verify nothing remains. Find every dark pattern that makes leaving harder than joining.

---

## Session Narrative

### Attempt 1: Find the "Delete My Account" Button

I go to Settings (`/settings`). I scan the page. I see:
- Subscription management
- Products list
- Wisdom Network toggle
- Investor/Advisor Access share link
- Metric Ingest URL

No delete button. No "Close Account" link. No "Data Export" button.

The delete and export functionality is not on the Settings page. It is on a separate **Privacy & Data** page at `/privacy`. To find it, I either need to:
1. Know to look in the sidebar under "SYSTEM > Privacy"
2. Use the command palette and search "privacy" or "delete"

For an angry user looking for the exit, putting the delete button on a separate page behind a "Privacy & Data" label is friction. Every SaaS best practice (and GDPR guidance) says the delete option should be accessible from the main settings page, or at minimum linked from it.

**Evidence:**
- `src/routes/dashboard/settings.ts`: no export or delete functionality
- `src/routes/dashboard/privacy.ts`: export and delete live here
- Settings page has no link to Privacy page

**Severity: P2** -- Friction to find account deletion

---

### Attempt 2: Data Export

I navigate to `/privacy`. Section 3 is "Your Data" with an "Export All Data" button linking to `/privacy/export`. I click "Download JSON".

I get a JSON file. Let me analyze what is exported:

```typescript
export async function exportProductData(productId: string, _format: 'json' | 'csv'): Promise<{
  metrics: unknown[];
  briefings: unknown[];
  decisions: unknown[];
  customers: unknown[];
  agent_config: unknown[];
}>
```

The export includes:
1. `metric_snapshots` -- All metric snapshots
2. `scp_briefings` -- Briefing headlines, scores, dates (NOT full content)
3. `decisions` -- Decision records (title, description, status, category)
4. `customers` -- Customer records
5. `agent_configs` -- Agent configuration JSON

**What is MISSING from the export:**

| Data Category | Exported? | Table/Source |
|--------------|-----------|-------------|
| Metric snapshots | Yes | `metric_snapshots` |
| SCP briefings (headlines) | Yes | `scp_briefings` (partial -- no full analysis content) |
| Decisions | Yes | `decisions` (partial -- no resolution notes, no outcome data) |
| Customers | Yes | `customers` |
| Agent configs | Yes | `agent_configs` |
| **Stressor history** | **NO** | `stressor_history` |
| **Conversation threads** | **NO** | `conversation_threads` + `conversation_messages` |
| **Saved insights** | **NO** | `saved_insights` |
| **Agent session logs** | **NO** | `agent_sessions` |
| **Audit results** | **NO** | `audit_results` |
| **Remediation PRs** | **NO** | `remediations` |
| **Decision outcomes** | **NO** | Outcome data from decisions |
| **Signal history** | **NO** | `signal_snapshots` or computed |
| **Risk state transitions** | **NO** | `lifecycle_state` history |
| **Integration credentials** | **NO** | `integration_configs` |
| **Privacy consents** | **NO** | `privacy_consents` |
| **Competitive intelligence** | **NO** | `competitors`, competitive signals |
| **Product DNA** | **NO** | `product_dna` |
| **Cohort data** | **NO** | `cohort_snapshots` |
| **Revenue decomposition** | **NO** | MRR decomposition data |
| **Playbook configurations** | **NO** | Execution playbooks |
| **Notification history** | **NO** | `notifications` |
| **Audit log** | **NO** | `agent_audit_log` |
| **Wisdom/golden lessons** | **NO** | `golden_suite` |
| **Conversation messages (Ask Foundry)** | **NO** | `conversation_messages` |
| **Founder profile** | **NO** | `founders` table |

The export returns 5 tables out of approximately 40+. That is roughly 12% of the data Foundry stores about my product.

Under GDPR Article 20 (Right to Data Portability), the data controller must provide "the personal data concerning him or her, which he or she has provided to a controller, in a structured, commonly used and machine-readable format." The conversations I had with Ask Foundry, the stressors I reviewed, the decisions I resolved, the competitive intelligence I entered -- I "provided" all of this. It is not in the export.

**Evidence:**
- `src/services/privacy/consent.ts` lines 232-277: `exportProductData()` function
- 5 queries total: `metric_snapshots`, `scp_briefings`, `decisions`, `customers`, `agent_configs`
- Schema has 40+ tables (per orientation doc)

**Severity: P0** -- Incomplete data export violates GDPR Article 20

---

### Attempt 3: What Does "Delete" Actually Do?

I click "Delete My Data". A modal appears. I click "Yes, Delete Everything".

The POST handler at `/privacy/delete`:

```typescript
privacySettings.post('/privacy/delete', async (c) => {
  const { scheduleDataDeletion } = await import('../../services/privacy/consent.js');
  await scheduleDataDeletion(ctx.productId, 30);
  return c.redirect('/privacy?success=deletion_scheduled');
});
```

And `scheduleDataDeletion`:

```typescript
export async function scheduleDataDeletion(productId: string, deleteAfterDays: number): Promise<void> {
  await query(
    `INSERT INTO agent_audit_log ... VALUES (?, ?, 'data_deletion_scheduled', 'system', 'system', ...)`,
    [nanoid(), productId, productId, `Data deletion scheduled. Product data will be deleted after ${deleteAfterDays} days.`, ...]
  );
}
```

This function:
1. Inserts a single row into `agent_audit_log` with event type `data_deletion_scheduled`
2. That is it. That is the entire function.

There is **no cron job that reads this audit log entry and actually deletes the data**. I searched for `data_deletion_scheduled` across the entire codebase -- it appears only in this one INSERT statement. No job reads it. No scheduled task processes it. The "deletion" is a log entry that says "please delete me in 30 days" that nobody reads.

The user is told "This will permanently schedule deletion" and the redirect shows `success=deletion_scheduled`. The data is never actually deleted.

**Evidence:**
- `src/services/privacy/consent.ts` lines 280-303: `scheduleDataDeletion` is audit-log-only
- `src/jobs/index.ts`: 26 scheduled jobs, none reference `data_deletion_scheduled`
- `grep -r 'data_deletion_scheduled' src/` returns exactly 1 match (the INSERT)
- `grep -r 'data_deletion' src/` returns exactly the same single match

**Severity: P0** -- Fake deletion. Data is never actually removed. GDPR Article 17 violation (Right to Erasure).

---

### Attempt 4: What About Stripe? Am I Still Being Charged?

The deletion flow does not cancel my Stripe subscription. The `scheduleDataDeletion` function only writes an audit log entry. It does not:
- Cancel the Stripe subscription
- Call `stripe.subscriptions.cancel()`
- Update the `founders.tier` field
- Revoke the Clerk session

So after "deleting" my data (which does not actually happen), I am still:
1. Logged in to Foundry
2. Paying $199/month via Stripe
3. Accumulating agent session runs and AI costs against my product
4. Receiving weekly digest emails

To actually stop paying, I must separately go to Settings > Manage Subscription, which opens the Stripe Customer Portal. The delete flow does not mention this. The modal says "permanently schedule deletion of all your product data" but says nothing about the subscription.

**Evidence:**
- `src/routes/dashboard/privacy.ts` lines 404-416: delete handler does not touch Stripe
- `src/routes/dashboard/settings.ts` lines 294-314: subscription management is a separate flow

**Severity: P1** -- Deletion does not cancel billing. User continues to be charged after "deleting" account.

---

### Attempt 5: Can I Delete Via Clerk?

There is a Clerk webhook handler for `user.deleted` events at `src/routes/auth/clerk.ts` line 144:

```typescript
if (payload.type === 'user.deleted') {
  // Delete products (and all cascaded child rows) then the founder
  await query('DELETE FROM products WHERE id = ?', [productId]);
  await query('DELETE FROM founders WHERE id = ?', [founderId]);
}
```

This is the ONLY code path that actually deletes data. And it only deletes from `products` and `founders` tables. There is no CASCADE defined in the schema queries shown here -- just two DELETE statements. What about:
- `metric_snapshots` (WHERE product_id = ?)
- `scp_briefings` (WHERE product_id = ?)
- `decisions` (WHERE product_id = ?)
- `stressor_history` (WHERE product_id = ?)
- `agent_sessions` (WHERE product_id = ?)
- `conversation_threads` (WHERE product_id = ?)
- `conversation_messages` (WHERE thread_id in threads WHERE product_id = ?)
- `privacy_consents` (WHERE product_id = ?)
- `agent_audit_log` (WHERE product_id = ?)
- All 40+ other tables with product_id foreign keys

The comment says "(and all cascaded child rows)" but SQLite CASCADE ON DELETE requires explicit `FOREIGN KEY ... ON DELETE CASCADE` in the schema, and the code only runs two DELETE statements. If the schema does not have CASCADE constraints (and given that the orientation doc notes "No transaction support -- multi-step operations not atomic"), orphaned rows from all child tables will remain in the database forever.

**Evidence:**
- `src/routes/auth/clerk.ts` lines 144-155: Clerk deletion handler
- Only 2 DELETE statements for 40+ tables of product data

**Severity: P0** -- Clerk-initiated deletion leaves orphaned data in 38+ tables

---

### Attempt 6: Export Format Limitations

The export claims to support `'json' | 'csv'` formats:

```typescript
export async function exportProductData(productId: string, _format: 'json' | 'csv'): Promise<{...}>
```

Note the parameter name: `_format` (with underscore prefix). The underscore convention in TypeScript means "unused parameter". The function completely ignores the format parameter and always returns a JavaScript object. The route handler always serializes it as JSON:

```typescript
return new Response(JSON.stringify(payload, null, 2), {
  headers: { 'Content-Type': 'application/json', ... }
});
```

There is no CSV export path. The function signature promises CSV support. The implementation does not deliver it.

**Severity: P3** -- Misleading API; CSV format not implemented

---

### Attempt 7: Can I Export, Then Delete, Then Verify?

Ideal angry-churner flow:
1. Export data -> Download JSON
2. Delete account -> Confirm
3. Verify data is gone -> ???

There is no verification step. After "deletion" (which only writes an audit log entry), I am redirected to `/privacy?success=deletion_scheduled`. The page still loads. My data is still there. I can still navigate the dashboard. Nothing has changed.

If I export again after "deleting", I get the same data. Because nothing was deleted.

There is also no email confirmation of the deletion request. No "You have 30 days to change your mind" email. No countdown. No status page showing the deletion progress. The deletion is fire-and-forget into a log table that nothing reads.

**Severity: P1** -- No verification, no confirmation email, no status tracking for deletion

---

### Attempt 8: The Founding Cohort Problem

From the orientation doc: "Founding cohort: 30 slots at locked rate." If I delete my account, do I lose my founding cohort slot? Can I re-sign-up and get it back? The billing service (`services/billing/cohort.js`) has an `enforceActivationWindow` function, but deletion does not interact with it.

Since deletion does not actually work, this is moot. But if it did work, a churning founder who later reconsiders would lose their locked rate. There is no "pause" or "hibernate" option visible in the UI.

**Severity: P3** -- No account hibernation; churning is permanent

---

### Attempt 9: What About Anonymized Data in the Wisdom Network?

If I opted into the Wisdom Network (which defaults to opted-in per the consent service defaults), my anonymized decision patterns have been contributed to the cross-product wisdom layer. The privacy page lets me toggle the consent off going forward, but does it retroactively remove my contributed patterns?

The `decision_patterns` table (mentioned in the orientation doc) has "no access controls" and patterns are anonymized. Even if I "delete" my data, my anonymized decision shapes remain in the shared pool. The consent toggle only controls future contributions.

The privacy page does not mention this. It does not disclose that contributed wisdom data cannot be recalled after anonymization. This is a GDPR issue -- Article 17 requires erasure of data, but truly anonymized data (per GDPR Recital 26) falls outside the regulation. The question is: is the anonymization actually irreversible? Without examining the anonymization code, I cannot verify.

**Severity: P2** -- No disclosure that wisdom contributions survive account deletion

---

## Summary of Findings

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| RT-07-01 | Data export covers 5 of 40+ tables (~12% of stored data) | P0 | GDPR Art. 20 |
| RT-07-02 | "Delete" writes an audit log entry; no job reads it; data is never actually deleted | P0 | GDPR Art. 17 |
| RT-07-03 | Clerk user.deleted handler only DELETEs 2 tables, orphaning 38+ tables of data | P0 | Data integrity |
| RT-07-04 | Deletion does not cancel Stripe subscription -- user continues to be charged | P1 | Billing |
| RT-07-05 | No deletion confirmation email, no countdown, no status tracking | P1 | UX |
| RT-07-06 | Delete button hidden on Privacy page, not linked from Settings | P2 | UX friction |
| RT-07-07 | Wisdom Network contributions survive deletion with no disclosure | P2 | Privacy |
| RT-07-08 | CSV export format declared in type signature but not implemented | P3 | Feature gap |
| RT-07-09 | No account hibernation/pause option | P3 | Retention |

**P0: 3 | P1: 2 | P2: 2 | P3: 2**

---

## Verdict

Foundry's data deletion is theater. The "Delete My Data" button writes a log entry that no scheduled job ever reads. The data stays. The subscription continues to charge. The export covers 12% of stored data. The Clerk webhook deletion handler touches 2 of 40+ tables.

A single angry founder who files a GDPR complaint would expose that:
1. The "deletion" mechanism does not delete anything
2. The export mechanism exports a fraction of their data
3. Their billing continues after "deletion"

This is not an edge case or a nice-to-have. This is the most basic obligation a SaaS product has to its customers: let them leave with their data and actually remove what they asked to be removed. Both are broken.

Fix priority:
1. **Immediate:** Implement actual data deletion across all product-scoped tables (or at minimum, the complete list of tables returned by the export)
2. **Immediate:** Cancel Stripe subscription as part of deletion flow
3. **This week:** Expand export to include all product data (stressors, conversations, audit results, signals, agent logs)
4. **This week:** Send confirmation email with cancellation grace period
5. **Next sprint:** Add deletion status tracking and verification
