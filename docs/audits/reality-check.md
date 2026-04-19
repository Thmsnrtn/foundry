# Foundry — Reality Check

Date: 2026-04-19 | Based on direct code and doc inspection, not prior session claims.

---

## 1. Positioning Reality

### What the README says
"Autonomous Business Intelligence Platform" for "SaaS founders who are good at building product but need an autonomous operational layer." Single-founder, single-SaaS-product framing. The README mentions 16 tables, 14 cron jobs, and tier names that are **wrong** (Founding Cohort/Growth/Scale — the code uses Solo/Growth/Investor-Ready). The README has never been updated to match the v3-v6 transformation work.

### What v6 positioning analysis concluded
Dual-layer: "Operating System for Multi-Company Founders" — portfolio operator vocabulary on the surface, autonomous control plane at depth.

### What v6 cold visitors landed on
87% identified the redesigned landing page as "operating system for portfolio/multi-company founders."

### Are these aligned?
**No. The README and the landing page contradict each other.** The README describes a single-founder BI tool. The landing page (after v6 redesign) describes a multi-company portfolio OS. The README is stale and wrong — it reflects the product as it was before v3 started. Anyone reading the repo (investors, contributors, the founder in 6 months) would get a completely different picture from README vs landing page.

---

## 2. What's Actually Built

### Single-tenant or multi-tenant control plane?
**Single-tenant with multi-product support.** The primary domain entity is `products` (owned by `founders` via `owner_id`). A founder can own multiple products. There is no `organizations` table, no `teams` table with cross-org membership, no fleet-level entity. "Multi-company" means "one founder with multiple rows in the products table." This is multi-product, not multi-tenant fleet orchestration.

### Does "managing multiple SCP instances" exist as first-class?
**Partially.** Each product gets its own set of `agent_instances` (12 per product). The `scp_briefings` and `agent_instances` tables are product-scoped. A portfolio route exists (172 lines, enhanced in v5) that shows Signal scores across products. But there is no fleet-level scheduler, no fleet-level agent, no cross-product briefing, no unified decision queue across products.

### Do fleet-level meta-agents exist in code?
**No.** Zero lines of code implement FleetOracle, FleetSentinel, PortfolioLedger, or FleetObservatory. These exist only as specification documents at `docs/scp/fleet-agents/`. The `find` command for any fleet agent identifier in `src/` returns empty. The 12 agents (Atlas through Crucible) all operate within a single product's scope.

### Is "cross-company intelligence" built?
**Minimally.** The `decision_patterns` table is intentionally cross-product and anonymized. A consent check (`hasConsent`) gates writes to it (added in v4). But there is no service that reads from `decision_patterns` to generate cross-company insights and surfaces them to users. The portfolio view shows per-product Signal scores side-by-side — that's aggregation, not intelligence.

---

## 3. The v3-v6 vs Current-State Gap

### Do the audit docs describe features that don't exist?
**Yes.** The v3/v4 audit docs, fleet meta-agent specs, and cross-company data-flow contract describe a system with fleet-level orchestration agents, cross-company pattern extraction, a Fleet Observatory, and company lifecycle state machines with validated transitions. None of this exists in running code. The 150-lens audit audited the code that IS there. The fleet meta-agent specs (4 documents) are architecture documents for code that was never written.

### Do v5 simulations assume scale behaviors the code doesn't support?
**Yes.** v5 simulated operators managing 15-25 company fleets. The simulations correctly identified that the product breaks at fleet scale (no fleet view, no batch operations, O(n) navigation). The fixes v5 shipped (enhanced portfolio view, company pause/resume, fleet-wide export/deletion) improved the situation from "broken" to "functional-but-manual." But the v5 handoff's characterization of Foundry as a "multi-company control plane" overstates what's built. It's a multi-product dashboard with per-product agents.

### Was there a pivot point?
**No explicit pivot.** The product was always a single-founder BI tool with per-product SCP agents. The "fleet control plane" framing was introduced by the v3 transformation directive, not by the codebase. The codebase evolved from "audit my SaaS product" to "run 12 AI agents on my SaaS product" to "do that for multiple products." The fleet/control-plane/fleet-meta-agent layer was always aspirational architecture, documented but not built.

---

## 4. What's Deployable Tomorrow

### What a real founder would get
A server-rendered Hono app (dark theme, clean design) where they:
1. Sign up via Clerk
2. Connect a GitHub repo OR enter a URL
3. Get a 10-dimension audit scored by Claude
4. See a Signal score (0-100) on a dashboard
5. Get 12 AI agents provisioned that run on cron schedules (hourly to weekly)
6. Receive daily/weekly briefings synthesized from agent observations
7. Approve or reject decisions in a gate-controlled queue
8. View stressors, risk state (green/yellow/red), competitive signals
9. If they add a second product (Growth tier), see a basic portfolio view

This is a real, functional product. The single-product experience is genuinely good — the audit engine, agent system, briefing generation, decision queue, and Signal score are all implemented and working.

### Features documented but not shippable
- Fleet-level meta-agents (Oracle, Sentinel, Ledger, Observatory) — specs only
- Cross-company intelligence extraction — no UI, no service
- Fleet Observatory — no code
- Company lifecycle state machine validation — no transition enforcement
- Five-stage company lifecycle board — not built
- Fleet-level cost ceiling — in-memory, per-instance, resets on deploy

### Features that exist but aren't well-surfaced
- Company pause/resume (v5 addition, in settings)
- Returning-user catch-up summary (v5 addition, on dashboard)
- CSV export (v5 addition)
- Fleet-wide export and deletion (v5 addition, in privacy settings)
- Portfolio view with Signal scores (v5 enhancement)

---

## 5. Honest Summary

**What the product is today:** Foundry is an autonomous business intelligence tool for solo SaaS founders that runs 12 specialized AI agents against a connected GitHub repo, producing audits, briefings, risk assessments, and decision recommendations — with tier-gated support for managing 2-5 products from a single account.

**The positioning mismatch:** The v6-redesigned landing page and audit docs position Foundry as a "multi-company autonomous control plane" and "operating system for portfolio founders." The actual product is a single-founder BI tool with multi-product support. The fleet layer (meta-agents, cross-company intelligence, Fleet Observatory) exists only as documentation. This is not dishonest — it's aspirational positioning ahead of implementation — but a real portfolio operator signing up expecting fleet orchestration would be disappointed.

**What v3-v6 optimized that may be vestigial:** 859 markdown audit documents. 150 lens audits. 450 sweep verdicts. 4 fleet meta-agent specs. Cross-company data-flow contracts. These are high-quality architecture and audit artifacts, but they describe a product that is 60% built. The security hardening (encryption, CSRF, RBAC, retry logic, cost ceiling), reliability work (graceful shutdown, job locks, query timeout), and compliance work (GDPR, Privacy Policy, TOS) are all real and valuable in the deployed product. The fleet-layer documentation is an investment in architecture that hasn't been implemented yet.

**What's ready for real users:** The single-product experience. Sign up, connect a repo, get an audit, see your Signal score, receive briefings, approve decisions. This is genuinely useful for a solo SaaS founder. The multi-product experience works functionally but is manual (product switcher, no fleet intelligence).

**The single most important question:** Are you launching as a single-product AI ops tool for solo founders (what's built) or as a multi-company control plane for portfolio operators (what's positioned)? If the former, the product is ready. If the latter, the fleet layer needs to be built before the positioning is credible. Launching with portfolio-operator positioning and a single-product reality will create a trust gap that compounds with every prospect who signs up expecting fleet orchestration.

The README should be updated to match whichever answer you choose. Right now it matches neither.
