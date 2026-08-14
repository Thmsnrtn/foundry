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
- **Authority:** owner policy granting a bounded actor permission; never inferred from skill or requested by the caller as a fact.
- **ActionPlan:** intended steps, controls, expected effects, and rollback/reconciliation plan.
- **Execution:** an attempt through one or more ControlPaths at the governed boundary.
- **ActionReceipt:** durable record of request, authorization, attempt, provider response, and effect certainty.
- **Outcome:** independently observed business effect, including failure, ambiguity, or no effect.
- **Learning:** calibrated update to company understanding, policy, routing, or strategy.

## Responsibility transfer

```text
Unknown → Visible → Understood → Shadowing → Assisting → Operating → Mature → Exception-owned
```

Promotion is responsibility-specific, evidence-based, revocable, and bounded by owner policy. Capability maturity alone cannot promote authority.

## Kernel and ControlPaths

The kernel owns semantic company objects, provenance, authority evaluation, execution convergence, receipts, reconciliation, outcomes, and learning. Provider APIs, browser automation, CLI, MCP, founder backends, humans, and physical workflows are replaceable ControlPaths. Provider-specific state must not become company truth.

Consequential mutations enter one governed execution boundary. That boundary obtains authority from trusted policy and server-side context, binds tenant and actor, applies idempotency and spend/safety constraints atomically where required, records the attempt, and classifies effect certainty. Timeouts and ambiguous provider responses become reconciliation work, never assumed success or safe retry.

## Migration and recursion

There is one canonical truth for each concept. Replacement follows shadow → compare → cutover → delete; dual-write is temporary, measured, and owned. Foundry operates itself using the same semantics as any company, while constitutional controls and consequential evaluations remain externally authorized and independently measured.

Post-V7 work is **Continuous Institutional Science**: operate, measure, benchmark, recalibrate, simplify, delete, and revise theory from evidence.
