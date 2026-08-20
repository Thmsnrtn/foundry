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
