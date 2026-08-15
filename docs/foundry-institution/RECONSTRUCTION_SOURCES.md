# Company reconstruction source map

This map prevents reconstruction from becoming a competing company database. Canonical facts remain queried from their owning ledgers. Durable reconstruction claims exist only for bounded interpretations, conflicts, and explicit unknowns, with typed same-product provenance.

| Concern | Current source | Scope / freshness | Status and limitation |
|---|---|---|---|
| Company/product identity and owner | `products`, `founders` | Product/owner; current row | Canonical identity. Do not copy into claims. Product descriptions and purpose are incomplete. |
| People and roles | `team_members`, RBAC/membership tables | Product; current row | Near-canonical for configured users; absence does not mean nobody holds a role. |
| Systems and integrations | `integrations`, provider-specific connection tables, `integration_events` | Product; `last_synced_at` or event time | Connection state is canonical locally; provider reality can be stale or conflicting. Credentials remain owned by their authenticators and are never reconstruction evidence payloads. |
| Signals/evidence | `signal_events`, metric snapshots, audit inputs, wiki entries | Product; observed/created timestamps | Canonical observations, not automatically canonical interpretations. Wiki content is founder/agent-authored and versioned but may conflict with telemetry. |
| Responsibilities/capabilities | `institutional_responsibilities`, transitions, dispositions | Product; append-only transition time | Canonical responsibility truth. Discovery evidence is typed; ownership can remain unknown. |
| Authority and control | `autonomy_consents`, policies, API/RBAC ownership, gateway registrations | Product/capability; revocation/current policy | Canonical authority at the enforcing boundary. Capability or a claim cannot grant authority. |
| Decisions and commitments | decision queues, strategic decision log, premises, actions | Product; status/deadline/check time | Canonical for recorded commitments only. Unrecorded commitments remain unknown. |
| Attempts, receipts, outcomes, reconciliation | `action_executions`, webhook deliveries, audit/outcome ledgers | Product; attempt/verify/reconcile timestamps | Provider acknowledgment is receipt evidence, not business outcome. Ambiguity and pending reconciliation remain explicit. |
| Financial state | metric snapshots, financial snapshots, Stripe-derived ledgers, AI spend ledger | Product/founder/global; snapshot date | Canonical local observation with source-specific staleness; missing data remains unknown. |
| Operational activity and risk | temporal events, signal/integration events, lifecycle/risk projections | Product; event or computation time | Events are canonical observations; risk is derived and must retain its checked inputs/time. |
| Communications | conversation/message/digest/notification ledgers | Product/founder; send/receive time | Canonical local record, not proof the recipient understood or acted. |
| Software/development state | GitHub integration, action/audit records, project artifacts | Product; sync/receipt time | Partial and connector-dependent. Repository/provider state may be stale. |
| External dependencies | integrations, outbound actions, webhook endpoints, action plans | Product; status/last sync | Partial. A configured integration does not prove availability or authority. |

## Reconstruction rule

Use direct projections for canonical current facts. Use `reconstruction_claims` only when Foundry must preserve a bounded interpretation (`known` or `inferred`), an explicit absence of knowledge (`unknown`), unresolved evidence disagreement (`conflicting`), or an expired observation (`stale`). Positive claims require typed evidence resolving to the same product. Inference requires confidence and a derivation method. Read-time expiry turns elapsed claims stale; it never silently refreshes them.

The current typed provenance vocabulary is intentionally small: product identity, signal event, wiki entry, integration, responsibility, authority consent, and action execution. Adding a source kind requires a canonical tenant-bound owner and adversarial validation; arbitrary URLs, caller labels, and model assertions are not evidence references.
