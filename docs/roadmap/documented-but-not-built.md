# Documented But Not Built

Features and architecture described in v3-v6 audit documentation that do not exist in shipped code. Each item includes documentation location, estimated effort, and whether it's required for a "control plane" positioning or optional.

Operator decision column left blank for the operator to fill in.

---

### FleetOracle — Cross-Company Pattern Identification Agent
- **Documented at:** `docs/scp/fleet-agents/fleet-oracle.md`
- **What it would do:** Identify patterns across a founder's companies (e.g., "Company A's churn pattern matches Company B's 3 months ago")
- **Current state:** Spec with 20+ golden eval cases. Zero implementation on master, branches, or stashes (verified via `docs/audits/unmerged-work-inventory.md`).
- **Effort:** 2-3 weeks (service + scheduler + UI surface)
- **Required for control-plane positioning?** Yes — this is the core differentiation
- **Operator decision:** _______________

### FleetSentinel — Risk Correlation Monitor
- **Documented at:** `docs/scp/fleet-agents/fleet-sentinel.md`
- **What it would do:** Monitor correlated stressors across companies, detect cascade risk
- **Current state:** Spec only. Zero implementation.
- **Effort:** 1-2 weeks
- **Required for control-plane positioning?** Yes
- **Operator decision:** _______________

### PortfolioLedger — Fleet Financial Intelligence
- **Documented at:** `docs/scp/fleet-agents/portfolio-ledger.md`
- **What it would do:** Aggregate MRR, blended churn, per-company unit economics, AI cost/ROI
- **Current state:** Spec only. The portfolio view shows per-product Signal scores but no financial aggregation.
- **Effort:** 1-2 weeks
- **Required for control-plane positioning?** Nice-to-have (portfolio view partially covers this)
- **Operator decision:** _______________

### FleetObservatory — Real-Time Agent Activity Dashboard
- **Documented at:** `docs/scp/fleet-agents/fleet-observatory.md`
- **What it would do:** Show what all agents are doing across all companies in real time
- **Current state:** ✅ **BUILT** (correction 2026-07-13, see
  docs/audits/verification-memo-2026-07-13.md): `src/services/fleet/observatory.ts`
  + the `/fleet` route — every agent's status/last/next run/health plus pending
  decisions across all the founder's products. Read-only, no new writes.
- **Effort:** n/a — shipped
- **Required for control-plane positioning?** Yes — and it exists
- **Operator decision:** n/a — shipped

### Cross-Company Intelligence Service
- **Documented at:** `docs/scp/cross-company-contract.md`, v4 defect registry
- **What it would do:** Read `decision_patterns` table and generate actionable insights for users
- **Current state (corrected 2026-07-13):** Table exists, consent-gated writes
  work, and PARTIAL readers exist (`services/intelligence/peer-signal.ts`,
  `services/network/benchmarks.ts`, the B4 network radar feeding Letter/
  briefing warnings). Still missing: the spec'd insight-generation reader
  surfaced as a portfolio card.
- **Effort:** 1-2 weeks (service to query patterns + UI card on portfolio view)
- **Required for control-plane positioning?** Yes — without it, "cross-company" is just a label
- **Operator decision:** _______________

### Five-Stage Company Lifecycle Board
- **Documented at:** v3 orientation doc, v5 persona journeys
- **What it would do:** Visualize companies by lifecycle stage (setup → learning → operating → optimizing → scaling)
- **Current state:** Lifecycle states exist per product. No board/visualization.
- **Effort:** 3-5 days
- **Required for control-plane positioning?** Nice-to-have
- **Operator decision:** _______________

### SCP Instance Manager UI
- **Documented at:** v3 orientation, v5 journeys
- **What it would do:** Provision, pause, retire, migrate SCP instances from a dedicated management screen
- **Current state:** Pause/resume exists in settings (v5 addition). No dedicated management UI. No retire/migrate.
- **Effort:** 1-2 weeks
- **Required for control-plane positioning?** Nice-to-have (settings pause/resume covers basics)
- **Operator decision:** _______________

### Multi-Organization Architecture
- **Documented at:** v4 lens 33 (auth expert), v5 simulations
- **What it would do:** Allow a founder to belong to multiple organizations, each with multiple products and team members
- **Current state:** Single-founder-per-account. No `organizations` table. Team members are flat per-founder.
- **Effort:** 1-2 months (schema redesign, auth rework, billing rework)
- **Required for control-plane positioning?** Only if targeting enterprise/team use cases
- **Operator decision:** _______________

### Validated Lifecycle State Transitions
- **Documented at:** v4 lens 131 (lifecycle state machine edge cases)
- **What it would do:** Prevent invalid lifecycle transitions (e.g., retired → active, scaling → setup)
- **Current state:** Any state can be set. No validation.
- **Effort:** 2-3 days
- **Required for control-plane positioning?** No — edge case safety
- **Operator decision:** _______________

### Fleet-Level Cost Ceiling (Persistent)
- **Documented at:** v4 defect registry, v5 friction entries
- **What it would do:** Persist daily AI cost tracking across deploys (currently in-memory, resets)
- **Current state:** In-memory Map, per-instance, resets on every deploy
- **Effort:** 2-3 days (write to DB instead of Map)
- **Required for control-plane positioning?** No — but important for cost control
- **Operator decision:** _______________

### Golden Eval Test Suites (CI-Wired)
- **Documented at:** Fleet meta-agent specs (20+ cases each)
- **What it would do:** Run golden eval test cases against agent outputs in CI
- **Current state:** Eval cases documented in JSON within markdown specs. Not wired into vitest or CI.
- **Effort:** 1-2 weeks
- **Required for control-plane positioning?** No — quality assurance tooling
- **Operator decision:** _______________
