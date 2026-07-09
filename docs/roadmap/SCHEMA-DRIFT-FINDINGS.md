# Schema-vs-code drift — audit findings

A systematic sweep (`scripts/check-insert-columns.mjs` + the phantom-table guard
in `tests/unit/no-phantom-tables.test.ts`) found extensive **code-vs-schema
drift**: handlers that pass typecheck and unit tests but reference tables or
columns the real database doesn't have, so they throw `no such table/column`
and 500 **only on a real DB**. This is the same class that hid three
launch-blocking bugs in the Stripe billing webhook.

## Already fixed (this session)

- **Billing webhook** (3 bugs): `SELECT id` on a table keyed `event_id`;
  `datetime("now")` (double-quote → libSQL reads `now` as a column);
  `UPDATE scp_instances` (→ `agent_instances`). The whole trial→active→cancel
  path was dead. Locked by `tests/unit/stripe-webhook-e2e.test.ts`.
- **Phantom tables** (7 sites): `failure_logs`→`failure_log`,
  `lifecycle_states`→`lifecycle_state`, `agent_config`→`agent_instances` (×4);
  created the three tables the code genuinely expects (`agent_decisions`,
  `customer_notes`, `experiment_variants`, migration 083). Guarded by
  `tests/unit/no-phantom-tables.test.ts`.

## Fixed — INSERT/UPDATE-column drift, batch 1 (confident cases)

Reconciled and locked by `tests/unit/schema-drift-fixes.test.ts` (runs the SQL
against the real migrated schema). Migration 084 adds the two columns the code
genuinely needs; the rest are code remaps to real columns.

- **`strategic_decisions_log`** — the `/strategic-decisions` dashboard page was a
  triple bug: the list `ORDER BY created_at` (no such column → 500 on load), the
  create INSERT wrote `title/rationale/decision_made` + `made_by=founder.id` +
  `status='approved'` (two CHECK violations), and the outcome UPDATE wrote
  `outcome_description/retrospective_at/status='retrospective'` (another CHECK
  violation). All remapped to real columns; rating→status now maps to
  `succeeded/failed/inconclusive`. The service writer (`decision-log.ts`) needed
  `alternatives_considered_json` + `key_assumptions_json` (migration 084).
- **`okr_progress_updates`** (agents-okr) — `current_value/recorded_at/recorded_by`
  → `new_value/source='founder_manual'/source_id`, added missing `id`.
- **`agent_wiki_reads`** (agents-wiki) — `reader_id` → `agent_name`, added `id`.
- **`agent_wiki_entries`** (scp/wiki) — added `confidence_score` (migration 084).
- **`customer_intelligence`** (v1 customers) — `name`→`account_name`; dropped
  `company`/`lifecycle_stage` (no such columns; stage keeps its managed default).
- **`agent_initiative_queue`** (v1 agents) — `trigger_type/trigger_data_json` →
  `initiative_type/context`, added NOT-NULL `description`, `status`→`pending`.

## Open — INSERT-column drift (needs a canonical-implementation decision)

~40 sites remain. Unlike batch 1, these are **not** clean renames — the code was
written against a different design than the table enforces, or duplicates another
implementation. Each needs your call on which side is canonical:

| Subsystem | Why it's not a mechanical fix |
|---|---|
| `api/v1/experiments.ts` | `experiments` requires a `hypothesis_id` FK + `type`/`control_description`/`treatment_description` (all NOT NULL) that the API never collects. The table serves the internal hypothesis-driven SCP experiment system; the v1 endpoint is a simpler external model. |
| `api/v1/metrics.ts` | Writes `mrr_cents/new_customers/churned_customers`; `metric_snapshots` has `new_mrr_cents/…` and no customer-count columns. External ingestion model ≠ internal snapshot schema. |
| `api/v1/webhooks.ts` + `services/api/webhooks.ts` | The v1 API is **product-scoped** (`product_id/events_json/is_active/created_by`); the `webhooks` table is **founder-scoped** (`founder_id/url/events/active`). And `webhook_deliveries` is written with `event_type/payload_json/response_status/attempt_count` vs the table's `event/status_code/error`. Two competing webhook designs. |
| `services/network/benchmarks.ts` | Writes per-metric rows (`metric/value/mrr_bracket`) into `network_contributions` (stores one `metrics_contributed` blob per founder) and `network_benchmarks` (`metric_key/p25…p90/sample_size`). The benchmark math and the storage model disagree. |
| `services/integrations/stripe-sync.ts` | Founder-connects-own-Stripe writes `founder_id/access_token_encrypted/scope/active`; the canonical `integrations` table uses `owner_id/credentials/config/status`. |
| `services/rbac/permissions.ts` | Inserts `api_keys(product_id/role/scopes/created_by)` — an RBAC design. The **live** path (`middleware/api-key.ts`, used by the mounted v1 routes) uses the simple `api_keys(founder_id/name/key_hash)`. This file looks like a dead duplicate; also `routes/api/webhooks/transcripts.ts` filters `api_keys WHERE is_active` (column is `revoked_at`). |
| `jobs/index.ts` (audit_log) | Writes `action/details`; `audit_log` has `action_type` + `input_context/output/reasoning` and no `details`. May have meant `agent_audit_log`. Guarded by try/catch. |
| `services/scp/founder-wellbeing.ts` | `snoozeDecision()` has **no callers** (dead) and omits NOT-NULL `decision_type/snoozed_by` while writing a non-existent `reason`. |

Recommended: decide per row whether the **code** or the **table** is canonical,
then remap or migrate. `node scripts/check-insert-columns.mjs` tracks the count
to zero.

---

### Original raw scan (batch reference)

`check-insert-columns.mjs` flags ~50 `INSERT INTO <table> (cols…)` sites whose
columns don't exist on the target table. Spot-verified against authoritative
`PRAGMA table_info` as **largely real** (a few false positives from tables
self-created at runtime, e.g. `schema_migrations.filename`). These are NOT
simple typos — whole subsystems were written against a schema that diverged, and
some have **competing implementations** (e.g. a simple `api_keys`
[founder_id/name/key_hash] that the live v1 routes use, vs an RBAC
`permissions.ts` that inserts product_id/role/scopes). Fixing each requires
deciding **code-wrong (remap columns) vs schema-wrong (add a migration)** and
**which implementation is canonical** — a per-subsystem judgment call.

| Subsystem (file) | Sites | Reachable? | Likely nature |
|---|---|---|---|
| `services/network/benchmarks.ts` | 9 | background job (`network_contribution`) | schema-wrong: table has `metrics_contributed`, code writes `metric/value/mrr_bracket/…` |
| `services/api/webhooks.ts` | 6 | outbound webhook delivery | column drift on `webhook_deliveries` |
| `services/integrations/stripe-sync.ts` | 5 | integration sync job | writes `founder_id/access_token_encrypted/scope/active` to `integrations` (has none) |
| `routes/dashboard/agents-decisions.ts` | 5 | **mounted dashboard** | `strategic_decisions_log` uses `decision_title/decision_rationale`, code writes `title/rationale` |
| `services/rbac/permissions.ts` | 4 | duplicate of `middleware/api-key.ts`? | `api_keys` RBAC columns don't exist; live path uses the simple table |
| `jobs/index.ts` | 4 | scheduled jobs | `audit_log` has `action_type`, code writes `action/details` |
| `api/v1/{webhooks,metrics,experiments,customers,agents}.ts` | 15 | **mounted (API-key auth)** | mixed; `metric_snapshots` code writes `mrr_cents/new_customers` (table has `new_mrr_cents/…`) |
| `routes/dashboard/agents-okr.ts` | 3 | **mounted dashboard** | `okr_progress_updates` column drift |
| `services/scp/{decision-log,wiki,founder-wellbeing}.ts` | 4 | agent runtime | column drift |
| `routes/dashboard/agents-wiki.ts` | 1 | **mounted dashboard** | `agent_wiki_reads.reader_id` |

Plus at least one SELECT/WHERE drift outside the INSERT sweep:
`routes/api/webhooks/transcripts.ts` filters `api_keys WHERE is_active = 1`, but
that table uses `revoked_at` (no `is_active`).

## Reassurance: the core path is clean

The first-touch stranger journey — **signup → onboarding → dashboard →
checkout → billing webhook** — has been driven end-to-end and is schema-correct.
The drift above is in **secondary/advanced subsystems** (network benchmarks,
outbound webhooks, the REST v1 API, agent decision/OKR/wiki logging, own-Stripe
sync). None blocks a first paying customer, but each 500s the moment its feature
is exercised.

## Recommendation

Reconcile subsystem-by-subsystem, each as its own reviewed change: confirm which
implementation is canonical, then either remap the code to real columns or add a
migration — never guess. Run `node scripts/check-insert-columns.mjs` to track
progress to zero, then promote it to a blocking CI guard (like the phantom-table
test) so drift can't return.
