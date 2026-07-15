# Liability & Responsibility Audit — the clean-hands posture

**Date:** 2026-07-14 · **Lens:** legal/risk · **Author:** Claude (code-grounded)

> **NOT LEGAL ADVICE.** I am not a lawyer. This is a code-grounded engineering
> audit of Foundry's liability *surface* plus a proposed posture. The actual
> Terms/DPA language drafted here is marked DRAFT and must be reviewed by a
> licensed attorney before it ships. Treat this as the brief you hand counsel.

## The core distinction

Two ways to be in a transaction:
- **Principal** — you act; you're liable; if you move money you may be a
  regulated money transmitter (licensing, bonding, KYC, per-state).
- **Conduit / tool** — the *user* acts, through the *user's* own connected
  services, under the *user's* authorization; you're software they direct.

**Thomas's instinct is exactly right and achievable:** Foundry can be an
operating system users never leave WITHOUT being a principal — if every
consequential action is legally the user's, executed through the user's
credentials, and money never touches Foundry's hands. The good news from the
audit: Foundry is *already* structurally close to this. The work is (a) making
"clean hands" the enforced default in code, and (b) papering it properly.

## What the code actually does today (the facts)

| Surface | Live today? | Finding |
|---|---|---|
| **Foundry's own billing** (Stripe subscriptions for the $79/199/399 plans) | ✅ live | `services/billing/stripe.ts` — Foundry charging its OWN customers for its OWN product. Standard SaaS, low risk. Card data never stored (Stripe-hosted). |
| **Moving a USER's customers' money** (refunds, subscription changes) | ⚠️ **dormant** | `services/integration/stripe-gateway.ts` registers `stripe_create_refund` + `stripe_update_subscription`. **Zero callers** in the codebase. Uses Foundry's platform key. This is *latent* liability: the capability exists and is wired to the gateway, but nothing invokes it. |
| **Emailing a user's customers** (third-party sends) | ⚠️ **draft-only** | Department `send_email` actions (`executor.ts`) STORE DRAFTS — they do not send. Live email (`digest/delivery.ts`, `resend.ts`) goes to the FOUNDER only (Foundry emailing its own customer). No third-party blast path is live. |
| **AI business recommendations** | ✅ live | The product's core. ToS disclaims "not financial/legal/investment advice." Decent, but buried in ToS, not surfaced at the point of recommendation. |
| **Processing user's customer PII** | ✅ live | Metrics, customers, transcripts. Encrypted at rest (`encryption.ts`), consent tables (`privacy_consents`, mig 041), GDPR export/delete jobs, privacy policy. Foundry is a **data processor** — but there's no DPA and no published sub-processor list. |
| **Holding user credentials** (API keys, OAuth tokens, MCP bearers) | ✅ live | Encrypted at rest (AES-256-GCM). Breach liability exists but is mitigated + limited in ToS. |
| **Autonomous actions on user's behalf** | ✅ live (bounded) | Trust ladder (shadow→suggest→act), grants, envelopes, reserved powers, action verifier. This is a *strong* liability story — every act is user-authorized, bounded, reversible, audited. |
| **Terms enforceability** | ❌ **gap** | No clickwrap acceptance at signup. Terms exist at `/legal` but nothing records that a user agreed to a specific version. May not bind. |

## Ranked liability surfaces & the fix for each

### 1. Latent money-movement — HIGHEST (fix in code now)
`stripe-gateway.ts` can refund and change subscriptions. It's dormant, but a
registered, callable money-mover is pure downside for a product whose whole
thesis can be "we never touch your money." **Fix (shipped this commit):** the
money handlers refuse unless `FOUNDRY_ENABLE_MONEY_TOOLS=true` (default OFF),
returning a clear disabled result. Clean-hands-by-default; turning it on is a
deliberate, attorney-gated decision, not an accident. The reserved-powers list
already names refunds/pricing as never-delegable — this makes the *transport*
inert too, not just the autopilot path.

### 2. Never become sender-of-record — HIGH (architectural rule)
When departments graduate from drafts to live sends, third-party email must go
out under the USER's own connected sender identity (their domain, their Resend/
SendGrid, their opt-out footer, their CAN-SPAM/CASL responsibility) — NEVER
`Foundry <noreply@foundry.app>` to a stranger. Foundry's domain reputation and
anti-spam liability must never ride on a user's list quality. **Rule to
enforce when that path lights up:** a third-party send requires a
founder-connected sender; Foundry refuses to be the From.

### 3. Terms enforceability — HIGH (needs code + counsel)
Add clickwrap at signup: a required "I agree to the Terms and Privacy Policy"
checkbox, and record `(founder_id, tos_version, accepted_at)`. Unaccepted or
stale-version users re-prompt. Without this, the liability limitations below
may be unenforceable.

### 4. Data-processor papering — MEDIUM (needs counsel)
Publish (a) a **sub-processor list** — the audit engine already enumerates them
(`audit/engine.ts`: Stripe, Resend, Clerk, Turso, Anthropic) — and (b) a **DPA**
users can execute. Foundry is a processor of controller (user) data; GDPR Art.
28 wants this in writing. The technical controls (encryption, export, delete,
consent) already exist — this is paperwork catching up to the code.

### 5. AI-advice disclaimers at the point of use — MEDIUM (code)
Move the "not financial/legal/tax advice; outcomes are your responsibility"
disclaimer OUT of the buried ToS clause and TO the surfaces where advice is
given: the decision chamber, the Letter, /talk. A one-line persistent footer
("Foundry is software, not an adviser — you decide") is cheap and materially
strengthens the disclaimer's enforceability (the user saw it when they acted).

## The clean-hands architecture (the posture to commit to)

1. **Foundry is software the user directs — never a principal.** Codify in
   ToS: *"You are the actor. Foundry executes actions you authorize, through
   credentials you connect, as your disclosed agent. Foundry never takes
   custody of funds, is never merchant or lender of record, and is not a party
   to any transaction between you and your customers or counterparties."*
2. **Never in the flow of funds.** Money moves on the user's own connected
   rails, under the user's per-action authorization. Foundry proposes; the
   user (or the user's bounded, reversible, reserved-power-gated autonomous
   policy) disposes — through the user's own key. Foundry never holds, routes,
   or has custody of funds. This is the line between "software" and "money
   transmitter," and it must be architectural, not aspirational.
3. **Reserved powers are a legal boundary, not just a UX one.** Refunds,
   pricing, data deletion, legal acts never delegate at any trust level
   (`services/outbound/reserved.ts`) — and the money transport is disabled by
   default (this commit). The technical control and the legal claim agree.
4. **ProofReceipts as the evidence layer** (roadmapped from AcreOS,
   `ACREOS-PORT-MAP.md`): every autonomous action becomes a tamper-evident
   receipt — "executed on behalf of USER, under USER's authority, under grant
   X, under ToS version Y." This is the disclosed-agent paper trail that makes
   "the user acted, not us" *provable*, not merely asserted.
5. **Everything AS-IS, disclaimed, opt-in, capped.** See the DRAFT ToS below.

## DRAFT Terms strengthening — REQUIRES ATTORNEY REVIEW BEFORE SHIPPING

These are engineering-drafted starting points, not vetted legal text:

- **Nature of service:** "Foundry is a software tool. It is not a financial
  institution, money transmitter, payment processor, broker, adviser, or
  fiduciary. It does not take custody of funds and is not a party to
  transactions you conduct using it."
- **Agency:** "Actions Foundry performs are performed as your agent, at your
  direction, using credentials and connected services you provide. You are
  solely responsible for those actions and their consequences, including
  compliance with applicable law (e.g. CAN-SPAM, TCPA, GDPR, tax)."
- **No advice:** "Outputs are informational software output, not financial,
  legal, tax, or investment advice. No fiduciary relationship is created."
- **AS-IS / no warranty:** disclaim merchantability, fitness, accuracy of
  AI output, uninterrupted service.
- **Limitation of liability:** cap total liability at fees paid in the trailing
  12 months (or a small fixed sum); exclude indirect/consequential/lost-profit
  damages — to the extent permitted by law.
- **Indemnification:** user indemnifies Foundry for their use, their content,
  their connected-service actions, and their legal compliance.
- **AI-specific:** outputs may be inaccurate; user must review before relying;
  user is responsible for decisions made with them.
- **Data roles + DPA:** user is controller, Foundry is processor; incorporate a
  DPA by reference; publish sub-processors; notice on change.
- **Governing law, venue, arbitration, class-action waiver** (jurisdiction is
  Thomas's + counsel's call).
- **Clickwrap:** binding on affirmative acceptance at signup, versioned.

## What shipped with this audit (code)
- Money handlers disabled by default (`FOUNDRY_ENABLE_MONEY_TOOLS`, off) —
  latent money-movement neutered until a deliberate, papered decision.
- **Autonomy consent ledger** (mig 098) — granting `act` records a versioned
  disclosure acceptance; no autonomous act without live consent; per-action
  attribution trail. (Protective Wrapper.)
- **Platform cap** — money capabilities cap at shadow structurally; the
  operator ceiling no customer setting can exceed. (Protective Wrapper.)
- **In-product advice disclaimers** (2026-07-14) — `adviceFooter(fluency)`
  surfaced at the point of use (decision chamber, the Letter both branches,
  /talk). A disclaimer seen when the founder acts is far more enforceable than
  one buried in the Terms; it never forks silent (even technical fluency gets
  the terse legal line).
- **Sender-of-record guard** (2026-07-14, `services/outbound/sender-of-record.ts`)
  — `assertSenderOfRecord` structurally refuses a Foundry-domain From to a
  third party; the live third-party send path (when built) MUST call it, so
  Foundry never becomes sender-of-record on a founder's list. Foundry-domain
  From stays legal only for mail to the founder themselves (transactional).

## What needs Thomas + counsel (not code)
- Adopt the clean-hands posture as product policy.
- Attorney review + publish: strengthened ToS, DPA, sub-processor list.
- Then (code, fast): clickwrap terms acceptance record at signup, ProofReceipt
  hash-chains (the tamper-evident evidence layer), and wiring the
  sender-of-record guard at the live third-party send boundary when it exists.
