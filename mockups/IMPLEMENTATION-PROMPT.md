# Foundry Roadmap Implementation Prompt

Copy everything below the line into a Claude Code terminal pointed at `/Users/user/foundry`.

---

You are implementing a comprehensive platform roadmap for Foundry, an autonomous business intelligence platform for SaaS founders. The full roadmap and context is in `mockups/founder-intelligence-report.md` — read it fully before starting.

## Codebase Context

- **Runtime:** Node.js 20+ / TypeScript / Hono framework
- **Database:** Turso (libSQL) — remote SQLite, multi-tenant by `owner_id`
- **AI:** Anthropic Claude API (Opus for strategy, Sonnet for operations)
- **Auth:** Clerk JWT
- **Email:** Resend
- **Payments:** Stripe (3 tiers: Founding Cohort $99, Growth $199, Scale $399)
- **Schema:** `src/db/schema.sql` + migrations in `src/db/migrations/`
- **Services:** `src/services/` (ai, audit, intelligence, decisions, lifecycle, digest, story, billing, wisdom)
- **Routes:** `src/routes/` (public, auth, dashboard, api, internal)
- **Jobs:** `src/jobs/index.ts` (14 cron jobs)
- **Types:** `src/types/index.ts`, `src/types/database.ts`, `src/types/ai.ts`, `src/types/api.ts`

Follow existing patterns exactly: structured logger, Hono context, Turso batch queries, gate system (0-4), risk state (Green/Yellow/Red), multi-tenant scoping by `owner_id`.

## Implementation Order

Execute the 4 tiers sequentially. Within each tier, implement features in the order listed. For each feature: schema first, types second, services third, routes fourth, jobs fifth (if applicable).

---

## TIER 1: Foundation Reinforcement

### 1.1 Sector Profile System

**Migration `004_sector_profiles.sql`:**
```sql
ALTER TABLE products ADD COLUMN sector_profile TEXT DEFAULT 'b2b_saas';
-- Valid values: b2b_saas, consumer, marketplace, healthcare, education, government, climate_impact, developer_tools, fintech, deep_tech, vertical_saas

CREATE TABLE sector_scoring_overrides (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  dimension TEXT NOT NULL,           -- d1 through d10
  weight_override REAL,              -- null means use default
  passing_threshold_override REAL,   -- null means use default
  critical_findings_override TEXT,   -- JSON array of sector-irrelevant finding codes to suppress
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sector_remediation_templates (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  dimension TEXT NOT NULL,
  tone TEXT DEFAULT 'standard',      -- standard, encouraging, direct, plain_english
  template_context TEXT,             -- JSON: sector-specific remediation guidance
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Types** — add to `src/types/index.ts`:
- `SectorProfile` union type with all valid sector values
- `SectorScoringOverride` interface
- `SectorRemediationTemplate` interface

**Service** — create `src/services/audit/sector-profiles.ts`:
- `getSectorProfile(productId)` — returns the product's sector config
- `getScoringOverrides(sector)` — returns dimension weight/threshold overrides for the sector
- `getRemediationTone(sector, founderExperience)` — returns appropriate tone
- `isFindingRelevant(finding, sector)` — filters out sector-irrelevant findings
- Seed default overrides for all 11 sectors. Key calibrations:
  - `healthcare`: D5 weight 0.20 (up from 0.15), add HIPAA to D5 critical findings
  - `education`: D6 suppress "no monthly billing" finding, add "annual PO support" check
  - `government`: D5 weight 0.25, add ATO/FedRAMP to D9 critical findings
  - `consumer`: D10 weight 0.15 (up from 0.05), D4 weight 0.15
  - `marketplace`: add trust infrastructure to D3, add liquidity to D1
  - `developer_tools`: D1 weight 0.20, D7 weight 0.15 (docs matter more)
  - `fintech`: D6 weight 0.20, add compliance to D5 critical findings

**Integration** — modify `src/services/audit/scorer.ts`:
- Before scoring, load sector overrides
- Apply weight overrides to composite score calculation
- Filter findings through `isFindingRelevant`
- Pass tone to remediation generation

**Route** — add to product settings:
- `POST /api/products/:id/sector` — set sector profile
- Show sector selection during product onboarding

### 1.2 Growth Stage Detection

**Migration `005_growth_stages.sql`:**
```sql
ALTER TABLE products ADD COLUMN growth_stage TEXT DEFAULT 'pre_launch';
-- Valid: pre_launch, early_traction, growth, scale, mature
ALTER TABLE products ADD COLUMN growth_stage_updated_at TEXT;
ALTER TABLE products ADD COLUMN growth_stage_overridden INTEGER DEFAULT 0;
```

**Service** — create `src/services/lifecycle/stage-detection.ts`:
- `detectGrowthStage(productId)` — auto-classifies based on:
  - `pre_launch`: 0 customers OR no metric snapshots
  - `early_traction`: 1-50 customers AND < $5K MRR
  - `growth`: 50-500 customers OR $5K-$50K MRR
  - `scale`: 500+ customers OR $50K+ MRR
  - `mature`: 12+ months of <10% monthly growth AND MRR > $10K
- `getStageConfig(stage)` — returns stage-specific behavior config:
  - `pre_launch`: suppress metric-based stressors, focus audit on D1-D4/D9-D10, track ship velocity
  - `early_traction`: prioritize hypothesis validation, churn diagnosis, ICP refinement
  - `growth`: surface unit economics, scaling constraints, first hire analysis
  - `scale`: surface team dynamics, market positioning, category creation
  - `mature`: surface efficiency, adjacent markets, lifestyle mode option
- `getStageStressorThresholds(stage)` — relaxed thresholds for early stages, tighter for scale

**Integration:**
- `intelligence/stressor.ts` — use stage-adjusted thresholds
- `intelligence/risk-state.ts` — stage-aware risk calculation (pre-launch products can't go Red from metric absence)
- `digest/generator.ts` — stage-adapted digest content (pre-launch gets shipping focus, not MRR analysis)
- `jobs/index.ts` — add `stage_detection` job running daily, updates product stage unless overridden

### 1.3 Founder Health Dashboard

**Migration `006_founder_health.sql`:**
```sql
CREATE TABLE founder_health (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  personal_runway_months REAL,       -- self-reported
  weekly_hours_available REAL,       -- self-reported
  immigration_status TEXT,           -- optional: citizen, permanent_resident, work_visa, student_visa, other
  visa_expiry_date TEXT,             -- optional
  key_persons TEXT,                  -- JSON array: [{name, role, replaceability: 1-5, departure_risk: low/medium/high}]
  engagement_trend TEXT DEFAULT 'stable', -- rising, stable, declining, critical
  last_login_streak INTEGER DEFAULT 0,
  avg_decision_response_hours REAL,
  motivation_score REAL,             -- computed from engagement signals, 0-100
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(founder_id)
);

CREATE TABLE founder_health_snapshots (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  motivation_score REAL,
  engagement_trend TEXT,
  weekly_hours_available REAL,
  personal_runway_months REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/intelligence/founder-health.ts`:
- `computeMotivationScore(founderId)` — based on:
  - Login frequency trend (7-day, 30-day rolling)
  - Decision response latency trend
  - Deployment/commit frequency (if GitHub connected)
  - Digest open rate (if trackable)
- `detectEngagementTrend(founderId)` — rising/stable/declining/critical
- `assessKeyPersonRisk(founderId)` — returns risk level and impact description
- `getFounderHealthSummary(founderId)` — composite health view
- `generateFounderHealthDigestSection(founderId)` — discreet, supportive digest section

**Integration:**
- Add to digest generator as optional section (opt-in via founder preferences)
- Add founder health stressor types: `founder_burnout_risk`, `key_person_dependency`, `runway_critical`
- Add to risk state calculation: if `motivation_score < 30` for 7+ days, add to severity score

**Routes:**
- `GET /api/founder-health` — get health data
- `PUT /api/founder-health` — update self-reported fields
- `GET /dashboard/founder-health` — dashboard page with trend charts
- Onboarding step to optionally set personal runway and hours

### 1.4 Lifestyle Mode

**Migration `007_lifestyle_mode.sql`:**
```sql
ALTER TABLE founders ADD COLUMN lifestyle_mode INTEGER DEFAULT 0;
ALTER TABLE founders ADD COLUMN lifestyle_target_mrr REAL;  -- optional target MRR for steady state
```

**Service** — modify existing services:
- `intelligence/risk-state.ts`: if `lifestyle_mode`, flat or declining growth below target MRR is not a stressor. Only stressors: churn spikes, customer complaints, operational failures.
- `intelligence/stressor.ts`: suppress growth-oriented stressors in lifestyle mode. Keep: retention, quality, operational health.
- `digest/generator.ts`: lifestyle digest variant — shorter, focused on profitability, customer satisfaction, and operational efficiency. No growth pressure language.
- `intelligence/scenario.ts`: lifestyle scenarios model profitability optimization, not scale.

**Routes:**
- `PUT /api/settings/lifestyle-mode` — toggle lifestyle mode, set target MRR
- Dashboard indicator when lifestyle mode is active

---

## TIER 2: Market Expansion

### 2.1 Non-Code Founder Track

**Migration `008_non_code_track.sql`:**
```sql
ALTER TABLE products ADD COLUMN build_platform TEXT DEFAULT 'custom_code';
-- Valid: custom_code, bubble, retool, webflow, wordpress, shopify, glide, softr, agency_built, other

CREATE TABLE web_audit_results (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  url TEXT NOT NULL,
  lighthouse_scores TEXT,            -- JSON: {performance, accessibility, best_practices, seo}
  page_analysis TEXT,                -- JSON: detected features, forms, payments, auth
  trust_signals TEXT,                -- JSON: SSL, privacy policy, terms, contact info
  mobile_responsiveness TEXT,        -- JSON: viewport, touch targets, font sizes
  findings TEXT,                     -- JSON array matching audit finding format
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE vendor_recommendations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL,            -- migration, development, design, security, compliance
  recommendation TEXT NOT NULL,
  priority TEXT DEFAULT 'medium',    -- low, medium, high, critical
  estimated_cost_range TEXT,         -- e.g. "$2K-$5K"
  estimated_timeline TEXT,           -- e.g. "2-4 weeks"
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/audit/intake-web.ts`:
- `runWebAudit(url, productId)` — performs URL-based analysis:
  - Fetch the URL and analyze HTML/meta tags
  - Check SSL, security headers, mobile viewport
  - Detect payment processor (Stripe badge, PayPal, etc.)
  - Detect auth system (login forms, OAuth buttons)
  - Detect trust signals (privacy policy link, terms link, contact info)
  - Map findings to the 10-dimension framework (as much as possible from external analysis)
  - Use Claude Sonnet to analyze the page content and score D3 (Trust), D4 (Value Legibility), D10 (Stranger Test) from the user's perspective
- `generateVendorRecommendations(auditResults, productId)` — instead of GitHub PRs, generate actionable vendor/contractor recommendations with cost and timeline estimates
- `assessMigrationReadiness(productId)` — when a no-code product hits limits, assess whether migration to custom code is warranted and provide a transition plan

**Integration:**
- Product onboarding: if `build_platform` is not `custom_code`, skip GitHub connection, show URL input instead
- Audit engine: branch between GitHub audit and web audit based on `build_platform`
- Remediation system: branch between PR generation and vendor recommendations
- Lifecycle system: support non-GitHub products through all prompts

**Routes:**
- `POST /api/products/:id/web-audit` — trigger web-based audit
- `GET /dashboard/products/:id/vendor-recommendations` — view vendor recommendations
- `GET /dashboard/products/:id/migration-assessment` — migration readiness page

### 2.2 Marketplace Intelligence Mode

**Migration `009_marketplace_intelligence.sql`:**
```sql
CREATE TABLE marketplace_metrics (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  supply_count INTEGER,              -- total active supply-side participants
  demand_count INTEGER,              -- total active demand-side participants
  match_rate REAL,                   -- % of demand requests that result in a match
  time_to_match_hours REAL,          -- average time from request to match
  supply_demand_ratio REAL,          -- supply / demand
  liquidity_score REAL,              -- composite 0-100
  disintermediation_risk REAL,       -- 0-100 based on repeat direct transactions
  supply_churn_rate REAL,            -- 30-day supply-side churn
  demand_churn_rate REAL,            -- 30-day demand-side churn
  take_rate REAL,                    -- effective commission rate
  gmv REAL,                          -- gross merchandise value
  net_revenue REAL,                  -- GMV * take_rate
  avg_transaction_value REAL,
  geographic_concentration REAL,     -- HHI of transactions by geography
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE marketplace_trust_audit (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  has_ratings INTEGER DEFAULT 0,
  has_identity_verification INTEGER DEFAULT 0,
  has_dispute_resolution INTEGER DEFAULT 0,
  has_payment_escrow INTEGER DEFAULT 0,
  has_quality_standards INTEGER DEFAULT 0,
  has_insurance_guarantee INTEGER DEFAULT 0,
  trust_score REAL,                  -- composite 0-100
  findings TEXT,                     -- JSON array
  audited_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/intelligence/marketplace.ts`:
- `computeLiquidityScore(productId)` — composite of match rate, time-to-match, supply/demand ratio
- `assessDisintermediationRisk(productId)` — based on repeat transaction patterns, value of ongoing relationship, availability of off-platform payment
- `modelCriticalMass(productId, geography?)` — minimum supply per geography/category for viable matching
- `computeMarketplaceHealth(productId)` — composite health score combining liquidity, trust, unit economics, and balance
- `identifyMarketplaceStressors(productId)` — marketplace-specific stressors: supply imbalance, liquidity collapse, trust incident, disintermediation spike, geographic concentration risk
- `auditTrustInfrastructure(productId)` — evaluate marketplace trust mechanisms

**Integration:**
- `intelligence/stressor.ts`: register marketplace stressor types
- `intelligence/risk-state.ts`: marketplace-aware risk calculation (liquidity collapse = immediate Yellow)
- `digest/generator.ts`: marketplace digest section with supply/demand health, liquidity trends, trust metrics
- `audit/scorer.ts`: when sector is `marketplace`, add trust infrastructure as part of D3 scoring

**Routes:**
- `POST /api/products/:id/marketplace-metrics` — report marketplace metrics
- `GET /dashboard/products/:id/marketplace` — marketplace intelligence dashboard
- `GET /api/products/:id/marketplace-health` — JSON health summary

### 2.3 Co-Founder Alignment Module

**Migration `010_cofounder_alignment.sql`:**
```sql
CREATE TABLE cofounder_profiles (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  founder_id TEXT NOT NULL,
  role TEXT,                         -- technical, business, domain, design, operations
  equity_percentage REAL,
  joined_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE cofounder_dna_responses (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  founder_id TEXT NOT NULL,
  dna_field TEXT NOT NULL,           -- same fields as product_dna
  response TEXT NOT NULL,
  responded_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, founder_id, dna_field)
);

CREATE TABLE cofounder_alignment_scores (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  score_date TEXT NOT NULL,
  overall_alignment REAL,            -- 0-100
  vision_alignment REAL,             -- ICP + positioning agreement
  priority_alignment REAL,           -- decision pattern agreement
  risk_alignment REAL,               -- risk tolerance agreement
  divergence_axis TEXT,              -- detected systematic disagreement pattern
  recommendations TEXT,              -- JSON array of alignment actions
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE cofounder_gate_agreements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  decision_category TEXT NOT NULL,
  gate_level INTEGER NOT NULL,       -- 0-4: what level of joint approval this category requires
  proposer_founder_id TEXT,          -- who can propose (null = either)
  requires_unanimous INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, decision_category)
);
```

**Service** — create `src/services/wisdom/cofounder.ts`:
- `getAlignmentScore(productId)` — compare each co-founder's DNA responses, compute divergence
- `detectDivergenceAxis(productId)` — analyze decision history to find systematic disagreement patterns (build-vs-sell, depth-vs-breadth, speed-vs-quality)
- `getDecisionAttribution(productId, dateRange)` — who proposed vs approved each decision, detect imbalance
- `generateAlignmentReport(productId)` — comprehensive alignment analysis for digest
- `checkGateAgreement(productId, decisionCategory)` — does this decision need co-founder approval?

**Integration:**
- `decisions/queue.ts`: enforce co-founder gate agreements on decision approval
- `digest/generator.ts`: include alignment trends if multi-founder product
- `wisdom/dna.ts`: support per-founder DNA responses alongside the product-level consensus
- Decision audit log: add `proposed_by` and `approved_by` fields

**Routes:**
- `GET /dashboard/products/:id/alignment` — alignment dashboard
- `POST /api/products/:id/cofounder-dna` — submit individual DNA responses
- `PUT /api/products/:id/gate-agreements` — configure co-founder gate agreements
- `GET /api/products/:id/alignment-score` — JSON alignment data

### 2.4 Global Founder Support

**Migration `011_global_support.sql`:**
```sql
ALTER TABLE founders ADD COLUMN country_code TEXT DEFAULT 'US';
ALTER TABLE founders ADD COLUMN local_currency TEXT DEFAULT 'USD';
ALTER TABLE founders ADD COLUMN ppp_factor REAL DEFAULT 1.0;

ALTER TABLE metric_snapshots ADD COLUMN local_currency_mrr REAL;
ALTER TABLE metric_snapshots ADD COLUMN exchange_rate REAL DEFAULT 1.0;

CREATE TABLE geopolitical_signals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,         -- regulatory_change, trade_restriction, political_shift, currency_crisis, sanctions
  severity TEXT DEFAULT 'medium',
  description TEXT NOT NULL,
  affected_markets TEXT,             -- JSON array of country codes
  source TEXT,
  detected_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'active'
);
```

**Service** — create `src/services/intelligence/global.ts`:
- `getPPPFactor(countryCode)` — returns purchasing power parity adjustment factor
- `adjustThresholds(thresholds, pppFactor)` — scale financial stressor thresholds by PPP
- `convertToReferenceCurrency(amount, localCurrency)` — USD conversion for comparison
- `detectCurrencyErosion(founderId)` — compare local currency MRR trend vs reference currency trend
- `scanGeopoliticalRisks(productId)` — use Claude Sonnet to scan for geopolitical signals affecting the product's markets
- `getTimezoneOptimalSchedule(founderTimezone, customerTimezones)` — recommend build/support/decide blocks based on timezone overlap

**Integration:**
- `intelligence/revenue.ts`: dual-currency MRR tracking, currency erosion stressor
- `intelligence/stressor.ts`: PPP-adjusted thresholds, geopolitical risk stressor type
- `digest/generator.ts`: timezone-optimized delivery, include currency health for non-USD founders
- `jobs/index.ts`: add `geopolitical_scan` weekly job (Sunday)

---

## TIER 3: Intelligence Deepening

### 3.1 Business Model Intelligence

**Migration `012_business_model.sql`:**
```sql
CREATE TABLE business_model_profile (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  revenue_model TEXT NOT NULL,       -- subscription, transaction, usage_based, marketplace_commission, freemium, open_core, grant_funded, hybrid
  avg_cogs_per_customer REAL,        -- monthly cost to serve one customer
  avg_cac REAL,                      -- customer acquisition cost
  cac_payback_months REAL,           -- computed
  contribution_margin REAL,          -- computed: (ARPU - COGS) / ARPU
  ltv_estimate REAL,                 -- computed from ARPU, margin, churn
  ltv_cac_ratio REAL,               -- computed
  pricing_to_value_ratio REAL,       -- estimated: annual price / annual value delivered
  is_seasonal INTEGER DEFAULT 0,
  seasonal_peak_months TEXT,         -- JSON array: [1, 2, 3, 4] for tax season
  seasonal_baseline_factor REAL,     -- off-peak metrics as fraction of peak
  services_revenue_percentage REAL,  -- what % of revenue is services vs product
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id)
);

CREATE TABLE unit_economics_snapshots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  arpu REAL,
  cogs_per_customer REAL,
  contribution_margin REAL,
  cac REAL,
  cac_payback_months REAL,
  ltv REAL,
  ltv_cac_ratio REAL,
  gross_margin REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/intelligence/business-model.ts`:
- `classifyRevenueModel(productId)` — auto-detect from metrics patterns
- `computeUnitEconomics(productId)` — calculate all unit economics metrics
- `assessPricingToValue(productId)` — using Product DNA (ICP pain, value prop) + revenue data, estimate if pricing captures fair share of value. Use Claude Sonnet for value estimation.
- `detectServicesDisguise(productId)` — flag when customization hours or services revenue dominate
- `seasonalNormalize(metrics, profile)` — adjust stressor thresholds for seasonal patterns
- `generateBusinessModelInsights(productId)` — Claude Opus analysis of business model health with recommendations
- `identifyBusinessModelStressors(productId)` — new stressor types: negative_unit_economics, cac_payback_excessive, services_masquerading, value_leakage, seasonal_distortion

**Integration:**
- `intelligence/stressor.ts`: register business model stressor types
- `intelligence/revenue.ts`: incorporate unit economics into MRR health
- `digest/generator.ts`: business model health section
- `audit/scorer.ts`: add business model health as context for D6 scoring
- Onboarding: business model questionnaire after product creation

### 3.2 Regulatory Intelligence Module

**Migration `013_regulatory_intelligence.sql`:**
```sql
CREATE TABLE regulatory_profile (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  jurisdictions TEXT,                -- JSON array of country/state codes
  regulatory_classifications TEXT,   -- JSON array: [{authority, classification, status, cost_estimate, timeline_months}]
  compliance_requirements TEXT,      -- JSON array: [{requirement, status: met/in_progress/not_started/not_applicable, deadline}]
  compliance_debt_score REAL,        -- 0-100: how much unmet compliance exists
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id)
);

CREATE TABLE regulatory_changes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  change_type TEXT NOT NULL,         -- new_regulation, amendment, enforcement_action, guidance, political_shift
  jurisdiction TEXT NOT NULL,
  description TEXT NOT NULL,
  impact_level TEXT DEFAULT 'medium', -- low, medium, high, critical
  effective_date TEXT,
  source TEXT,
  action_required TEXT,
  status TEXT DEFAULT 'active',
  detected_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/intelligence/regulatory.ts`:
- `classifyRegulatoryExposure(productId)` — based on sector, customer type, data handling, and geography, determine regulatory classifications. Use Claude Opus for analysis.
- `mapComplianceRequirements(productId)` — for each jurisdiction + classification, list requirements with cost/timeline
- `assessComplianceDebt(productId)` — score how much required compliance is unmet
- `scanRegulatoryChanges(productId)` — weekly Claude Sonnet scan for regulatory changes affecting the product's sector + jurisdictions
- `modelCompliancePathway(productId, requirement)` — model cost, timeline, and alternatives for a specific compliance requirement
- `identifyRegulatoryStressors(productId)` — stressor types: compliance_gap, regulatory_change, classification_ambiguity, political_risk

**Integration:**
- `intelligence/stressor.ts`: register regulatory stressor types (compliance_gap = critical severity by default)
- `digest/generator.ts`: regulatory section when compliance debt > 0
- `audit/scorer.ts`: regulatory context injected into D5 (Operational Readiness) scoring
- `jobs/index.ts`: add `regulatory_scan` weekly job

### 3.3 Competitive Intelligence 2.0

Extend existing `src/services/intelligence/competitive.ts`:

**Migration `014_competitive_v2.sql`:**
```sql
ALTER TABLE competitors ADD COLUMN platform_dependency_risk REAL;  -- 0-100
ALTER TABLE competitors ADD COLUMN incumbent_response_probability REAL;
ALTER TABLE competitors ADD COLUMN moat_erosion_rate REAL;         -- monthly % decline in technical advantage

CREATE TABLE switching_cost_analysis (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  cost_to_leave_us REAL,             -- estimated hours/dollars for customer to leave
  cost_to_leave_incumbent REAL,      -- estimated hours/dollars for customer to leave incumbent
  switching_cost_ratio REAL,         -- our lock-in / incumbent lock-in
  data_portability_score REAL,       -- 0-100: how easy is it to export data
  integration_depth_score REAL,      -- 0-100: how embedded is the product in customer workflow
  analyzed_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE competitive_signals ADD COLUMN market_structure_type TEXT;
-- Values: incumbent_response, platform_change, technology_shift, market_migration, free_tier_launch
```

**Service** — extend `src/services/intelligence/competitive.ts`:
- `modelIncumbentResponse(productId, competitorId)` — estimate probability, timeline, and form of competitive response from the incumbent
- `assessPlatformDependency(productId)` — scan for APIs, platforms, or services the product depends on that could change terms
- `assessTechnologyMoat(productId)` — evaluate how fast the technical advantage is eroding (foundation model improvements, open-source alternatives, incumbent R&D)
- `analyzeSwitchingCosts(productId)` — model costs for customers to switch to/from the product vs. competitors
- `detectMarketMigration(productId)` — identify when the customer segment itself is shifting (hotels → STRs, retail → e-commerce)
- `generateCompetitiveStrategyBrief(productId)` — Claude Opus deep competitive analysis

### 3.4 Value Delivery Index

**Migration `015_value_delivery.sql`:**
```sql
CREATE TABLE value_delivery_metrics (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  core_workflow_completion_rate REAL, -- % of users completing the core value action
  feature_utilization_breadth REAL,  -- % of features used by average user
  time_to_first_value_hours REAL,    -- hours from signup to first core value action
  outcome_achievement_rate REAL,     -- % of users achieving their stated goal (if tracked)
  engagement_depth_score REAL,       -- composite of session duration, frequency, feature depth
  value_delivery_index REAL,         -- composite 0-100
  nps_score REAL,                    -- if available
  support_ticket_rate REAL,          -- tickets per 100 users per month
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/intelligence/value-delivery.ts`:
- `computeValueDeliveryIndex(productId)` — composite score from engagement, outcomes, support load
- `assessTimeToFirstValue(productId)` — model the onboarding-to-value timeline
- `detectValueDecline(productId)` — identify downward trends in value delivery metrics
- `correlateValueToRetention(productId)` — model the relationship between VDI and churn
- `identifyValueDeliveryStressors(productId)` — stressor types: declining_engagement, slow_time_to_value, high_support_load, feature_underutilization

**Integration:**
- `intelligence/stressor.ts`: value delivery stressors
- `intelligence/risk-state.ts`: VDI decline adds to severity score
- `digest/generator.ts`: value delivery health section
- MRR health view: show VDI alongside revenue health for early churn warning

---

## TIER 4: Autonomous Mastery

### 4.1 Founder Psychology Engine

**Migration `016_founder_psychology.sql`:**
```sql
CREATE TABLE founder_psychology_insights (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL,        -- overcorrection, imposter_syndrome, perfectionism, empathy_scope_creep, isolation_drift, trauma_based, model_fixation
  description TEXT NOT NULL,
  confidence REAL,                   -- 0-1
  evidence TEXT,                     -- JSON array of supporting data points
  intervention_suggestion TEXT,
  surfaced_at TEXT DEFAULT (datetime('now')),
  acknowledged INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'       -- active, acknowledged, resolved, dismissed
);
```

**Service** — create `src/services/intelligence/psychology.ts`:
- `detectOvercorrection(founderId)` — for serial founders: compare current behavior against stated past failures. If behavior is extreme opposite, flag.
- `detectPerfectionism(productId)` — high commit frequency + low release frequency + long time since last deploy
- `detectEmpathyScopeCreep(productId)` — all feature decisions approved, no requests declined, roadmap is 100% user requests
- `detectIsolationDrift(founderId)` — declining login frequency, increasing decision response time, no community engagement (solo founders only)
- `detectImposterSignals(productId)` — underpricing relative to value, excessive disclaimers in copy, avoiding visibility/marketing
- `generatePsychologyInsights(founderId)` — Claude Opus analysis of founder behavior patterns, surfaced as gentle observations, never judgments
- All insights must be:
  - Non-judgmental in tone ("We notice a pattern..." not "You are...")
  - Actionable (include a specific suggestion)
  - Dismissable (founder can say "not relevant" and it won't resurface)
  - Private (never shared, never in cross-product patterns)

**Integration:**
- `digest/generator.ts`: optional psychology insight section (one insight per digest, max)
- `wisdom/patterns.ts`: psychology insights inform founder judgment pattern analysis
- `decisions/queue.ts`: annotate decisions with relevant psychology patterns (e.g., "You've approved 12 consecutive feature requests — is this one aligned with your positioning?")

### 4.2 Autonomous Market Expansion Advisor

**Migration `017_expansion_advisor.sql`:**
```sql
CREATE TABLE expansion_analysis (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  current_tam_estimate REAL,
  tam_penetration_rate REAL,
  years_to_saturation REAL,
  expansion_opportunities TEXT,      -- JSON array: [{market, tam_delta, feature_requirements, competitive_landscape, risk_level, time_to_revenue}]
  depth_vs_breadth_recommendation TEXT,
  strategic_fork_scenarios TEXT,     -- JSON: {depth: {projections}, breadth: {projections}}
  analyzed_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/intelligence/expansion.ts`:
- `estimateTAMCeiling(productId)` — estimate total addressable market from sector, geography, pricing
- `projectTAMSaturation(productId)` — at current growth rate, when does the product hit 20%/50%/80% of TAM?
- `identifyExpansionOpportunities(productId)` — use Product DNA + competitive landscape + feature utilization to identify adjacent markets
- `modelDepthVsBreadth(productId)` — run parallel scenarios: deeper in current market vs. broader to adjacent market
- `assessExpansionReadiness(productId)` — what % of the product is vertical-specific vs. transferable?
- `generateExpansionBrief(productId)` — Claude Opus strategic analysis with specific recommendations

**Integration:**
- `lifecycle/monitor.ts`: trigger expansion analysis when TAM penetration > 15%
- `digest/generator.ts`: expansion insight when relevant
- `decisions/queue.ts`: surface expansion as a Gate 3 decision when TAM saturation is approaching

### 4.3 Cross-Product Wisdom Network

**Migration `018_wisdom_network.sql`:**
```sql
ALTER TABLE founders ADD COLUMN wisdom_network_opted_in INTEGER DEFAULT 0;
ALTER TABLE founders ADD COLUMN wisdom_network_consent_date TEXT;

CREATE TABLE cross_product_insights (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  growth_stage TEXT NOT NULL,
  insight_type TEXT NOT NULL,        -- retention_tactic, pricing_strategy, acquisition_channel, churn_reduction, onboarding_pattern
  description TEXT NOT NULL,
  sample_size INTEGER NOT NULL,      -- number of products this insight is derived from
  confidence REAL,                   -- statistical confidence
  avg_impact REAL,                   -- measured impact (e.g., +15% retention)
  conditions TEXT,                   -- JSON: when this insight applies
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/wisdom/network.ts`:
- `aggregateInsights()` — weekly job: analyze anonymized decision patterns + outcomes across opted-in products, extract statistically significant insights by sector + stage
- `getRelevantInsights(productId)` — return insights applicable to this product's sector, stage, and current challenges
- `injectNetworkWisdom(context, productId)` — add relevant cross-product insights to any wisdom context
- `computeInsightConfidence(insight)` — statistical significance based on sample size and effect consistency
- Privacy guarantees: no individual product data ever surfaces. Minimum sample size of 10 products before any insight is generated.

**Integration:**
- `wisdom/dna.ts`: `buildWisdomContext()` includes relevant network insights
- `intelligence/scenario.ts`: network insights weight scenario projections
- `digest/generator.ts`: "From the network" section with relevant anonymized insights
- `jobs/index.ts`: extend `pattern_aggregation` job to generate cross-product insights

### 4.4 Ethical AI Assessment

**Migration `019_ethical_ai.sql`:**
```sql
CREATE TABLE ethical_assessment (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  has_ai_components INTEGER DEFAULT 0,
  demographic_fairness_score REAL,   -- 0-100
  consent_adequacy_score REAL,       -- 0-100
  minor_user_risk TEXT DEFAULT 'none', -- none, possible, confirmed
  claims_substantiation_score REAL,  -- 0-100
  surveillance_proportionality_score REAL, -- 0-100
  crisis_safety_score REAL,          -- 0-100: for products touching mental health, safety
  social_license_risk TEXT DEFAULT 'low', -- low, medium, high
  overall_ethics_score REAL,         -- composite 0-100
  findings TEXT,                     -- JSON array
  assessed_at TEXT DEFAULT (datetime('now'))
);
```

**Service** — create `src/services/audit/ethics.ts`:
- `assessEthicalDimensions(productId)` — comprehensive ethical evaluation using Claude Opus:
  - Analyze Product DNA + sector + feature description for ethical risk factors
  - Evaluate demographic fairness (does the product work across populations?)
  - Check minor user compliance (COPPA, GDPR-K triggers)
  - Assess claims substantiation (marketing vs. evidence)
  - Evaluate surveillance proportionality (data collection vs. value delivered)
  - Check crisis safety (for health/safety-adjacent products)
  - Assess social license (is this product category facing public trust challenges?)
- `generateEthicsFindings(assessment)` — actionable findings with severity and remediation
- `getEthicsRemediationPlan(productId, finding)` — specific remediation guidance

**Integration:**
- `audit/scorer.ts`: ethical assessment as supplementary dimension (not part of the core 10, but surfaced alongside)
- `audit/remediation.ts`: ethics-specific remediations
- `digest/generator.ts`: ethics alerts for high-severity findings
- `lifecycle/monitor.ts`: ethics assessment triggered at Prompt 1 completion

---

## Implementation Guidelines

1. **Every new table** must scope queries by `owner_id` for multi-tenancy. Use the existing helper patterns in `src/db/client.ts`.

2. **Every new service** must use the structured logger from the existing logger utility. No `console.log`.

3. **Every new stressor type** must be registered in `intelligence/stressor.ts` with severity defaults and integrate into the existing risk state calculation.

4. **Every new digest section** must be opt-in via founder preferences (add columns to `founders` table as needed).

5. **All AI calls** must use the existing `src/services/ai/client.ts` wrapper. Use Opus for strategic analysis, Sonnet for operational tasks.

6. **All new routes** must use Clerk auth middleware for authenticated routes. Follow the existing pattern in `src/routes/`.

7. **Run migrations in order** (004 through 019). Each migration should be idempotent. Put them in `src/db/migrations/`.

8. **Types must stay synchronized** — update `src/types/index.ts`, `src/types/database.ts`, and `src/types/api.ts` as you add tables and services.

9. **Test each tier** before moving to the next. The system should remain functional at every step.

10. **Wisdom injection pattern**: any new intelligence service that benefits from product context should call `buildWisdomContext(productId)` and include the result in AI prompts.

Begin by reading `mockups/founder-intelligence-report.md` fully, then read the existing schema at `src/db/schema.sql` and migrations, then start with Tier 1.
