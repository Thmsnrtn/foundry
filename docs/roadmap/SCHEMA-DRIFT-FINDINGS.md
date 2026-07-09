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

## Open — INSERT-column drift (needs subsystem triage)

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
