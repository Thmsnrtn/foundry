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

## First Economic Closure profile (proof-program policy, not law)

The first origination proof is deliberately small. Until an unmatched external
counterparty has paid for something the institution found, tested, built and
delivered, the venture frontier is biased toward opportunities with low
downside, low legal surface, low owner attention, simple architecture, minimal
recurring cost, minimal support and fast falsification. The objective of the
bias is maximum institutional learning per dollar, per owner minute and per unit
of downside.

**This is policy.** It lives in `origination_policy`: institutional default rows
carry `founder_id NULL` and `set_by = 'proof_program:first_economic_closure'`
with a `why` on every row, and a row of the owner's for the same requirement
outranks the default from then on. Superseding a row is one owner act
(`supersedeOriginationPolicy`); the default is never edited. It is not the
constitution: a mature Private Foundry may rationally originate subscription
products, marketplaces, larger businesses or acquisitions when evidence and
economics justify them, and nothing in this profile may make it structurally
incapable of doing so. What is permanent is the one sentence in
`CONSTITUTION.md` § *The river of nickels*: prefer the lightest architecture that
achieves the owner objective at acceptable risk.

**Recognition is not certification.** The legal pass (`legal-pass.ts`) recognises
which exposure classes a record gives grounds to name, quoting the words it
rests on and dropping any recognition whose grounds are not in the record;
grades severity in context; records what it could not resolve as
`unresolved_internally`, which blocks under this profile exactly as a serious
surface does; and records structural facts as unknown when the record cannot
answer them. Four floors are durable and constitutional (`exposure_floors`):
custody of money, a regulated decision, professional reliance, and a decision
about a named person are always serious and always need a qualified person.
Everything else — personal data, recurring billing, cross-border selling, user
content and the rest — is recognised permanently and graded in context. The
strongest positive sentence the pass can produce is "No currently recognised
material legal surface requires professional review. That is recognition, not
certification." It never says legal risk is low.

**What the profile may do:** refuse or penalise, at the legal pass, recurring
billing, persistent personal data, cross-border selling, support obligations,
manual fulfilment, user content, account systems and two-sided marketplaces;
prefer one-visit delivery (arrive, understand, pay, receive); require a
front-loaded attention curve; block on unresolved material uncertainty; and
retire an experimental asset whose valid test failed with no re-run proposed
within the grace the policy names (`failed_test_grace_days`, thirty today). At
candidate level an unknown structural fact is a verdict and does not block,
because the offer has no shape yet; once an offer shape is stated the pass runs
again at asset level and an unknown binding fact stands in the way.

**What it may not do:** lower the promotion bar; create a candidate because a
proof wants one; treat unknown as satisfied; or be read as a statement about
what Private Foundry is allowed to own.

**Measurement failure is not market failure.** An experiment's validity is a
separate axis from its verdict. Only a measurement-critical execution act —
declared when the plan is sealed, immutable after the test is decided —
resolved `surprised` can invalidate the market inference; an incidental
surprise beside a disappointing result changes nothing, and every operational
prediction settles on its own. An invalid test has no verdict and is re-run
without touching the claim; a valid contradiction may be re-run only after the
claim has been revised.

**The milestone it exists to reach**, stated as what the evidence can support: a
real-mode provider reported a payment whose payer reference matched no identity
the owner registered as his own, internal or a test account
(`counterparty = 'unmatched_external'`; no further identity is collected to
find out more), at a genuine experiment exposure, followed by the delivery
event, with the prediction settled by `business_outcome` under the rule sealed
at approval. The sentence on the first screen is bounded to that: an unmatched
external counterparty, not a proven stranger; an asset that exists, not a
business. Anything less reads as what it is — a payment observed, or nothing
yet — and is not the milestone.

NOTHING DESERVES TESTING remains a successful outcome of the programme.
