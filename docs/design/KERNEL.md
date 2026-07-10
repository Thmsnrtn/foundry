# The autonomy kernel — platformization seed (Trust Plane phase 4)

Studying AcreOS revealed its deepest architectural move: a **domain-agnostic
autonomy kernel** (perceive → decide → act → learn, the trust ladder, the
experience ledger) separated from **domain packs** (everything land-specific)
by a single interface and a CI-enforced import boundary. AcreOS's own docs name
the platformization milestone: *a deliberately-foreign second pack running on
the unchanged kernel.*

**Foundry is that second pack in waiting.** Both products now implement the
same trust physics; this doc + `scripts/check-kernel-boundary.mjs` keep
Foundry's kernel extractable so the two can one day share one engine — the
operating system for companies of one, with verticals as packs.

## Foundry's kernel (domain-agnostic — nothing SaaS in it)

| Module | Loop stage |
|---|---|
| `services/memory/` — belief ledger, premise checking | commit / learn |
| `services/redteam/` — adversarial pre-mortem + vindication | contest |
| `services/ghost/` — seeded Monte-Carlo forking | frame |
| `services/trust/` + `services/autopilot/` — earned-autonomy ladder, act path, grants | decide / act |
| `services/letter/` — the deterministic daily artifact | the whole loop |
| `services/truth/` — claim-vs-source verification | honesty |
| `services/wellbeing/` — operator strain from decision telemetry | human |
| `services/chat/` — conversation-as-capture | capture |
| `db/schema/` — the typed schema-as-code kernel | substrate |

## Foundry's SaaS pack (vertical-specific)

`services/scp/` (the 12 agents + briefings), `services/audit/` (codebase
audit), `services/integrations/` (SaaS metric adapters), the SaaS metric
vocabulary (`CHECKABLE_METRIC_KEYS`), landing/pricing.

## The boundary (CI-enforced, baseline 0)

Kernel modules may not import from pack dirs (`scp/`, `audit/`,
`integrations/`). One-directional: packs use the kernel, never the reverse.
`npm run kernel:boundary` runs in every `check`. Verified clean at inception —
the boundary held naturally because the kernel was built under the
constitution.

## What a future DomainPack would provide (per AcreOS's seam)

- the decision-category vocabulary + checkable metric keys and their sources
- the agent roster / domain intelligence (Foundry: SCP agents)
- a causal model for the Ghost simulator's priors
- a regulatory/claims profile for the truth engine

Extraction is deliberately deferred until both products are live — the boundary
check keeps the option open at zero cost.
