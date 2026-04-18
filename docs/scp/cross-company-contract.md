# Foundry — Cross-Company Data-Flow Contract

Version: 1.0 | Date: 2026-04-17

## Principle

Foundry operates as a multi-company autonomous control plane. Each company (product) under management has its own SCP instance with 12 agents. Data isolation between companies is paramount — but cross-company intelligence is the product's moat. This contract specifies exactly what data crosses company boundaries, under what conditions, and with what consent.

## Data Classification

### Level 1: Strictly Isolated (Never Crosses Company Boundaries)
- GitHub access tokens and integration credentials
- Raw business metrics (MRR, churn rate, NPS, etc.)
- Customer names, emails, and PII
- Agent conversation history
- Decision details (what, why, options, outcomes)
- Audit findings and blocking issues
- Product DNA (ICP, positioning, voice, objections)
- Stressor details and risk state reasons
- Team member information
- Investor communications and board packets

### Level 2: Anonymized Cross-Company (Decision Patterns Pool)
- Decision type (e.g., "pricing_change", "feature_kill")
- Product lifecycle stage at decision time (no product name)
- Risk state at decision time
- Option chosen category (not specific option text)
- Outcome direction (positive/neutral/negative)
- Outcome magnitude (normalized 0-1)
- Outcome timeframe (days)
- Market category (broad, e.g., "b2b_saas")
- Scenario accuracy score

**What is NOT in Level 2:**
- Product ID, product name, founder ID, founder name
- Specific metric values
- Decision text or rationale
- Competitor names

### Level 3: Aggregated Fleet Intelligence (Founder's Own Companies Only)
When a founder has multiple companies (Growth/Investor-Ready tier):
- Cross-company MRR trends (their own companies only)
- Pattern matching: "Company A at this stage did X, Company B is at the same stage"
- Portfolio health scores (aggregate of their own companies)
- Risk correlation across their own companies

**Rule: Level 3 data NEVER crosses founder boundaries.** A founder can only see aggregate intelligence from their own companies.

### Level 4: Benchmarking Pool (Opt-In, Anonymized)
- Normalized metric percentiles by market category and stage
- Retention curve shapes (not absolute values)
- Growth rate distributions

**Consent required:** Founder must explicitly opt in via Settings → Privacy → Benchmarking.
**Revocation:** Founder can opt out at any time; their contributed data is removed from the pool within 24 hours.

## Consent Model

### Default State (New Account)
- Level 2 (Decision Patterns): **Opt-out by default** (GDPR-compliant)
- Level 3 (Fleet Intelligence): **Automatic for founder's own companies** (no third-party data)
- Level 4 (Benchmarking): **Opt-in required**

### Consent Collection Points
1. **Onboarding:** Clear explanation of cross-company intelligence with opt-in toggles
2. **Settings → Privacy:** Granular controls for each level
3. **First multi-company add:** Explanation of Level 3 fleet intelligence

### Consent Enforcement
- `hasConsent(founderId, level)` function must be called BEFORE any cross-company data write
- Decision pattern writes must check Level 2 consent
- Benchmark pool writes must check Level 4 consent
- Level 3 is implicit (founder's own data) and requires no additional consent

## Technical Enforcement

### Database Isolation
- Every table with company data has `product_id` column
- Every query in `db/client.ts` scopes by `owner_id` or `product_id`
- `decision_patterns` is the ONLY cross-company table (Level 2)
- Benchmark pool stored separately from per-company data

### Runtime Enforcement
- SCP agent execution: agents receive ONLY their product's context
- Fleet meta-agents: receive ONLY the founder's own companies' data (Level 3)
- Cross-company pattern queries: use `decision_patterns` table only, never raw company data
- Logging: product names and founder names are masked in shared log streams

### Audit Trail
- Every cross-company data write logged in `audit_log` with `action_type = 'cross_company_write'`
- Consent changes logged with before/after state
- Data deletion requests logged and tracked to completion

## De-Anonymization Risk Mitigation

The `decision_patterns` table could theoretically be de-anonymized in small cohorts:
- **Mitigation 1:** Require minimum 5 entries in any market_category+stage combination before querying
- **Mitigation 2:** Add Laplacian noise to `outcome_magnitude` values
- **Mitigation 3:** Do not include `contributing_factors` for cohorts smaller than 10
- **Mitigation 4:** Periodic review of pattern diversity metrics

## Fleet-Level Meta-Agents (Future)

When fleet-level meta-agents are implemented (Phase 6):
- **Fleet Oracle:** Reads Level 3 data only (founder's own companies)
- **Fleet Sentinel:** Monitors risk correlation across founder's own companies only
- **Pattern Extractor:** Reads Level 2 data (anonymized decision patterns) for insight generation
- **NO meta-agent may read Level 1 data from a company other than the one it's analyzing**
