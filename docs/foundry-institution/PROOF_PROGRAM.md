# Proof Program

## Evidence maturity

- **E0 Hypothesis:** asserted but unimplemented or unobserved.
- **E1 Static implemented:** code or policy exists; runtime behavior is unverified.
- **E2 Runtime verified:** deterministic/local or deployed runtime evidence confirms behavior.
- **E3 Benchmark proven:** independent or frozen benchmark demonstrates superiority or sufficiency.
- **E4 Pilot proven:** bounded real-company use demonstrates value and safety.
- **E5 Production proven:** sustained production outcomes support the claim.
- **E6 Broad institutional evidence:** repeated evidence across unfamiliar companies and conditions.

## Capability graduation

Evidence maturity governs what a capability may be exposed to, not merely how
sure we are of it:

```text
research capability → private owner-controlled operation → real evidence
→ bounded design partner / pilot → commercial responsibility → broader maturity
```

**Capabilities do not graduate by working.** A capability operating well in the
owner's private deployment has E2 or E3 evidence about the owner's own
companies; commercial exposure is a claim about companies Foundry has never
seen. The private deployment is where advanced capability earns evidence before
generalised commercial exposure — that is its institutional purpose, not a
licence to skip the ladder.

A commercial customer cannot purchase maturity Foundry has not earned. The
product must not be optimised to *look* maximally autonomous; sell bounded,
demonstrably competent responsibility.

**Counsel debt** is a distinct kind of proof debt: a conclusion software cannot
responsibly draw. It is recorded in `OWNER_DECISIONS_PENDING.md` with the
question, what depends on it, and what Foundry does meanwhile — never guessed
and never quietly resolved by a model's recollection of law.

**Proof debt** means: “We built this, but we do not yet know whether it deserves to exist.” It is recorded, owned, and retired by comparison or deletion—not hidden by implementation volume.

## Slice discipline

```text
Baseline → Contract → Build → Challenge → Compare → Observe → Decide → Cutover → Delete → Promote evidence maturity
```

Every meaningful slice records:

- verified baseline and commit;
- governing requirement;
- smallest complete implementation;
- normal, failure, security, and adversarial tests;
- simpler-baseline comparison where relevant;
- economics where relevant;
- evidence maturity and remaining proof debt;
- shadow/compare/cutover/delete state;
- legacy deletion opportunity.

A test proves only its stated boundary. Static inspection is E1; deterministic runtime tests may reach E2; neither proves business outcome. Evaluation of consequential self-improvement uses independent or frozen benchmarks and cannot be rewritten by the subject under evaluation.
