# The Hands — Foundry's acting layer

> The brain and the conscience exist (Constitution Laws 1–9). This document
> designs the hands: how Foundry acts in the world on the founder's behalf,
> how the founder shapes those hands to fit exactly how THEY want to run their
> company, and how the whole thing stays simple enough that a first-time
> founder never feels the machinery.

## The thesis

Foundry today senses, judges, remembers, and reports — but nearly everything
it concludes exits the system through the founder's own hands. The founder is
the actuator; that is why they cannot be hands-off. The finished product
inverts this: **the founder supplies taste, vetoes, and relationships; Foundry
supplies execution** — within envelopes the founder sets, through connectors
the founder chooses, at trust levels each capability has earned.

Autonomy in a new domain is NEVER a new subsystem. It is a new **category**
flowing through the machinery that already exists: the trust ladder
(watch → suggest → act), the outbound gateway (idempotent, undoable, audited,
kill-switchable), premises that auto-falsify, the Red Team, and the Letter as
the single attention surface. That is what keeps scope growth from becoming
risk growth.

## Layer 1 — The Connector Fabric (shape your own hands)

The founder connects ANYTHING; Foundry treats every connection identically.

- **Any MCP server is a connector.** The founder pastes a URL (+ optional
  token); the server's tools become *reachable*. This ends the adapter
  treadmill: Foundry doesn't ship an integration per vendor — the ecosystem
  does. Typed built-ins (Stripe, GA4, GitHub, Slack, Resend…) remain as
  first-party connectors on the same integrations table.
- **Reach is never license.** Every callable tool needs a founder-issued
  **grant**: tool-scoped, call-capped, expiring, instantly revocable
  (`mcp_grants`, shipped in migration 091). No grant, no call — no exceptions,
  including for the operator.
- **Every call flows the gateway.** Kill-switch, idempotency dedup, audit
  trail. One place to watch, one button to stop everything.
- **Surface: `/connections`.** One page: what is connected, what Foundry may
  do with it (the grants), what it HAS done with it (the audit trail), and the
  controls to change any of that. Plain-fluency founders read "Foundry may
  send up to 50 emails a week through your Gmail"; technical founders read the
  grant row. Same facts.

## Layer 2 — Abilities and envelopes (bounded delegation)

A **grant** answers "may Foundry touch this tool at all?" An **envelope**
answers "how much, per week, without asking?" — dollars, sends, posts, PRs.
Envelopes are how humans delegate to humans; they compose with the trust
ladder: *trust raises what the autopilot may decide; envelopes bound the
blast radius of what it may do.* Standing orders (execution playbooks) gain
an `mcp_tool` action so any granted tool becomes usable in a founder-authored
rule: "when churn passes 8%, post to my Slack and pause the ad campaign via
the ads MCP."

**Reserved powers** (constitutional, never delegated at ANY trust level):
pricing floors, refunds above a founder-set threshold, brand-defining public
statements, anything with legal weight, deletion of data. The founder is a
board member with vetoes, not an operator.

## Layer 3 — The Departments (the loops that use the hands)

Each department is the same closed loop — sense → decide (with a premise) →
act through the gateway → measure → learn — pointed at one part of the
business. Each is a trust-ladder category; each consumes abilities from
Layer 1; each reports only through the Letter.

1. **Customer success** (build first — lowest risk, highest founder-hours
   saved): support triage, replies drafted from the customer's real account
   state, churn-risk saves, onboarding nudges.
2. **Marketing & content**: content thesis from Product DNA + real customer
   language → drafts → publish via connected channels → attribution →
   **every campaign is a decision with a premise** that auto-falsifies. The
   founder's edits to drafts are the taste-training signal.
3. **Product evolution**: signals → hypotheses that must cite the **Product
   Thesis** (a living document, like the Constitution, of who this is for and
   what we refuse to build) → Ghost simulates impact → Red Team argues
   against building → survivors ship behind flags via the existing
   remediation-PR machinery → measure, keep or revert.
4. **Outreach & acquisition** (build last — highest stakes): lookalikes of
   *actual best customers* (retained + expanded), honest personal drafts,
   founder-approved ICP and voice, hard caps, suppression lists, compliance
   baked in. Earns "act" slowest, on the same ladder as everything else.
5. **Revenue ops**: pricing experiments as gated decisions (Red Team
   mandatory), dunning recovery, expansion offers.

Cross-department causality lives in the memory graph: *that post → these
signups → this revenue → the churn from bad-fit users it attracted.* This is
the moat no point-tool has: marketing learns from product truth.

## Layer 4 — The operator side (Foundry runs Foundry)

The person operating Foundry-the-business gets the same machinery, not a
bespoke admin panel bolted on the side:

- **Dogfood**: Foundry is a product IN Foundry (`seed:dogfood`) — its MRR,
  churn, signups, and AI costs flow the same kernel; its operator reads the
  same Letter; its ops decisions carry premises like anyone's.
- `/founder-ops` (exists, operator-locked) remains the raw business console:
  pulse, MRR intelligence, churn, automation health, AI cost. It grows
  toward: support-inbox triage, cost-anomaly standing orders, and operator
  envelopes ("Foundry may auto-refund up to $X").
- The operator connects their own tools (Stripe, support inbox, status page)
  through the SAME `/connections` fabric.

## Layer 5 — Simplicity (the Jobs constraint)

The measure of this entire system is that it gets SIMPLER to use as it gets
more capable. Concretely:

- **Five doors.** The sidebar leads with what a founder actually does:
  **Today** (the Letter — the front door), **Signal**, **Decide**, **Talk**,
  **Actions**. Everything else lives in collapsed groups (Autopilot, Your
  Team, Company, Investor, System) that open on demand and remember where you
  are. Nothing is removed — the Fluency Law forbids forking the product —
  but nothing shouts.
- **One attention surface.** Departments never add dashboards. They add
  Letter lines.
- **Progressive disclosure everywhere**: ⌘K reaches everything; explainer
  strips (fluency-dialed) orient every page; the dial in Settings tunes
  voice, never features.
- **Sane defaults, visible seams.** Every founder gets working defaults with
  zero configuration; every default is inspectable and changeable on the page
  where it acts. Tailoring is optional, never required.

## Sequencing

- ✅ **H1**: `/connections` surface (add server → grant → audit trail →
  revoke), `mcp_tool` standing-order action, sidebar v2 (five doors +
  collapsed groups), Law 10.
- ✅ **H2**: envelopes (per-scope weekly caps inside the governed path),
  reserved-powers registry, customer-success department on the trust ladder.
- ✅ **H3**: marketing department — campaigns as decisions with GRACED
  signups premises (kernel `effective_at`); channels die on the record via
  the existing daily premise check. Briefs ground only in real DNA.
- ✅ **H4**: product-evolution department — the thesis IS the DNA
  (positioning + what-we-are-not); hypotheses derive from crossed metric
  lines, cite the thesis, and land at gate 3 so the existing Red Team sweep
  contests every feature bet automatically.
- ✅ **H5 (v1)**: outreach department — referral engine grounded in real
  champions; suppression list beats every mode; no auto-send at any trust
  level, on purpose. Cold prospecting stays gated on a founder-connected
  prospecting tool + an earned record here.

### Operator rulings (2026-07-13, founder picker)
- **Outreach ceiling: referral-only for now.** Cold prospecting stays out
  until design partners exist; revisit is a founder decision, not a trigger.
- **Fleet slice (Option B): built** — cross-company insight reader
  (`services/fleet/insights.ts` → /portfolio card) + FleetObservatory.
  All other fleet specs defer to the 3-paying-founders trigger.

### Still open (the arc's next turns)
- Taste-feedback loop: founder edits to drafts as training signal.
- Hypothesis → remediation-PR machinery (build behind a flag on approval).
- Cold outreach v2 — blocked on an explicit founder ruling change (see above).
- Operator envelopes + dogfood standing orders on the operator's own product.
- Live wiring: departments publishing through real connected channels
  (needs the staging deploy from GO-LIVE §1).

## The bar

A founder should be able to say: *"Foundry, here are my tools, here are my
limits, here is my taste — run the company and write me a letter."* And the
operator of Foundry itself should be able to say the same sentence about
Foundry.
