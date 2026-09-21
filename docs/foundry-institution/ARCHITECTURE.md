# Institutional Architecture

## Canonical flow

```text
Reality
→ Evidence
→ Claim
→ Judgment
→ Decision
→ Authority
→ ActionPlan
→ Execution
→ ActionReceipt
→ Outcome
→ Learning
```

Each transition is explicit and traceable. A later object must reference the upstream basis that justified it. Missing knowledge is represented as unknown, not filled with confident narrative.

- **Reality:** conditions in the company or environment, whether observed or not.
- **Evidence:** provenance-bearing observations about reality.
- **Claim:** a bounded, challengeable interpretation of evidence.
- **Judgment:** an evaluated claim with uncertainty, alternatives, and consequence.
- **Decision:** a chosen course, including decide-not-to-act.
- **Authority:** owner policy granting a bounded actor permission; never inferred from skill or requested by the caller as a fact. Authority is one term of legitimacy, not the whole of it.
- **ActionPlan:** intended steps, controls, expected effects, and rollback/reconciliation plan.
- **Execution:** an attempt through one or more ControlPaths at the governed boundary.
- **ActionReceipt:** durable record of request, authorization, attempt, provider response, and effect certainty.
- **Outcome:** independently observed business effect, including failure, ambiguity, or no effect.
- **Learning:** calibrated update to company understanding, policy, routing, or strategy.

## The legitimate action envelope

Owner authority answers *may this actor do this?* It does not answer *may this
be done at all, to these people, here.* A consequential action is legitimate
only inside:

```text
demonstrated capability
∩ current owner/company authority
∩ sufficient evidence
∩ applicable external permission
∩ Foundry constitutional permission
∩ recorded constraints of affected parties
∩ proportionate safeguards and accountability
```

**This is not a policy engine and must not become one.** Most terms are already
structural and already enforced: capability by the shadow comparison required
before Assisting, authority by the consent ledger, evidence by
provenance-bearing claims and their freshness, constitutional permission by the
closed effect-kind vocabulary and the consequence boundary, safeguards by the
governed boundary's receipts, effect certainty and outcome reconciliation.

Two terms were absent, and they are the extension:

- **Recorded constraints of affected parties.** The governed execution boundary
  must be able to refuse on behalf of somebody who is not the owner. The
  boundary evaluates recorded constraints held by the person an effect reaches,
  at the point every effect converges — not in each caller, and not as a rule
  one department happens to remember. New constraint kinds are added as recorded
  facts, never as inferred ones.
- **Applicable external permission.** Foundry does not evaluate law. Where an
  action depends on one, the dependence is named, versioned and source-backed,
  or it is counsel debt in `OWNER_DECISIONS_PENDING.md`. A remembered legal
  conclusion is not a permission.

A term that cannot be evaluated is unknown. Unknown is not permission.

## Responsibility transfer

```text
Unknown → Visible → Understood → Shadowing → Assisting → Operating → Mature → Exception-owned
```

Promotion is responsibility-specific, evidence-based, revocable, and bounded by owner policy. Capability maturity alone cannot promote authority.

## Kernel and ControlPaths

The kernel owns semantic company objects, provenance, authority evaluation, execution convergence, receipts, reconciliation, outcomes, and learning. Provider APIs, browser automation, CLI, MCP, founder backends, humans, and physical workflows are replaceable ControlPaths. Provider-specific state must not become company truth.

Consequential mutations enter one governed execution boundary. That boundary obtains authority from trusted policy and server-side context, binds tenant and actor, applies idempotency and spend/safety constraints atomically where required, records the attempt, and classifies effect certainty. Timeouts and ambiguous provider responses become reconciliation work, never assumed success or safe retry.

## Deployment modes

One kernel serves both the commercial product and the owner's private
deployment. A mode may differ only in **permission friction** — what requires an
explicit human act. A mode may not differ in truth, provenance, company
boundaries, accountability, purpose limitation, or the evidence/action/receipt/
outcome distinction. A capability does not graduate from private use to
commercial exposure by working; it graduates on evidence, per
`PROOF_PROGRAM.md`.

## Company creation

Creating a company is an institutional progression, not a generator:

```text
founder intent → company hypothesis → evidence-backed customer, problem, offer
and economic hypotheses → minimum operating institution → instrumented market
surface → observed market evidence → first real customer or value → progressively
earned resources and responsibility
```

A generated company is represented as a **hypothesis** until reality says
otherwise. A landing page is a surface, not a result; shipping one is not
traction. Foundry may build the surface and must not supply the evidence.

## Migration and recursion

There is one canonical truth for each concept. Replacement follows shadow → compare → cutover → delete; dual-write is temporary, measured, and owned. Foundry operates itself using the same semantics as any company, while constitutional controls and consequential evaluations remain externally authorized and independently measured.

Post-V7 work is **Continuous Institutional Science**: operate, measure, benchmark, recalibrate, simplify, delete, and revise theory from evidence.

## Unfamiliar-company adoption

Foundry reconstructs rather than presumes company purpose, responsibilities,
people and systems, capabilities, dependencies, processes, evidence, risks,
economics, commitments, authority, ControlPaths, and open loops. Ontology is
admitted only when it changes a useful decision, control, execution, or proof.
AcreOS is the golden unfamiliar-company proving target; AcreOS-specific facts
belong in company data or configuration and never in kernel branches.

## Development and recursive operation

Software development is an institutional capability with the flow:

```text
problem/evidence → requirement → plan → implementation → tests → challenge
→ deployment/cutover → runtime observation → learning
```

It must serve arbitrary software companies, AcreOS, and Foundry itself through
the same semantics. Foundry may operate and improve Foundry, but constitutional
authority and consequential evaluation remain owner-controlled and independent.

## The public membrane (2026-09-09)

The Workshop is the smallest architecture that satisfies independent public
availability, strict public/private isolation, near-zero cost, simple automation
and verification, easy rollback and durable URLs: **one Cloudflare Worker
serving finished pages out of one KV store**, with the Workshop's own hostnames
attached to it.

- **Isolation is structural, not configured.** The public program contains no
  credential, no origin and no route to the private institution: a private path
  requested through the public hostname has nothing to reach and fails closed to
  a 404. Public and private share a repository and nothing else.
- **Pages are finished before they are stored.** Rendering happens privately,
  from rows, through the projection boundary; the edge does no templating and
  holds no state beyond the pages and the opt-outs people post.
- **The opt-out is the one thing the public plane writes.** It lands in the
  store, is copied onto the Workshop's do-not-contact list, and is then swept
  from the edge so nobody's address lingers where it need not.
- **Publication is idempotent by digest**, so the hourly pass costs nothing when
  nothing has changed, and a version history exists per address.
- No R2 and no Pages project: neither earns its place at this size.

`src/services/public-workshop/` holds the whole membrane — `settings` (the
identity), `identity` (an experiment's number, slug and public words),
`projection` (the allowlist boundary), `site` (pure rendering), `worker-source`
(the program, as text, so what runs can be compared with what was reviewed),
`publication` (the door, the verification and the quality gate), `suppression`
(one no, Workshop-wide), `infrastructure` (standing it up, sending, health) and
`rehearsal` (the machinery proving itself on a synthetic experiment).

## What the membrane carries, per asset (2026-09-21)

The membrane above says how the public plane is isolated. This says how much of
any one thing goes through it, which the owner clarified after the first two
assets turned out to sell in completely different ways.

**Three layers, and they are not the same thing.**

- **Private Foundry** is the economic intelligence and operating institution:
  code, research, finances, institutional memory, controls, portfolio
  machinery. It stays private. A customer needs no account of the software, the
  agents, the research process or the portfolio strategy behind an offer, unless
  a particular fact is material to the service itself.
- **Apex Micro** is the public business identity and the portfolio home —
  credible enough that somebody who meets an offer anywhere can find out who is
  responsible for it, and complete enough that somebody who meets Apex Micro can
  tell what it is associated with. It is **not** the purchasing or delivery
  platform for anything, and never was: payment has always been off-site, and
  the Worker serves finished pages only.
- **Individual assets** reach customers through whatever channel suits their
  actual economic mechanism. A template sold on Etsy is discovered, bought and
  delivered on Etsy.

**The presentation patterns are shapes, not stages.** `PublicShape` in
`public-workshop/how-it-should-show.ts` names five — not public, business
identity alone, a portfolio entry, a product page, its own presence — and
nothing progresses through them. An asset may sit at a portfolio entry for its
whole life and that is a complete answer, not an arrested one. There is no
ordering, no score and no comparison in that module, deliberately: the owner
asked for judgement, and a number invites the reader to move it instead of
argue with it.

**Two rules decide the hard cases, and both fail toward less exposure.**

- An owner's `never` on publishing is decisive and is never reasoned around. A
  clarification about product strategy does not lift a boundary he set by name;
  he is asked, and the answer is recorded before anything is built.
- Where the rows do not settle the channel, the reader says so and falls back to
  the smallest honest shape. The same direction `workshopFacts` takes with
  `replyRouteProven`: false unless shown.

**The floor is shape-independent.** Whatever depth is chosen, a published page
identifies the responsible business, reaches a person, and — where money changed
hands — reaches a remedy. `publicationGate` checks price, payment link, cadence
and sender authentication only for an offer the Workshop carries, because for an
entry every one of them is a category error; it checks the floor for everything.
Short is allowed. Silent about accountability is not.

**And the channel decides the shape, because the channel is what the customer
uses.** The reader takes the exposure's `provider` as the ground — the row
written when the offer was really placed — and the plan's declared `venue` only
as corroboration. Reading the declaration first was the first version and it was
wrong in the way this repository keeps correcting: the declaration is optional,
and the one asset that actually has a product page predates it.
