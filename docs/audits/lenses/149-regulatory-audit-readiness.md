# Lens 149 — Regulatory Audit Readiness

**Distinct value:** Evaluates Foundry's readiness for a GDPR regulatory audit: Article 30 records of processing activities, data protection impact assessment (DPIA), lawful basis for each processing activity, data subject rights implementation, and documentation that would be required if a Data Protection Authority requested evidence of compliance.

**Tenancy-critical:** Yes. GDPR applies per data subject (founder). Each founder's data must be processable, exportable, and deletable independently. Cross-tenant data flows (anonymized decision patterns, benchmarking pool) require specific lawful basis documentation.

## Executive Summary

Foundry processes personal data and business-sensitive data for SaaS founders. It has built a privacy consent system (`src/services/privacy/consent.ts`), a data export feature, a deletion scheduling mechanism, and a privacy settings page. These are functional building blocks. However, the regulatory documentation layer is entirely absent: there are no Article 30 records, no DPIA, no lawful basis mapping, no data processing agreement template, no privacy impact assessment for the AI processing, and no documentation of data flows to sub-processors (Anthropic, Clerk, Stripe, Turso, Resend, GitHub). A DPA inquiry would find working consent mechanisms but zero compliance documentation.

## GDPR Article 30 — Records of Processing Activities

Article 30 requires the controller to maintain records of all processing activities. Foundry processes data across multiple categories but has no records document.

### Processing Activities Identified in Codebase

| Activity | Data Subjects | Data Categories | Purpose | Lawful Basis (needed) | Documented? |
|----------|--------------|----------------|---------|----------------------|-------------|
| Account creation | Founders | Name, email, Clerk user ID | Service delivery | Contract (Art. 6(1)(b)) | No |
| GitHub OAuth | Founders | GitHub username, access token, repo access | Code audit | Consent (Art. 6(1)(a)) | No |
| Metric ingestion | Founders + their customers (aggregated) | MRR, churn, retention, NPS, support volume | Business intelligence | Contract | No |
| AI analysis (Claude) | Founders | Business metrics, code, competitive data | SCP agent intelligence | Legitimate interest (Art. 6(1)(f)) | No |
| Billing | Founders | Payment method metadata (via Stripe) | Payment processing | Contract | No |
| Email delivery | Founders | Email address, digest content | Communication | Contract | No |
| Competitive scanning | Third parties (competitors) | Public company information | Market intelligence | Legitimate interest | No |
| Anonymized benchmarking | Founders (anonymized) | Aggregated metrics | Cross-product insights | Consent (opt-in) | Partially (consent toggle exists) |
| Push notifications | Founders | Device tokens (APNS) | Mobile alerts | Consent | No |
| Customer data processing | Founders' customers (indirect) | Segment, MRR, lifecycle, channel | Customer intelligence | Legitimate interest (processor role) | No |
| Journal entries | Founders | Personal reflections, wellbeing data | Founder support | Consent | No |
| Agent audit logging | Founders | All SCP agent activities | Transparency, debugging | Legitimate interest | No |

**Status: Zero of 12 processing activities have Article 30 records.**

### Sub-Processor Register (Required by Article 30(1)(d))

Foundry shares personal data with these sub-processors:

| Sub-Processor | Data Shared | Purpose | DPA in Place? |
|---------------|-------------|---------|---------------|
| Anthropic (Claude) | Founder's business data, code, metrics | AI analysis | **Unknown/No** |
| Clerk | Name, email, auth tokens | Authentication | **Unknown/No** |
| Stripe | Email, payment data | Billing | **Unknown/No** |
| Turso | All database content | Data storage | **Unknown/No** |
| Resend | Email addresses, digest content | Email delivery | **Unknown/No** |
| GitHub | OAuth tokens, repo access | Code audit | **Unknown/No** |
| Fly.io | Application data in transit/memory | Hosting | **Unknown/No** |
| Apple (APNS) | Device tokens | Push notifications | **Unknown/No** |

**Status: Zero Data Processing Agreements documented. No sub-processor register exists.**

## Data Protection Impact Assessment (DPIA)

A DPIA is required under Article 35 when processing is "likely to result in a high risk to the rights and freedoms of natural persons." Foundry's processing includes:

| DPIA Trigger | Applies? | Reason |
|-------------|----------|--------|
| Automated decision-making (Art. 35(3)(a)) | **Yes** | SCP agents make autonomous decisions (Gate 0/1) about the founder's business |
| Systematic monitoring (Art. 35(3)(b)) | **Yes** | Continuous MRR tracking, behavioral trigger emails, risk state monitoring |
| Large-scale processing of sensitive data (Art. 35(3)(c)) | **Possibly** | Financial data (MRR, revenue), business strategy data |
| New technology (Recital 91) | **Yes** | AI-powered autonomous agents with evolution capabilities |

**Status: No DPIA exists. At least 3 of 4 triggers apply. A DPIA is legally required.**

### What the DPIA Must Cover

1. **AI agent autonomous actions:** Gate 0 actions are taken without human approval. What is the impact if an agent takes a wrong action? What safeguards exist? (The Gate system is a safeguard, but it is not documented as such in a DPIA context.)
2. **Risk state classification:** Classifying a business as "Red" state triggers behavioral changes (Gate suspension, daily briefings, recovery protocols). This is automated profiling of the founder's business health.
3. **Competitive intelligence:** Scanning public data about third-party companies and presenting it as intelligence. While public data, the systematic collection and AI analysis creates profiles that the subjects (competitors) are unaware of.
4. **Anonymized benchmarking pool:** Opt-in data sharing. The anonymization must be verifiable. Can the data be re-identified? The `decision_patterns` table has no `product_id` or `founder_id`, which is good, but the descriptions may contain identifying information.

## Data Subject Rights Implementation

| Right | Article | Implemented? | Evidence |
|-------|---------|-------------|----------|
| Right of access (Art. 15) | Art. 15 | **Partial** | Export exists but is incomplete (see Lens 148) |
| Right to rectification (Art. 16) | Art. 16 | **Partial** | Founders can edit some data (DNA, settings) but not all (audit scores, agent outputs) |
| Right to erasure (Art. 17) | Art. 17 | **Partial** | Deletion scheduling exists but is fire-and-forget with no verification (see Lens 144) |
| Right to restriction of processing (Art. 18) | Art. 18 | **No** | No mechanism to restrict processing while retaining data |
| Right to data portability (Art. 20) | Art. 20 | **Partial** | JSON export exists but incomplete and per-product only |
| Right to object (Art. 21) | Art. 21 | **Partial** | Consent toggles exist for benchmarking and analytics |
| Automated decision-making (Art. 22) | Art. 22 | **No** | No mechanism to request human review of automated decisions. Gate 0/1 actions have no opt-out. |

### Critical Gap: Article 22 — Automated Decision-Making

GDPR Article 22 gives data subjects the right "not to be subject to a decision based solely on automated processing ... which produces legal effects concerning him or her or similarly significantly affects him or her."

Foundry's SCP agents make Gate 0 (fully autonomous) and Gate 1 (notify and proceed) decisions that directly affect the founder's business. Examples:
- Behavioral trigger emails to the founder's customers
- Stressor identification that changes the risk state
- Critical support routing decisions

These are automated decisions that "significantly affect" the data subject. Under Article 22(3), the founder must be able to:
1. Obtain human intervention
2. Express their point of view
3. Contest the decision

The Gate system partially addresses this (Gate 2+ requires human approval), but Gate 0 and Gate 1 actions have no human intervention mechanism by design. There is no opt-out from automated decision-making.

## Privacy Policy Assessment

The privacy policy at `src/routes/public/landing.ts:257-310` covers:
- What data is collected (basic list)
- AI processing disclosure
- Third-party services mention (not all listed)
- Data retention statement
- Export and deletion rights
- Contact email (privacy@foundry.so)

**Missing from privacy policy:**
- Lawful basis for each processing activity
- Complete list of sub-processors with purposes
- International data transfer mechanisms (Anthropic, Turso, etc. may process data outside EU)
- Automated decision-making disclosure (required by Art. 13(2)(f))
- Right to lodge a complaint with supervisory authority (required by Art. 13(2)(d))
- Data retention periods per category
- Cookie/tracking disclosure

## Findings Summary

| # | Finding | Severity | Description |
|---|---------|----------|-------------|
| 1 | No Article 30 records of processing | P0 | Legally required; zero documentation exists |
| 2 | No DPIA | P0 | At least 3 of 4 triggers apply; legally required for AI-based autonomous processing |
| 3 | No sub-processor register | P1 | 8 sub-processors handle personal data with no documented DPAs |
| 4 | Article 22 automated decision-making not addressed | P1 | Gate 0/1 autonomous actions have no opt-out mechanism |
| 5 | Incomplete privacy policy | P1 | Missing lawful basis, sub-processors, international transfers, automated decision disclosure |
| 6 | No data processing agreement template | P1 | Required for B2B customers who are themselves controllers |
| 7 | Data export incomplete | P1 | Does not satisfy Article 15 or 20 (see Lens 148) |
| 8 | No right to restriction of processing | P2 | Article 18 not implemented |
| 9 | Anonymized benchmarking re-identification risk unassessed | P2 | Decision patterns may contain identifying descriptions |
| 10 | No international data transfer documentation | P2 | Data likely transferred to US-based sub-processors |

## Priority Remediation

1. **P0:** Create Article 30 Records of Processing document (`docs/compliance/processing-records.md`) mapping all 12+ processing activities with lawful basis, data categories, retention periods, and sub-processors
2. **P0:** Conduct and document a DPIA for AI agent autonomous processing
3. **P1:** Create sub-processor register and verify DPAs are in place with all 8 sub-processors
4. **P1:** Add Article 22 compliance: mechanism for founders to opt out of Gate 0/1 autonomous actions, require human review
5. **P1:** Update privacy policy to include lawful basis, complete sub-processor list, international transfers, automated decision disclosure, and supervisory authority complaint right
6. **P2:** Implement right to restriction of processing (freeze account without deletion)
7. **P2:** Assess re-identification risk of anonymized decision patterns
