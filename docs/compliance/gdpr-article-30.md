# GDPR Article 30 -- Records of Processing Activities

**Controller:** Foundry Intelligence Platform
**Last updated:** 2026-04-16

---

## 1. Records of Processing Activities (Art. 30)

### 1.1 Founder PII

| Field | Detail |
|-------|--------|
| **Data categories** | Name, email address, Clerk user ID, Stripe customer ID, profile metadata |
| **Data subjects** | Founders (platform users) |
| **Processing purpose** | Account management, authentication, billing, in-app notifications |
| **Legal basis** | Art. 6(1)(b) -- performance of contract |
| **Retention** | Active account: retained for duration of service; Deleted account: 30 days then permanently purged |
| **Recipients** | Clerk (authentication), Stripe (billing), Resend (transactional email) |

### 1.2 Product Data

| Field | Detail |
|-------|--------|
| **Data categories** | Product names, descriptions, business metrics (MRR, churn, growth rates), operating plans, OKRs |
| **Data subjects** | Founders' businesses |
| **Processing purpose** | Business intelligence dashboards, trend analysis, agent-generated briefings |
| **Legal basis** | Art. 6(1)(b) -- performance of contract |
| **Retention** | Active account: retained; Deleted account: 30 days then purged |
| **Recipients** | Anthropic (AI analysis, not stored), Turso (database persistence) |

### 1.3 GitHub Code Analysis

| Field | Detail |
|-------|--------|
| **Data categories** | Repository metadata, commit history, PR summaries, code quality signals |
| **Data subjects** | Founders' development teams |
| **Processing purpose** | Engineering velocity monitoring, code health signals, SCP agent intelligence |
| **Legal basis** | Art. 6(1)(b) -- performance of contract (founder explicitly connects GitHub) |
| **Retention** | Active account: retained; Deleted account: 30 days then purged |
| **Recipients** | GitHub API (source), Anthropic (AI analysis), Turso (storage) |

### 1.4 Business Metrics

| Field | Detail |
|-------|--------|
| **Data categories** | Revenue figures, customer counts, growth rates, runway calculations, financial projections |
| **Data subjects** | Founders' businesses |
| **Processing purpose** | Trend analysis, risk detection, strategic recommendations |
| **Legal basis** | Art. 6(1)(b) -- performance of contract |
| **Retention** | Active account: retained; Deleted account: 30 days then purged |
| **Recipients** | Anthropic (AI analysis), Turso (storage) |

### 1.5 AI-Generated Insights

| Field | Detail |
|-------|--------|
| **Data categories** | Agent briefings, strategic recommendations, risk assessments, wisdom synthesis, competitive analysis |
| **Data subjects** | Derived from founder and product data |
| **Processing purpose** | Autonomous monitoring, decision support, cross-company pattern matching |
| **Legal basis** | Art. 6(1)(f) -- legitimate interest (providing platform value); Art. 6(1)(b) for individual founder insights |
| **Retention** | Active account: retained; Deleted account: 30 days then purged |
| **Recipients** | Turso (storage), founder (display) |

---

## 2. Processing Purposes Summary

| Purpose | Description | Legal Basis |
|---------|-------------|-------------|
| **Core service delivery** | Authentication, billing, dashboards, data storage | Art. 6(1)(b) -- contract performance |
| **Business intelligence** | Metric tracking, trend analysis, risk detection | Art. 6(1)(b) -- contract performance |
| **Autonomous monitoring** | SCP agents, Gate 0/1 analysis, scheduled briefings | Art. 6(1)(b) -- contract performance |
| **Cross-company pattern matching** | Cohort intelligence, ecosystem benchmarking | Art. 6(1)(f) -- legitimate interest |
| **Analytics and improvement** | Usage patterns, agent accuracy calibration | Art. 6(1)(f) -- legitimate interest |

---

## 3. Sub-processors

| Sub-processor | Purpose | Data Transferred | Location | DPA in Place |
|---------------|---------|-----------------|----------|--------------|
| **Anthropic** | AI inference (Claude) for agent runs, briefings, analysis | Product data, metrics, code signals (transient -- not stored by Anthropic) | United States | Yes |
| **Clerk** | Authentication and session management | Email, name, auth tokens | United States | Yes |
| **Stripe** | Payment processing and subscription management | Email, name, payment method (handled by Stripe) | United States | Yes |
| **Turso** | Database hosting (LibSQL) | All application data | United States (primary) | Yes |
| **Resend** | Transactional email delivery | Email address, notification content | United States | Yes |
| **GitHub** | Source code integration (user-initiated) | OAuth tokens (encrypted), repository metadata | United States | Yes |
| **Fly.io** | Application hosting and compute | All data in transit through application | United States | Yes |

---

## 4. Data Subject Rights

| Right | Implementation |
|-------|---------------|
| **Access (Art. 15)** | Settings > Privacy > Data Export -- generates full JSON export |
| **Rectification (Art. 16)** | Settings > Profile -- founder can edit all personal data |
| **Erasure (Art. 17)** | Settings > Privacy > Delete Account -- triggers cascade deletion within 30 days |
| **Portability (Art. 20)** | Settings > Privacy > Data Export -- machine-readable JSON |
| **Restriction (Art. 18)** | Contact support to pause processing |
| **Objection (Art. 21)** | Gate controls allow opting out of specific agent processing |

---

## 5. Retention and Deletion

| State | Retention | Deletion Method |
|-------|-----------|-----------------|
| Active account | Data retained for duration of service | N/A |
| Account deletion requested | 30-day grace period (reversible) | Automatic purge after 30 days |
| Post-deletion | Permanently purged | `founder:delete` CLI command cascade-deletes all products, agents, signals, notifications |

Anonymized/aggregated cohort data (no PII) may be retained for platform improvement after individual deletion.

---

## 6. Data Protection Impact Assessment (DPIA) Summary

### 6.1 Automated Decision-Making

Foundry employs automated decision-making through its Gate 0 and Gate 1 agent system:

- **Gate 0 agents** run autonomously on schedules (hourly/daily), analyzing business metrics, code activity, and market signals to produce briefings and risk assessments.
- **Gate 1 agents** run on founder request (AI Ask, strategic analysis) with explicit user interaction.

### 6.2 Risk Assessment

| Factor | Assessment |
|--------|-----------|
| **Nature of processing** | Automated profiling of business data with AI-generated recommendations |
| **Risk level** | **High** -- automated decision-making that could influence business strategy |
| **Mitigations** | Founder retains full control via gate controls; all recommendations are advisory, not binding; founder can disable any agent; all AI outputs include confidence indicators |

### 6.3 Founder Controls

- **Opt-out:** Founders can pause or disable SCP (Strategic Command Protocol) agents per product via dashboard.
- **Transparency:** Agent run history, cost logs, and reasoning are visible in the dashboard.
- **Override:** All AI recommendations are suggestions -- no automated actions are taken without founder approval (Gate 1 requires explicit trigger).
- **Deletion:** Full data deletion available via Settings > Privacy or CLI.

### 6.4 Conclusion

The automated processing is justified under Art. 6(1)(b) (contract performance) since founders explicitly subscribe to AI-powered business intelligence. The high-risk nature of automated analysis is mitigated by comprehensive founder controls, full transparency into agent reasoning, and the advisory (non-binding) nature of all AI outputs.

---

## 7. Security Measures (Art. 32)

- Encryption at rest: Turso encrypted storage; sensitive tokens encrypted with AES-256 (`ENCRYPTION_KEY`)
- Encryption in transit: TLS 1.2+ on all connections
- Authentication: Clerk-managed with JWT verification
- Authorization: Tenant isolation enforced at middleware level; founders can only access their own data
- Audit logging: All data access logged in `audit_log` table
- AI cost controls: Per-product daily ceiling prevents runaway processing
