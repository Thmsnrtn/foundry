# Team Expansion Thesis

> Wave 4 / Council 20 (strategy theorists). The 300-persona review
> flagged: when an alpha founder hires their first employee mid-trial,
> Foundry's narrowness becomes a wall they hit. This document is the
> answer when that question arrives — not the build, the answer.

> Status: thesis, not roadmap. Build only after the wedge validates.

---

## 1. The shape of the problem

Foundry's current product is calibrated for a **single operator** —
one founder, one set of voice fingerprints, one decision queue, one
seat in Clerk per founder. The natural expansion arc:

| Stage | Operator count | What changes |
|-------|----------------|--------------|
| Wedge | 1 | The current product. |
| Co-founder | 2 | Two operators sharing one mental model. |
| Small team | 3-5 | Operating roles begin to specialize. |
| Growing team | 6-15 | Hiring outpaces operator-CEO bandwidth. |
| Scaled team | 15+ | Foundry is one tool of many; integrates rather than centralizes. |

Each stage is a different product question. This document covers
stages 2-4 — the realistic trajectory of an alpha-validated solo SaaS
founder over the next 18-24 months.

## 2. Three failure modes if we don't design for this

**Failure A — Identity theft.** Two co-founders share one Foundry
account. The voice fingerprint is mixed (one writer's terse, one's
verbose). The taste journal collapses (rejections from one founder
contradict approvals from the other). Agents drift toward incoherent
output.

**Failure B — Decision fragmentation.** The decision queue is one
ordered list. With three operators, each has their own priorities; a
queue ordered for the CEO buries the marketer's most-relevant decision
under the engineer's bug fix.

**Failure C — Audit-trail blindness.** A team makes 50 decisions a
week across 5 products. Without per-operator attribution, the
calibration data treats everything as one anonymous founder. The
compounding moat (per-founder calibration depth) inverts to noise.

These are the failure modes Foundry must answer before alpha founders
hire. The answer is **explicit team primitives**, not silent
multi-seat support.

## 3. The thesis

**Team primitives in Foundry are first-class scoping concepts, not
seat counts.** Specifically:

### 3.1 Operators (not just seats)

Foundry's current data model has `founders` (one row = one Clerk
user). The team-expansion model splits this:

- **Operator** — an individual person with credentials, a voice
  fingerprint, a decision queue, an inbox.
- **Account** — the billing/ownership entity that contains operators
  and products.
- **Membership** — operator's role within the account
  (owner / decider / observer).

A solo founder is one operator + one account + one self-membership.
A co-founder pair is two operators + one account + two memberships.
This composes upward without forcing the schema.

### 3.2 Per-operator calibration

The voice fingerprint and taste journal stay per-operator. A product
gets a *house voice* (the canonical voice fingerprint for what it
publishes) but each operator has *their voice* (used when they
personally draft something). Decisions surfaced to operator A are
filtered through operator A's preferences.

The compounding moat per-operator is the durable edge in the
multi-seat world. It's also what stops the calibration from
collapsing in Failure A.

### 3.3 Decision queue as a graph

The current decision queue is a flat list. The expansion: each
decision has a `proposed_assignee` (which operator should make this
call) computed at draft time based on (a) the agent's domain
(Beacon→marketer, Atlas→engineer), (b) the operator's role on the
account, (c) the operator's recent activity. The queue each operator
sees is filtered to "decisions you should make"; the others stay
visible but secondary.

This is the answer to Failure B.

### 3.4 Per-operator audit trail

`audit_log` and `briefing_decision_links` already attribute by
founder. The expansion: extend the trace context (`src/lib/trace.ts`)
to carry operator id alongside trace id. Every action propagates
operator attribution to the calibration data automatically.

This is the answer to Failure C.

## 4. What we explicitly don't build for stages 2-4

- **Permission systems.** RBAC exists in `src/middleware/rbac.ts` but
  is minimal. The thesis is small-team operators trust each other;
  hard permissions are a Stage-5 concern.
- **Custom workflows.** A team that needs custom approval chains
  (engineering manager approves before CTO sees it) is past where
  Foundry serves. That's the boundary with classic enterprise
  workflow tools.
- **Granular per-operator agent customization.** Each operator
  doesn't get a different Atlas. Atlas is the product's engineer;
  the operator's role in approval is what changes, not the agent's
  identity.

## 5. Pricing implications

Tier shapes shift with team size. This is illustrative, not
committed:

| Tier | Operator cap | Price |
|------|--------------|-------|
| Solo | 1 | $79/mo |
| Growth | 3 | $199/mo (current) |
| Investor-Ready | 5 + 5 products | $399/mo (current) |
| Studio (post-validation) | 10 operators + 10 products | $899/mo |

The Studio tier doesn't ship before alpha validates the wedge. It
exists in the thesis so we know where the natural ceiling sits and
so we don't accidentally undermine its economics with a free
multi-seat upgrade in earlier tiers.

## 6. What the alpha founders teach us

The thesis above is the prior. Three signals from alpha will refine
it:

- **At what month do alpha founders hire their first employee?**
  If 4-6 months, the team-expansion build is post-alpha. If 2-3
  months, it's during alpha.
- **What's the first multi-operator friction point?** Watch for
  alpha founders who add a teammate's email to their Clerk account
  (today this fails — single founder per account). The friction
  pattern tells us which primitive (operator? membership? assignee?)
  to ship first.
- **What do co-founders disagree about in the decision queue?**
  A co-founder pair using one Foundry account today will collide on
  decisions. The collision shape (who undid whose approval, who
  escalated to who) is the first calibration data for the
  per-operator decision-attribution model.

## 7. The shorter version

When an alpha founder hires their first employee, today's answer is
"add their email to your Clerk account" and it doesn't work
gracefully. The expansion thesis treats operators, accounts, and
memberships as first-class concepts; per-operator calibration; a
decision queue that knows which operator should make which call;
per-operator audit attribution. This is built only after alpha
validates the wedge — likely 6-9 months from now. The point of
documenting the thesis early is so each alpha-driven product
decision (e.g., a "share access with my dev" feature request)
defers to it, rather than introducing primitives that conflict.

— end —

## Operator notes

- This thesis is deliberately not in §A4 of the V3.1 build plan. The
  V3.1 plan is the wedge; this is the natural-expansion answer.
- Re-read after 4 alpha founders give feedback. Likely 50% of this
  is right; 30% will be wrong in directions we don't yet see; 20%
  will need to be rebuilt because alpha behavior surprised us.
- The single most important sentence: "Operators (not seats), per-
  operator calibration, decision queue as graph, per-operator audit
  trail." If any future product decision violates one of those four,
  it's worth at least the question "is this a thesis violation, or
  is the thesis wrong here?"
