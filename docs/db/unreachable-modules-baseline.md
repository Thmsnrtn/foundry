# The modules nothing imports

Classified 12 September 2026, after `integration/stripe-gateway.ts` was found
hiding here. That module registered four Stripe tool handlers when imported,
nothing imported it, and an owner-authorised experiment therefore could not
create its payment link for hours while every gate reported clean and the
hourly pass recorded success.

**The lesson is not "empty the baseline".** Twenty-one of these twenty-two were
genuinely dormant and harmless. One had a runtime purpose that only existed if
something loaded it. A list that cannot tell those apart is the problem, so
`check-reachability.mjs` now refuses to baseline any module that registers
handlers at import time, and the classification below is recorded so the rest
can be paid down deliberately rather than rediscovered during an outage.

## Fixed — side-effect registration that must be statically reachable

| Module | What it registers | Resolution |
|---|---|---|
| `services/integration/stripe-gateway.ts` | `stripe_create_payment_link`, `stripe_deactivate_payment_link`, `stripe_create_refund`, `stripe_update_subscription` | Imported for its side effect by `venture/payment-link.ts`, the module the hand actually calls. Gate now forbids this class being baselined; two planted-defect tests hold it. |

This was the only registrar among the twenty-two. Verified by scanning all
twenty-two for `registerToolHandler|registerJob|registerCapability|registerHandler`.

## Intentionally dormant — exercised by tests, not wired to a runtime entry point

Benchmarks and evaluations. They run under `vitest`, which is not one of the
three entry points the walker starts from, so they are correctly reported
unreachable from production. No runtime purpose; no registration.

`institution/development-benchmark.ts`, `institution/institutional-judgment-benchmark.ts`,
`institution/production-reachability-benchmark.ts`, `institution/reconstruction-benchmark.ts`,
`institution/responsibility-assisting-benchmark.ts`, `institution/responsibility-recognition-benchmark.ts`,
`institution/responsibility-shadowing-benchmark.ts`, `institution/responsibility-understanding-benchmark.ts`,
`institution/support-drafting-benchmark.ts`, `institution/support-pilot-readiness.ts`,
`intelligence/benchmarks.ts`

## Reached by a mechanism the walker cannot see

`mcp/cli.ts` — an entry point in its own right, invoked by the `mcp:context`,
`mcp:audit`, `mcp:issues` and `mcp:dna` npm scripts. It is not dead; it is a
fourth entry point that has never been declared as one.

**Debt:** declare it in `ENTRY_POINTS` so what it imports is walked too. Until
then anything reachable only from it is invisible to this gate.

## Unclassified debt — neither dormant-by-design nor known-broken

Each is referenced by tests but by no runtime caller. None registers anything,
so none can repeat the Stripe failure, but each needs a decision: wire, or
delete.

`ai/composer.ts`, `calibration/taste-journal.ts`, `distribution/briefing-share.ts`,
`financial/institutional-economics.ts`, `foundry/recursive-institution-contract.ts`,
`integrations/stripe-sync.ts`, `intelligence/shippability.ts`, `truth/engine.ts`,
`views/numbers.ts`

**Worth noting:** `integrations/stripe-sync.ts` sits in `integrations/` while the
gateway sits in `integration/`. Two directories one letter apart, both holding
Stripe code, one of them dead. That is a naming trap and should be resolved when
this debt is paid.

## What is not being done here

This list is not being emptied as part of a launch repair. Deleting or wiring
nine modules is its own piece of work with its own blast radius, and doing it
under time pressure is how the next defect gets in.

---

## The forty-eight that arrived on 13 September 2026

Deleting the seventy-two commercial route modules orphaned forty-eight
services: audit comparators, conversation intent, the fleet observatory,
investor automation and board packets, the intelligence family, network
matchmaking, the SCP memory and ROI trees, voice processing, the wisdom
cofounder. Nothing imports them now because the only things that ever did were
routes the owner could not reach.

**This is recorded debt, not a resolution.** The baseline went from twenty-one
to sixty-nine, and a bigger baseline is a worse number. It is here rather than
resolved because deleting a service is a different decision from deleting a
route: a route is a door that was never open, while a service may hold logic
worth keeping, and the two halves of the old system share files. Choosing
file by file is its own pass, named in `OWNER_OS_MIGRATION.md`.

What makes recording it safe rather than hiding it: none of the forty-eight
registers anything at import time, checked by scanning all sixty-nine for
`registerToolHandler|registerJob|registerCapability|registerHandler` after the
deletion. The gate refuses to baseline that class at all, which is the rule
that exists because `stripe-gateway.ts` once hid here while an authorised
experiment could not create its payment link.
