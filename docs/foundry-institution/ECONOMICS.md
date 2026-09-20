# Institutional Economics

Optimize the maximum **defensible company value** per unit of money, computation, time, attention, and risk, subject to safety, quality, owner policy, legal duties, and contractual constraints.

Optimization is subordinate to legitimacy. Profit, conversion, retention, labour
reduction and engagement do not make deceptive, discriminatory or exploitative
conduct a successful outcome, and a metric that improves through such conduct
has not improved. When an optimization and the legitimacy envelope disagree, the
envelope wins and the conflict is recorded rather than resolved quietly.

The tier covenant is: **a plan changes how much Foundry can carry, not whether
Foundry attempts to carry responsibilities intelligently.** Safety, epistemic
honesty, and authority controls do not become paid upgrades.

## Cognition routing

Use the cheapest path demonstrated sufficient for the consequence and quality floor:

```text
deterministic/cache/retrieval
→ inexpensive model
→ standard model
→ premium reasoning
→ executive/challenge
→ human
```

Routing measures both **overspend regret** (a cheaper path would have sufficed) and **underspend regret** (cheap routing caused error, rework, risk, or missed value). Complex deliberation must compare against simpler strong-model baselines and survive only when its incremental value justifies incremental cost and latency.

## Operating discipline

- Every recurring job states why it must run now; event-driven, cached, batched, or less frequent work wins when equally effective.
- Architectural complexity, migration duration, founder attention, reconciliation burden, and proof debt are costs.
- Quality and safety floors apply before optimization, on every subscription tier.
- Cost controls for material AI or external spend must be enforced atomically with reservation/authorization, not merely observed after spend.
- Value claims preserve causal humility: **observed, experimental, inferred, estimated, protective,** or **unverified**. Protective value is not booked as realized ROI; correlation is not causation.
- Evaluate recurring machinery across money, tokens, compute, latency,
  engineering and operational complexity, founder attention, security,
  authority and reliability risk, and marginal company value.

## The true cost of a probe (2026-09-09)

A probe is not cheap because its offer is cheap to build or its cash ceiling is
small. The first real experiment reached the edge of the world and found costs
the design had not counted: a domain, a sending identity, a mailbox, a page a
stranger could trust, a legal surface, and — the largest — the owner's own
attention to set every one of them up. It was modelled at $29 and $100; it
spent hours of the one input that does not scale.

So the cost of a probe includes, where material: cash and compute; **owner
attention**; new accounts and providers; DNS, domain and identity work; the
**public reputation it consumes**; legal uncertainty; support and fulfilment
burden; security burden; ongoing maintenance; and platform dependency. Foundry
must not describe a probe as "$20" while quietly spending four hours of the
owner and a new public surface.

The structural answer is not to price attention. It is to **build the surface
once and amortise it**: a probe that needs no new domain, no new mailbox, no new
site, no new privacy or refund surface and no new sender is genuinely cheap, and
the second through hundredth are. A probe that requires substantial new public
infrastructure is expensive whatever its spend ceiling, and that expense belongs
in the judgement that decides whether to run it.

**Distribution cleanliness is part of opportunity quality.** Alongside pain,
willingness to pay, build cost and market size, ask how cleanly a candidate can
reach reality: does it require cold outbound, or can it ride a marketplace, be
found through search, be distributed through an existing ecosystem, or create
its own demand through public work? A more profitable opportunity with ugly
recurring distribution can be worth less than a smaller one that enters the
world through the Workshop already standing.

## Reputation is a shared asset with a shared blast radius (2026-09-09)

One public identity stands behind every experiment. Its domain reputation,
sender standing, public record and the expectations of everyone it has written
to are scarce, shared and slow to rebuild. Every probe consumes some of it.

The behavioural rule: **an individual probe may not consume disproportionate
Workshop reputation merely because its own cash budget is small.** Foundry
refuses or stops outbound when relevance is weak, when bounces or complaints
appear, when authentication is unhealthy, when the counterparty has opted out
anywhere in the Workshop's history, or when contact frequency across experiments
becomes inappropriate. A reputation problem is answered by changing the
behaviour, never by rotating identities: a bad experiment must create pressure to
improve, not a new domain to hide behind.

Lower AI production cost must therefore increase **selectivity**, not output.
Every probe faces the implicit question: is this good enough to put the
Workshop's name behind?

## Customer obligations survive an owner pause (2026-09-09)

Stopping and abandoning are different acts, and the institution distinguishes
them structurally. **Stop new economic activity** ends offers, placements,
spend and new experiments. **Honour existing obligations** continues regardless:
what a buyer paid for is delivered, refunds are issued, the public record stays
reachable, and the contact path still reaches a person. Closing an experiment
stops new commitments; it does not cancel the ones already made.

This is why the public surface does not depend on the private control plane
being awake, and why the pause is enforced on offers rather than on the door.

### What a buyer is owed, as one object (2026-09-21)

An obligation is a purchase not yet discharged: the goods not sent, a delivery
the provider has not confirmed, a refund owed and not issued, a refund the
buyer asked for, or a charge the buyer is contesting. It is read in one place
(`services/venture/obligations.ts`) by every surface that shows, ranks or
carries it, and it closes only when the goods are confirmed delivered and
nothing is asked back, or when the money has gone back. Four rules follow,
each stated here because each is a judgment rather than a fact:

- **The acts cover what was taken on while they stood.** An act's expiry
  bounds what may be taken on under it, not the discharge of what was taken
  on while it stood: a buyer who paid on the last day the offer stood is
  delivered on the day after, and refunded after the test ends, under the act
  the owner approved — which says so in its own summary at approval. A
  purchase reported *after* the last act lapsed is covered by nothing he
  approved, so Foundry neither delivers nor refunds it: it is his, in Stripe,
  and Home says so as the one thing.
- **A stop keeps the refund act.** A stop revokes the acts that take things
  on (the campaign, the placement) and not the refund; a purchase that
  slipped in before the link came down is returned under the act already
  approved, and the asset retires only when the last buyer is square.
- **A delivery the provider never confirms is, after seven days, undelivered.**
  The sealed rule counts confirmed deliveries and the public promise is a
  refund with no questions asked, so an obligation that never closes is the
  worse outcome: the row fails, the failure is recorded as such (not as a
  verified receipt), and the approved refund runs. From seventy-two hours it
  is worth the owner's eyes and says so.
- **A contested charge is the bank's until it decides.** Nothing is sent or
  refunded on it; won, the row resumes; lost, the money is gone and the row
  closes as refunded with the dispute as its reference, never as a second
  refund. Answering the dispute is the owner's, in Stripe; Foundry does not
  speak to a bank for him.

The provider reports out of order, and the intake reads by reference rather
than by arrival: a refund names the payment it returns, and a payment that
arrives after its own refund is closed at the row (migration 326). An event
the intake cannot record releases its claim, so the provider retries it and
the sale is not lost. What only real Stripe can establish — that the tag
reaches the intent, the session and the charge and not the dispute; that a
decline at a link fires `payment_failed`; the link parameter shape; refund
idempotency on retry and refusal on a disputed charge; redelivery after a
400 — is written as a runnable, unrun procedure (`scripts/stripe-test-mode-run.mts`)
and recorded in the map as an external-evidence boundary.

## The deliberation is recorded before the answer (2026-09-09)

`why.ts` carried a comment against its own "assumptions" and "alternatives"
levels: they were a reconstruction assembled after the fact, one of the
alternatives was a generic "not doing it" appended to every act, and a page
whose whole purpose is showing its work may not manufacture a thought process
retrospectively. It ended by naming the remedy — **a later deliberation trace
can persist the real thing prospectively, at judgement time, where it would
actually be evidence.** This is that trace.

Before a probe may be decided, the institution records: the uncertainty it
settles and why desk research cannot; the **exchange** chosen and what that
exchange reveals and confounds; the exchanges weighed and refused, each with a
reason; what it can prove and — separately — what it cannot; the competing
readings of each likely observation, and which of them this probe **cannot tell
apart**; the true cost across every dimension it spends; where it stops itself;
what happens if it succeeds; and the recommendation, in the institution's own
words. The record is written before the owner decides and **sealed at his
decision**, so it cannot be edited to agree with the result.

Three behavioural consequences follow:

- **Nothing runs without one.** A test whose thinking is not recorded, whose
  chosen exchange the institution cannot actually execute, which records no
  competing reading of its own likely result, or which states no cost beyond
  cash, is refused at the decision — before the sending address, before the
  postal line, before anything a checklist could supply.
- **A budget is a ceiling, not a target.** Stop conditions are set before the
  probe starts, counted from the provider's own reports and the Workshop's
  lists, and every one of them is reached long before the cash ceiling is. A
  reputation cost is spent in the first few messages; a spend limit does not
  protect it.
- **Success is answered, not merely enjoyed.** A fulfilment cap stops new
  offers when more is owed than one person can deliver. A good result that
  becomes an unmet obligation is not a good result, and scaling is not the
  reflex the institution has when something works.

### The exchange is part of the evidence

A commercial observation now carries the exchange it was made under, because
"one person paid" and "one person accepted something free" are not the same
fact, and a probe that changed its instrument mid-flight would otherwise leave
no trace of having done so. Where no design was recorded the column is null; it
is never guessed, since guessing it is the collapse the column exists to
prevent.

**Pay-after-value is a real instrument, not a slogan.** It separates "is this
useful" from "would you buy from a stranger", and it is the right exchange once
there is a relationship to trade on. It is the wrong one for a first cold
approach: it gives away the thing being tested, turns an offer into an
unsolicited delivery — a heavier imposition on a stranger than a question is —
and confounds generosity with demand, because almost nobody pays a stranger for
something already in hand. The institution records that reasoning rather than
adopting or dismissing the idea by reflex.

### What a participant asks for is evidence nothing else can be

The public page asks one question after the offer: what would you like next?
The answers are a closed vocabulary — nothing further, only unusual ones, more
like this, I'd pay for this regularly, I'll explain, never write again — so
nothing can invent a permission, and the person's own words are kept beside the
answer rather than folded into it. Nothing tracks whether the page was read.

"I had it and it was not useful" is much stronger evidence about the thing than
a bounce, and "keep sending me these" is the first sign a one-off might be a
relationship. So both become commercial observations. **A stated "nothing
further" is not a complaint and does not join the do-not-contact list** — but it
outranks any contact interval, because a Workshop that recorded the answer and
then wrote again would be keeping it and ignoring it. Only "never" suppresses,
and it suppresses across the whole Workshop.

## A claim may be narrowed before it is sealed (2026-09-09)

Migration 286 made a deliberation immutable after the owner decides, which is
what makes it evidence. It said nothing about the window before that, and left a
gap that looks harmless: an unsealed design could be rewritten silently, so a
claim could be quietly widened after being read and quietly narrowed after being
doubted, with the row showing no sign either happened.

The window itself is worth keeping. **A probe's stated claim should be narrowed
when it turns out to be broader than the chosen exchange can establish**, and
before the world is asked is the only honest time to do it. What must not be
possible is doing it invisibly. So an amendment carries a reason, keeps the
sentences it replaced, is refused once sealed, and stamps the design — a design
that was narrowed can never afterwards read as one that was always this narrow.
The chosen exchange is deliberately not amendable: changing the instrument is
designing a different probe, and a different probe deserves its own record.

**A price paid before delivery is the cleanest observation of pre-delivery
willingness to pay. It is not the only unambiguous observation a stranger can
produce.** A voluntary payment after experienced value is equally unambiguous
about a different economic fact, and remains available to any later experiment
where a relationship exists to trade on. Choosing upfront price for a first cold
approach is a judgement about which question is being asked, not a claim that
the other instrument is mute.

## The outside is proven from outside (2026-09-09)

A provider returning 200 is not evidence that a stranger can read a page, and a
row saying "published" is not evidence either. Readiness is therefore reported
in four words and no fifth: **verified** (observed from the public internet, just
now), **ready** (true, but established privately), **waiting** (legitimately not
done yet, and what it waits for), **blocked** (cannot proceed until somebody
supplies something). Nothing is allowed to report the nearest green thing it can
find in place of the thing that was actually asked.

`waiting` carries the most weight. An experiment's public page is published when
the owner allows the test, and that is deliberate: putting an offer page for an
unapproved experiment on the internet would be the premature public act the
design exists to prevent. Its leg reads `waiting`, and the same machinery is
proven end to end against the rehearsal experiment instead.

**A page that goes dark is read as dark, at the moment of writing.** The gate
accepts a page verified within the last day, which is right for showing the
owner a dashboard and wrong for deciding whether to write to a stranger: a probe
of twenty-five messages over seven days can spend itself entirely inside that
window, every recipient sent to a page the world no longer serves, under the one
public name every later experiment also stands behind. So the pass that would
write reads the page from its public address first. One request, at the only
moment the answer changes anything.

## The Workshop can hear, and hearing grants nobody anything (2026-09-09)

Apex Micro could write to people and could not hear them answer: mail to its
address was forwarded to a personal mailbox and never reached the institution,
so a reply saying *stop writing to me*, *I paid and got nothing*, or *I would
pay for this monthly* was invisible to every mechanism built to honour it. A
workshop with a mouth and no ears cannot keep its promises, and cannot learn.

The path now exists, and one rule governs it:

**An inbound message is evidence that somebody said something. It is never an
instruction, a permission, or an authority.**

A stranger who can write to an address must not acquire anything by writing —
not a refund, not a secret, not a reply, and above all not the lifting of a
refusal somebody else made. What a message *can* do is create a record, a
scoped obligation, or a refusal, and each runs through the paths that already
govern. The function that acts on a message has no access to money,
infrastructure or sending; that is a property of what it can reach, not a
promise about how it behaves.

**Readings are made by rules, and `unknown` is a safe resting state.** The
classifications that carry consequence — a refusal to be contacted, a claim
that something is owed, a demand for money back — are exactly the ones a
hostile or careless message would most like to have misapplied, and exactly the
ones prose most easily talks a model into. So they are decided by looking for
what people actually write when they mean them; anything unrecognised stays
unknown and goes to a person. No model is consulted on this path at all: nothing
here yet needs judgement a rule cannot give, and a model added before it is
needed is an attack surface added before it is needed.

**A stated refusal is honoured immediately, without asking.** The asymmetry
decides it: acting on a false positive costs the Workshop one message it might
have sent; ignoring a true one is the thing the whole suppression system exists
to prevent. **A request for more grants nothing** — it is recorded in the
person's own words, scoped to the experiment they were answering, and the owner
decides whether it can be honoured.

**The edge forwards before it tells us anything.** The program that receives
mail forwards it to the owner first and unconditionally, then offers Foundry a
copy on a best-effort, time-bounded basis. If Foundry is down, redeploying, or
refuses the copy, the institution loses a copy and the person loses nothing. An
institution that can eat its customers' mail while claiming to serve them is
worse than one that cannot hear at all.

## Sense broadly, contact narrowly — including about whom to contact (2026-09-09)

Re-judging the first probe from its assumption chain rather than its design
found a dominated population. The chain runs: these shops bid public work →
finding relevant notices is a chore → nobody has solved it for them → the value
is recognisable from a description → the person reached decides → the price is
payable → a cold message can carry it. The probe tests the last four fused into
one observation and *assumes* the first three.

The first is the cheapest of all to check. A null result had three readings,
not two — the screening is not worth the price sight unseen; these shops do not
transact by cold email; or they do not bid public work at all. The third is
observable for nothing in the same free public record the product is built on,
and unlike the other two it can be removed **before** anybody is written to.

**Spending strangers' attention and the Workshop's one first impression to
produce an ambiguity a free lookup could have prevented is a dominated design.**
So the population narrows to shops with observed public-bid activity, and the
same messages carry more information. This is not deferral: the surface is
built, the ceiling is set, the stops are set, and endless pre-analysis is its
own failure. Sensing sharpens the shot; it does not replace taking it.

## Mechanisms with sources (2026-09-21)

External economic writing was read for mechanisms, not playbooks. A mechanism
is a cause that would still operate if Foundry never copied the author's
tactics; a playbook is what worked for one author once. Each entry names the
source, the mechanism extracted, what it depends on, an evidence grade, and
whether it applies to Foundry now. Grades: **A** primary data the author
measured and published; **B** a practitioner's account of their own business
with numbers; **C** a practitioner's account without numbers, or a
synthesis; **D** promotional or vendor-authored. Nothing here is a target, a
forecast or a claim about any market Foundry has tested; the only market
evidence Foundry holds is Experiment 001's null.

### Demand, distribution, conversion and fulfilment are four questions

Every source below answers one of four questions, and the institution keeps
them apart because a test that answers one is routinely read as answering all
four: **demand** (would anyone pay for this at all), **distribution** (can the
people who would pay be reached at a cost below what they pay), **conversion**
(of those reached, who acts, and on what offer), **fulfilment** (can what was
promised be delivered at a cost and burden the owner accepts). Experiment 001
answered conversion for one offer through one channel to one population, and
nothing else. A candidate's unknowns are now filed under one of the four (see
`economic-forms.ts`, `fourQuestionsOf`), and the cheapest test proposed is for
the question actually open.

### Product form follows the evidence

| Source | Mechanism | Depends on | Grade | Applies now |
|---|---|---|---|---|
| Walling, *The Stair Step Method of Bootstrapping* (2015), robwalling.com | Order of forms: one-time-priced add-ons to an existing ecosystem with one free channel first; stack them until they replace an income; only then a recurring product, because recurring revenue is what makes paid acquisition affordable ("there's a long ramp to any kind of substantial revenue"). | A free discovery channel existing for the form (a plugin directory, an app store, search); low lifetime value per sale, so no paid acquisition at step one. | B — the author's own revenue by step and named examples (Rodenbaugh, Derksen), no independent data. | Yes: it is the order Foundry's forms already imply. The available exchange is `upfront_price`; recurring forms stay unavailable until something has earned one-time. |
| McKenzie, *Bingo Card Creator year in review 2012*, kalzumeus.com | A small, specific product for a specific population can earn with almost no owner time when its channel is organic search and its improvements compound ("a percent here, two percent there … for six years"). | Search demand for the exact task; conversion measured and A/B tested; support bounded ("estimated weekly support time: 20 minutes"). | B — the author's audited numbers: 2,254 sales, $64,791.81 net of refunds, $38,598 profit, traffic Google 56%, AdWords 12%, trial-to-purchase 2.4%. | Partly: the shape (one task, one population, organic search, bounded support) is the shape Foundry's forms name; the channel is one Foundry has not yet earned. |
| Graham, *Do Things That Don't Scale* (2013), paulgraham.com | Early demand is created by hand: recruit users one at a time, treat the first as consulting clients, make the experience of being a user delightful; a launch is not a channel. | The founder's own hours; a narrow first population; willingness to do manual work that later becomes software. | C — essays with named examples (Airbnb, Stripe, Wufoo), no measured data. | Yes, with a limit: the institution's "hand" does the manual work under a sealed design; the owner's hours are the one thing the design must not spend without saying so. |

### Distribution is a capability, and it is bounded from outside

| Source | Mechanism | Depends on | Grade | Applies now |
|---|---|---|---|---|
| Ahrefs, *The Free Tools SEO Strategy*, ahrefs.com/blog | A working tool earns search traffic that an article cannot ("the searcher doesn't want to read, they want to do"); the tool introduces the paid product to the people who need it, free. | Low-difficulty queries where page one is thin tool pages; the tool actually working; a paid product the tool's user would want. | B/D — real traffic figures (Omni Calculator ~2.3M visits/month, FreeConvert 380K→1.5M) measured by a vendor whose product measures them. | Yes as a form: *a free resource supporting a paid product* is now an economic form on the shelf, with its cheapest test being a page that earns arrivals before anything is charged. Not yet as a channel Foundry has earned. |
| Google, *New updates to address spam and low-quality results* (March 2024), blog.google | Pages produced at scale to rank, "whether automation, humans or a combination are involved", are spam; site-reputation and expired-domain abuse likewise; Google reported 45% less low-quality content after enforcement. | Nothing Foundry can change: it is the rule the channel is governed by. | A — the platform's own policy and its own measured figure. | Yes, as a constraint: the Workshop publishes only what a person would bookmark, says how it was made, and never a page per query. This is the line between the free-resource form and scaled-content abuse. |
| Vohra, *How Superhuman built an engine to find product/market fit* (2018), review.firstround.com | Fit can be measured before it is felt: ask users how they would feel without the product, count "very disappointed", segment by who the fans are, spend half the roadmap on what they love and half on what holds the rest back. | Enough users to survey (≈40 for direction, 100–200 for the method); a product people already use. | B — the author's own scores over time (22% → 33% → 58%), the 40% benchmark from Sean Ellis's survey of "nearly a hundred startups". | Not yet: the method needs users, and Foundry has none who use anything. Recorded so that the first asset with users is measured this way rather than by opinion. |

### Disposition: build, buy, license, hold, retire — doctrine, not machinery

| Source | Mechanism | Depends on | Grade | Applies now |
|---|---|---|---|---|
| Flippa, *SaaS valuation multiples* (data to end 2024), flippa.com/blog | Small software businesses have a public price: owner-operated businesses under $1M ARR change hands at roughly 2–4× profit, with the multiple rising with size and falling with churn; buyers pay for verified, predictable earnings, not narrative. | Verified earnings; a transferable asset; a marketplace with enough transactions (795 SaaS sales in the sample). | A/D — marketplace transaction data, published by the marketplace. | As a reading, not a plan: it gives the disposition model a price scale. Buying, licensing or selling anything is the owner's decision and no code proposes one. |
| Google SRE, *Embracing Risk* and *Eliminating Toil*, sre.google | An explicit budget for failure beats maximal reliability ("incremental improvement in reliability may cost 100× more than the previous increment"); toil — manual, repetitive, automatable, without enduring value — is capped (50%) and engineered out at the source. | A measured objective; a neutral measurement; the will to stop releasing when the budget is spent. | A — the operating doctrine of a large organisation, with its rationale. | Yes, already: the charter is a budget (money, tests in flight, thinking per day) and the sealed rule is the neutral measurement; the absence test and the owner-minutes column are the toil reading. The 50% cap is a number for a team; Foundry's equivalent is that owner minutes per asset are counted and shown. |
| *When Agent Automation Becomes Profitable* (arXiv 2606.16465, preprint, June 2026) | Automation is acceptable "when its expected benefit exceeds the premium, control cost, and remaining risk", and that "requires a defined role with bounded permissions and comparable traces". | A defined role; bounded permissions; traces that can be read back. | B — a preprint with a testbed and audited traces; not yet peer-reviewed. | Yes as a statement of what Foundry already is: every act is under a role with a boundary, every consequence is a row. |
| The AI-trading articles surveyed (a Medium account of a $441K loss, 403 on fetch; MindStudio's bot tutorial, vendor-authored) | The bounded example: an agent with wallet access and no limits is "a loaded gun with no safety"; the working systems name per-position caps (2–5%), a daily loss limit (2%), a halt on drawdown and human approval above a threshold, and report no returns. | Hard limits set by the principal before the agent runs; a halt that does not need the agent's consent. | C/D — anecdote and vendor content; the mechanism is the limits, not the returns. | Yes, as a mirror: the charter's total, in-flight cap and per-day thinking are the same shape, set by the owner and enforced by rows the agent cannot write. Trading itself is outside Foundry's scope and stays there. |
| AI-automation case studies for small businesses (theautomators.ai and similar, 2026) | Claimed reductions in operating cost and hours; the one finding that survives is that most adopters report no earnings impact without redesigning the workflow. | — | D — vendor-authored, unnamed clients, aggregate figures from consultancies, no independent measurement. | No: nothing here is evidence Foundry may act on. Recorded so the same pages are not read again as if they were. |
| "Nicholson" (named in the owner's directive) | Not located: searches for an essay by that name on structuring a one-person company around small products returned nothing attributable. | — | not graded | Not used. If the owner names the piece, it is read and graded like the rest. |

### What this changes in the institution

- The economic forms gain *a free resource supporting a paid product* and
  *something licensed in and resold*; both are shelved with their cheapest
  test and the exchange they would need, and the second's exchange is not
  available today, which the shelf says.
- An unknown is filed under demand, distribution, conversion or fulfilment,
  derived from its own words, so "cheapest test" means cheapest for that
  question and a settled conversion test is not read as settled demand.
- Distribution is read as a capability the institution has or lacks, bounded
  by the platform's rules, never as a tactic the Workshop performs at scale.
- The disposition model has a price scale to read against when the day comes;
  nothing is built for buying or licensing, and the decision stays the
  owner's.
