# Foundry — Feature Catalog

Every user-facing feature, its purpose, and its current state.

## Core Intelligence

### Signal Score
**Purpose:** Single composite number (0-100) representing overall business health, updated in real-time.
**Route:** `/dashboard`
**Components:** MRR health ratio, activation rate, retention, NPS, support volume, competitive position.

### Risk State System
**Purpose:** Green/Yellow/Red operational health indicator with automatic transitions.
**Route:** Dashboard header
**Behavior:** Yellow = elevated monitoring + Thursday pulse. Red = recovery mode + daily briefing + Gate 0/1 suspension.

### Stressor Identification
**Purpose:** Forward-looking risk signals before they become crises.
**Route:** Dashboard stressor report
**Sources:** MRR decline, cohort deviation, competitive signals, founder motivation.

### Decision Queue
**Purpose:** Structured decision management with 5 gate levels (autonomous → human-only).
**Route:** `/decisions`
**Features:** Scenario models (best/base/stress), cross-product pattern matching, outcome logging.

### Decision Chamber
**Purpose:** Focused deliberation mode for Gate 2+ decisions.
**Route:** `/decisions/:id/chamber`
**Features:** No sidebar, AI reflection, scenario models, outcome prediction.

## SCP Agent System (12 Agents)

| Agent | Role | Authority | Cadence |
|-------|------|-----------|---------|
| Atlas | CTO | Gate 0-2 | 24h |
| Compass | PM | Gate 0-2 | 24h |
| Prism | UX | Gate 0-2 | 48h |
| Beacon | CMO | Gate 0-2 | 48h |
| Scribe | Content | Gate 0-1 | 72h |
| Forge | Revenue | Gate 0-2 | 24h |
| Harbor | CS | Gate 0-2 | 12h |
| Sentinel | DevOps | Gate 0-1 | 6h |
| Ledger | Finance | Gate 0-2 | 24h |
| Shield | Legal | Gate 0-2 | 168h |
| Oracle | Analytics | Gate 0-2 | 24h |
| Crucible | QA | Gate 0-2 | 48h |

### Agent Evolution
**Purpose:** Agents learn and improve through golden lessons, constitutional constraints, and calibration.
**Route:** `/agents/evolution`
**Features:** 5-gate validation pipeline (constitution, regression, size, drift, safety).

### Agent Briefing
**Purpose:** Daily CEO briefing synthesized from all 12 agents' observations.
**Route:** `/agents/briefings/latest`

### Agent Debate
**Purpose:** When agents disagree, a structured debate with Challenger + Synthesizer produces recommendations.
**Route:** `/agents/debate`

## Intelligence Layers

### Competitive Monitoring
**Purpose:** Weekly Claude Sonnet scan of competitors for pricing changes, feature launches, positioning shifts.
**Route:** `/products/:id/competitive`
**Tier:** Investor-Ready

### Cohort Analysis
**Purpose:** Retention by acquisition period and channel.
**Route:** `/products/:id/cohorts`
**Tier:** Investor-Ready

### Scenario Modeling
**Purpose:** Best/base/stress forecasts for Gate 3 decisions.
**Route:** `/scenarios`

### Weekly Brief
**Purpose:** Synthesized operating brief for the upcoming week.
**Route:** `/brief`

## Wisdom Layer

### Product DNA
**Purpose:** ICP definition, positioning, voice, objection handling — calibrates all agent behavior.
**Route:** `/products/:id/dna`
**Tier:** Growth

### Judgment Patterns
**Purpose:** Learns how the founder makes decisions and applies those patterns to recommendations.
**Route:** `/products/:id/patterns`
**Tier:** Growth

### Failure Library
**Purpose:** Documented failure cases with lessons for future reference.
**Route:** `/products/:id/failures`
**Tier:** Growth

## Remediation Engine

### Audit Engine
**Purpose:** 8-step GitHub repository analysis producing 10-dimension scores.
**Route:** `/products/:id/audit`
**Features:** Blocking issue identification, dimension-level scoring, comparison with prior audits.

### Automated Fixes
**Purpose:** AI-generated code fixes for blocking issues, delivered as GitHub PRs.
**Route:** `/agents/remediations`
**Features:** AUTO/WISDOM_REQUIRED/HUMAN_ONLY classification, 0.7 confidence gate.
**Tier:** Growth

## Communication

### Weekly Digest
**Purpose:** Email intelligence digest sent Monday mornings.
**Behavior:** Adapts to risk state — Yellow gets Thursday pulse, Red gets daily briefing.

### Voice Briefings
**Purpose:** Spoken CEO briefing for mobile consumption.
**Route:** `/api/mobile/briefing`
**Platform:** iOS app + Watch complication

### AI Ask
**Purpose:** Conversational business advisor with full product context.
**Route:** Dashboard query bar + `/api/ask`

## Billing & Onboarding

### Three-Tier Pricing
- Solo ($79/mo): 1 product, 12 agents, core intelligence
- Growth ($199/mo): Multi-product, integrations, Wisdom Layer, Remediation Engine
- Investor-Ready ($399/mo): Unlimited, investor layer, competitive, temporal, playbooks

### Onboarding
**Paths:** GitHub OAuth (repo analysis) or No-Code (URL-based audit)
**Features:** Competitor identification, auto-SCP provisioning, guided tour.

## Fleet Intelligence (New — Phase 6)

### Fleet Meta-Agents
- **Fleet Oracle:** Cross-company pattern identification
- **Fleet Sentinel:** Risk correlation across companies
- **Portfolio Ledger:** Fleet financial aggregation
- **Fleet Observatory:** Real-time agent activity across all companies

### Cross-Company Contract
Data flows defined at 4 levels: strictly isolated, anonymized cross-company, fleet intelligence (founder-scoped), benchmarking pool (opt-in).
