# Foundry — Data Processing Addendum (Template)

> **Status: template, not legally reviewed.** This document is the
> structure Foundry uses when a founder requests a DPA. Before sending
> to a customer, have it reviewed by counsel for your jurisdiction.
> The terms here are the working draft, not signed boilerplate.

> **Version:** 1.0 (2026-05-08)

---

## 1. Parties

This Data Processing Addendum ("DPA") is between:

- **Controller:** the customer (the founder or organization signing
  up for Foundry — referred to as "Customer").
- **Processor:** Foundry, the data processor operating the platform
  (referred to as "Foundry").

This DPA forms part of, and is subject to, the Foundry Terms of
Service available at https://foundry.app/terms ("Terms"). In the
event of any conflict between this DPA and the Terms, this DPA
prevails for personal data processing matters.

---

## 2. Definitions

Capitalized terms used but not defined here have the meanings given
in the GDPR (Regulation (EU) 2016/679) or the CCPA (Cal. Civ. Code
§ 1798.100 et seq.) as applicable.

- **Personal Data:** any information relating to an identified or
  identifiable natural person, processed by Foundry on behalf of the
  Customer.
- **Sub-processor:** a third-party processor engaged by Foundry to
  process Personal Data.
- **Data Subject:** the natural person to whom Personal Data relates.

---

## 3. Subject matter and duration

**Subject matter.** Foundry processes Personal Data submitted by the
Customer to the Foundry platform — specifically: founder account
information, product configuration, customer-of-the-Customer records
(when integrated via PostHog/Stripe/Intercom/Linear), and any other
data the Customer chooses to submit.

**Duration.** For the term of the Customer's subscription, plus a
30-day data retention period after termination during which Customer
may export data. After 30 days, all Personal Data is deleted from
Foundry's production systems within 60 days.

---

## 4. Nature, purpose, and types of Personal Data

**Nature and purpose of processing.** Foundry processes Personal Data
to provide the contracted services: AI-powered audit, business
intelligence, decision queue, and integration sync. Processing is
limited to the scope necessary to deliver the service.

**Types of Personal Data.** Generally:

- Account information (name, email, login credentials managed via
  Clerk).
- Product metadata (GitHub repository information, integration
  configuration).
- Customer records of the Customer (when integrations are connected).
- AI interaction logs (prompts and responses, retained for service
  quality only).

**Data subjects.** The Customer's founders, the Customer's customers
(when applicable through integrations), the Customer's employees
(when applicable on team accounts).

---

## 5. Foundry's obligations as Processor

Foundry will:

- Process Personal Data only on documented Customer instructions, as
  reflected in the Customer's use of the platform and the Terms.
- Ensure persons authorized to process Personal Data have committed
  to confidentiality.
- Implement appropriate technical and organizational measures (see
  §6).
- Engage sub-processors only with prior general authorization (see
  §7).
- Assist the Customer with Data Subject rights requests (see §8).
- Notify the Customer of Personal Data breaches without undue delay
  (see §9).
- Delete or return Personal Data at the Customer's choice on
  termination (see §10).
- Make available all information necessary to demonstrate compliance,
  and allow for audits (see §11).

---

## 6. Technical and organizational measures

Foundry's security measures include, at minimum:

- **Encryption at rest** using AES-256-GCM for sensitive credentials
  (GitHub access tokens, integration API keys).
- **Encryption in transit** via TLS 1.2+ for all external
  communications.
- **Access control** via Clerk-managed authentication; tenant
  isolation enforced at the application layer (every query scoped to
  `owner_id`).
- **Audit logging** of every autonomous agent action, decision
  approval/rejection, and outbound communication via the trust-
  boundary gateway.
- **Idempotency** on outbound actions to prevent duplicate
  customer-facing communications.
- **AI training disclosure:** Customer data is not used to train AI
  models; Anthropic API calls operate under no-training terms.
- **Backup and recovery:** automated database backups with
  documented restore procedures.
- **Incident response:** documented runbooks for AI-bill spikes,
  webhook backlogs, agent failures, and encryption-key rotation.

A detailed technical security overview is available at
https://foundry.app/security on request.

---

## 7. Sub-processors

The Customer authorizes Foundry to engage the following sub-processors:

| Sub-processor | Purpose | Location |
|---------------|---------|----------|
| Anthropic, PBC | AI model inference (Claude) | United States |
| Clerk Inc. | Authentication and user management | United States |
| Stripe, Inc. | Payment processing | United States |
| Turso (ChiselStrike, Inc.) | Database hosting (libSQL) | Multi-region; default United States |
| Resend | Transactional email delivery | United States |
| Fly.io (Hashicorp/Fly Inc.) | Application hosting | Multi-region; default United States |
| GitHub, Inc. | Repository analysis (when Customer connects a repo) | United States |

Foundry will give the Customer at least 30 days' prior notice of
any new sub-processor or any change to the list above, by emailing
the Customer's account email. The Customer may object to a new
sub-processor by terminating the Foundry subscription within 30
days of notice without further obligation.

---

## 8. Data Subject rights assistance

Foundry will assist the Customer with responding to Data Subject
rights requests under the GDPR (access, rectification, erasure,
restriction, portability, objection) within commercially reasonable
timeframes. Where the Customer has the technical means via the
Foundry UI to fulfill a request directly (e.g., account deletion via
Settings → Privacy), the Customer will use those means.

For requests requiring Foundry's direct involvement, contact
thomas@foundry.so with subject "Data Subject Request".

---

## 9. Personal Data breach notification

Foundry will notify the Customer without undue delay (and in any
event within 72 hours of becoming aware) of any Personal Data breach
affecting the Customer's data. Notification will include:

- The nature of the breach (categories and approximate number of
  Data Subjects and records affected).
- The likely consequences.
- Measures taken or proposed to address the breach.
- Foundry's point of contact for further information.

---

## 10. Return and deletion of Personal Data

On termination of the Foundry subscription:

- The Customer has 30 days to export Personal Data via the Foundry
  data export tools (Settings → Privacy → Data Export).
- After 30 days, Foundry will delete all Personal Data from production
  systems within 60 days.
- Anonymized, aggregated data with no Personal Data content (e.g.,
  cross-product `decision_patterns`) may be retained per §11 of the
  Privacy Policy.
- Backups containing Personal Data will be expired according to the
  backup retention schedule (currently 30 days), after which the data
  is irrecoverable.

---

## 11. Audits

Once per 12-month period, the Customer may request a security review
report (or comparable third-party assessment) by emailing
thomas@foundry.so. Foundry will provide the most recent available
report within 14 days. On-site audits are available to enterprise
customers on request and are subject to mutually agreed scope and
NDA.

---

## 12. International data transfers

Where Personal Data is transferred outside the EU/EEA, the transfer
is governed by the Standard Contractual Clauses (SCCs) approved by
the European Commission (Decision 2021/914), which the parties hereby
incorporate by reference. The Customer is the data exporter; Foundry
is the data importer.

---

## 13. Liability and term

Liability and term are governed by the underlying Terms. This DPA
takes effect on the Customer's acceptance and remains in force for
the duration of the Foundry subscription.

---

## 14. Signatures

For Customer:

Name:
Title:
Date:
Signature:

For Foundry:

Name: Thomas Norton
Title: Founder
Date:
Signature:

---

## Operator notes (not part of the customer-facing DPA)

- Have this reviewed by a privacy attorney before sending to a
  customer in production. The structure here is reasonable; the
  exact wording of §9 (breach), §11 (audit rights), and §12 (SCCs)
  often gets negotiated.
- Track signed DPAs in a `signed_dpas/` directory or a CRM record.
  GDPR audits will ask for the list.
- Update §7 (sub-processors) every time you add a new vendor that
  touches Personal Data. The 30-day notice obligation requires it.
