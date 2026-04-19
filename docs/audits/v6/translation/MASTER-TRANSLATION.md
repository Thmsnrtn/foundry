# Foundry — Master Translation Table (v6)

Generated: 2026-04-18

Maps Foundry vocabulary to adjacent product vocabulary. Flags terms where 3+ adjacent
products use a common term but Foundry uses something different.

---

## Entity & Scope Vocabulary

| Foundry Term | Adjacent Products Use | Products Using It | Flag |
|---|---|---|---|
| **Product** (company instance) | Portfolio Company | Visible, Carta, Metabase (tenant) | FLAG: 3+ products say "portfolio company" or "company"; Foundry says "product" |
| **Fleet** (set of managed companies) | Portfolio / Fund | Visible, Carta, Runway | FLAG: 3+ products say "portfolio"; Foundry says "fleet" |
| **Founder** (primary user) | GP / Operator / Admin | Visible (GP), Carta (GP), Mercury (account owner) | -- |
| **Multi-company operator** | Portfolio manager / Fund manager | Visible, Carta | -- |
| **Sovereign Company Protocol (SCP)** | No equivalent | -- | Foundry-unique term |
| **Company lifecycle stage** | Stage / Status | Visible (stage), Carta (series/stage) | -- |

## Agent & Autonomy Vocabulary

| Foundry Term | Adjacent Products Use | Products Using It | Flag |
|---|---|---|---|
| **Agent** (autonomous AI worker) | Agent / Crew member | CrewAI (agent), LangGraph (agent), Carta ("agentic") | FLAG: 3+ products use "agent" -- Foundry aligns here |
| **Gate** (authority level 0-4) | Guardrail / Breakpoint / Human-in-the-loop | CrewAI (guardrail), LangGraph (breakpoint, HITL) | -- |
| **Briefing** (agent output summary) | Report / Dashboard / Update | Visible (update), Runway (report), Metabase (dashboard) | FLAG: 3+ products say "report" or "dashboard"; Foundry says "briefing" |
| **Signal** (event/metric from agent) | Alert / Notification / Insight | Metabase (alert, pulse), Runway (insight), Visible (update) | FLAG: 3+ products say "alert" or "insight"; Foundry says "signal" |
| **Golden lesson** (accumulated agent wisdom) | Training data / Memory / Pattern | CrewAI (memory, training), LangGraph (memory) | -- |
| **Constitution** (agent behavior rules) | Guardrails / System prompt / Policy | CrewAI (guardrails), LangGraph (system prompt) | -- |
| **Decision** (agent-proposed action) | Recommendation / Action / Task | CrewAI (task), Runway (scenario) | -- |
| **Atlas, Compass, Prism, etc.** (named agents) | No equivalent naming | -- | Foundry-unique |

## Intelligence & Analytics Vocabulary

| Foundry Term | Adjacent Products Use | Products Using It | Flag |
|---|---|---|---|
| **Risk state** (Green/Yellow/Red) | Health score / Status / RAG status | Visible (health/RAG), Metabase (alert status) | -- |
| **Stressor** (risk trigger) | Driver / Factor / Signal | Runway (driver, assumption), Causal (variable) | -- |
| **Intelligence layer** | Analytics / Insights / BI | Metabase (BI), Runway (insights), Visible (insights) | FLAG: 3+ products say "analytics" or "insights"; Foundry says "intelligence" |
| **Scenario modeling** | Scenario planning / What-if analysis | Runway (scenario), Causal (scenario) | Foundry aligns here |
| **Cross-company intelligence** | Benchmarking / Cross-portfolio analytics | Visible (benchmarking), Carta (portfolio analytics) | -- |
| **Wisdom Layer** | Knowledge base / Institutional memory | CrewAI (long-term memory), LangGraph (persistent memory) | -- |
| **MRR decomposition** | Revenue analytics / ARR breakdown | Runway (revenue model), Mercury (financial metrics) | -- |

## Operational Vocabulary

| Foundry Term | Adjacent Products Use | Products Using It | Flag |
|---|---|---|---|
| **Tier** (Solo/Growth/Investor-Ready) | Plan / Tier / Edition | Metabase (Starter/Pro/Enterprise), Mercury (Free/Plus/Pro) | Foundry aligns here |
| **Audit** (GitHub analysis pipeline) | Code review / Assessment / Analysis | -- | Foundry-specific scope |
| **Remediation** (fix generation) | Fix / Resolution / Action item | -- | Foundry-specific scope |
| **Provisioning** (SCP instance creation) | Onboarding / Setup / Deployment | CrewAI (deployment), LangGraph (deployment), Mercury (onboarding) | FLAG: 3+ products say "onboarding" or "setup"; Foundry says "provisioning" |
| **Digest** (periodic summary email) | Update / Newsletter / Report | Visible (update), Runway (report) | -- |
| **Observatory** (fleet-level agent view) | Dashboard / Console / Studio | CrewAI (Studio), LangGraph (Studio), Metabase (dashboard) | FLAG: 3+ products say "dashboard" or "studio"; Foundry says "observatory" |

---

## Flagged Translation Gaps (3+ Adjacent Products Diverge from Foundry)

These are the highest-priority translation decisions. In each case, 3 or more adjacent
products use term X while Foundry uses term Y. The gap creates comprehension cost for
buyers coming from these adjacent products.

### 1. "Product" vs. "Portfolio Company" / "Company"

- **Adjacent consensus:** Visible, Carta, and Mercury all use "company" or "portfolio
  company" as the entity being managed.
- **Foundry uses:** "Product" (inherited from single-founder SaaS framing).
- **Risk:** Multi-company operators think in "companies," not "products." A product is
  something a company sells; a company is what an operator runs. Using "product"
  signals a tool-level perspective, not an operator-level perspective.
- **Recommendation:** Rename to "company" in fleet-facing contexts. "Product" can
  persist as an internal/data concept, but the UI and messaging should say "company."

### 2. "Fleet" vs. "Portfolio"

- **Adjacent consensus:** Visible, Carta, and Runway use "portfolio" for a collection
  of managed entities.
- **Foundry uses:** "Fleet" (borrowed from infrastructure/DevOps).
- **Risk:** "Portfolio" is universally understood by the target audience (multi-company
  operators, investors, serial founders). "Fleet" is understood by infrastructure
  engineers. However, "fleet" carries connotations of active management and
  coordination that "portfolio" lacks.
- **Recommendation:** Use "portfolio" in acquisition/onboarding vocabulary. Gradually
  introduce "fleet" as the user experiences autonomous agent coordination. "Portfolio"
  is the familiar surface layer; "fleet" is the category-defining depth layer.

### 3. "Briefing" vs. "Report" / "Dashboard"

- **Adjacent consensus:** Visible, Runway, Causal, and Metabase all use "report" or
  "dashboard" for agent/system output summaries.
- **Foundry uses:** "Briefing" (military/executive connotation).
- **Risk:** Low. "Briefing" is intentionally distinct and carries connotations of
  importance, time-sensitivity, and executive audience. This is a productive
  vocabulary divergence.
- **Recommendation:** Keep "briefing." It signals that Foundry's output is actionable
  intelligence, not a static report. This is a category-defining term worth owning.

### 4. "Signal" vs. "Alert" / "Insight"

- **Adjacent consensus:** Metabase, Runway, and Visible use "alert" or "insight" for
  system-generated notifications.
- **Foundry uses:** "Signal" (intelligence/systems connotation).
- **Risk:** Low. "Signal" implies pattern detection and intelligence, while "alert"
  implies threshold-based notification. This is a meaningful semantic distinction.
- **Recommendation:** Keep "signal." Consider using "alert" only for threshold-based
  notifications (risk state changes) and "signal" for pattern-detected intelligence.

### 5. "Intelligence" vs. "Analytics" / "Insights"

- **Adjacent consensus:** Metabase, Runway, and Visible use "analytics" or "insights."
- **Foundry uses:** "Intelligence" (and "intelligence layer").
- **Risk:** Medium. "Analytics" is universally understood; "intelligence" carries
  connotations of autonomous reasoning that may not be immediately understood.
- **Recommendation:** Use "analytics" in surface-level messaging, "intelligence" in
  product depth. The progression: "analytics" (data you can see) → "insights" (data
  interpreted for you) → "intelligence" (data acted on autonomously).

### 6. "Provisioning" vs. "Onboarding" / "Setup"

- **Adjacent consensus:** CrewAI, LangGraph, Mercury, and Causal use "onboarding" or
  "setup" for initial configuration.
- **Foundry uses:** "Provisioning" (infrastructure/cloud connotation).
- **Risk:** High for non-technical users. "Provisioning" sounds like server
  infrastructure, not business setup.
- **Recommendation:** Use "setup" or "onboarding" in user-facing contexts. Reserve
  "provisioning" for internal/technical documentation. "Add a company" is better than
  "provision an SCP instance."

### 7. "Observatory" vs. "Dashboard" / "Studio"

- **Adjacent consensus:** CrewAI (Studio), LangGraph (Studio), Metabase (dashboard).
- **Foundry uses:** "Observatory" (for fleet-level agent view).
- **Risk:** Low. "Observatory" is intentionally evocative — it implies watching a
  complex system in real time. "Dashboard" is generic; "Studio" implies creation.
- **Recommendation:** Keep "Observatory" as the branded term. Use "dashboard" as a
  generic fallback in contexts where "Observatory" needs explanation. "Your fleet
  Observatory (the live dashboard for all your companies)" bridges both.

---

## Translation Quick Reference

For landing page and onboarding copy, use the left column. For product depth and
category-defining content, use the right column.

| Acquisition Language (Familiar) | Category Language (Foundry-Native) |
|---|---|
| Company | Company (governed by SCP) |
| Portfolio | Fleet |
| Dashboard | Observatory |
| Report | Briefing |
| Alert | Signal |
| Analytics | Intelligence |
| Setup / Onboarding | Provisioning |
| Health score | Risk state |
| Automation | Autonomous agent |
| AI assistant | Agent (with authority gates) |
| Template | Constitution |
| Best practice | Golden lesson |
| Scenario planning | Scenario modeling (cross-fleet) |
| Benchmark | Cross-company intelligence |
