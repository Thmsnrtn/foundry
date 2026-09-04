# What Foundry maximizes, and what it may never trade away

The constitution states the shape of the river. This states the arithmetic
underneath it: what is an objective, what is a bound, what gets priority when
they compete, and what "more intelligent" has to mean if it is not to become a
licence to build more machinery.

## 1. Six priorities, two kinds

The stated priorities are: minimize legal risk, maximize ROI, increase MRR,
minimize attention demanded of the owner, minimize cost and overhead, and think
elastically.

**They are not six terms in one sum, and it matters enormously that they are
not.** A weighted sum will, given a large enough return, sell any weight it
holds — that is what a weighted sum is for. A system that prices legal risk
against ROI will eventually accept a catastrophic legal exposure for a large
enough number, and it will be behaving exactly as designed when it does.

So they divide, and the division mirrors the consequence ladder the institution
already has:

**BOUNDS — must hold. Not purchasable at any return.**
- **Legal risk.** Bounded, with a class that is absolutely refused. This already
  exists structurally: the `legal` and `destructive` rungs are non-absorbable,
  so no allowance, lifted boundary or recognised responsibility can pre-authorise
  them. A bound, not a cost.
- **Owner attention.** A ceiling per week, per asset and in total. Exceeding it
  is a failure of the institution even in a month where revenue rose.
- **Overhead.** Bounded per asset *relative to that asset's own cash flow*, never
  globally — a global cost cap starves a growing asset to protect a dying one.

**OBJECTIVE — maximize, subject to those bounds.**
- Durable, risk-adjusted, owner-adjusted cash flow. MRR is its primary
  observable; ROI is the efficiency of the capital deployed to obtain it.

**MRR and ROI are different instruments and they conflict if pooled.** MRR
growth can always be bought at terrible ROI; ROI is maximized by never investing
at all. They resolve by operating at different stages rather than by being
weighted: **ROI gates entry** — should capital be deployed into this at all —
and **MRR measures durability** once entered. A candidate is judged on ROI. A
holding is judged on MRR and its persistence.

## 2. The threshold thesis, which is the actual mechanism

From the constitution: Foundry's economic advantage is that it **lowers the
minimum viable size of a business worth owning.** A $300–800/month business
normally cannot justify the organisational overhead of operating it. If the
institution absorbs that overhead, the business becomes worth retaining.

Made precise. For an asset:

    v = its monthly net cash
    a = the RECURRING owner-minutes per month it still demands
    λ = the owner's implicit value per minute of his own attention

    Hold it while   v > λ·a

Three consequences follow, and they are the most useful things in this document.

**(a) Foundry's real product is the reduction of `a`.** Not the assets. Every
capability that lowers recurring owner-minutes lowers the viability threshold
for *every asset at once*, present and future. That is the compounding move, and
it is why capability can rationally precede acquisition.

**(b) It gives a hard test for any proposed capability.** *Does this reduce
recurring owner-minutes for an asset that exists?* Almost nothing built so far
passes it, because no asset exists — which is the precise, quantitative form of
the criticism that the institution has enormous machinery and no revenue. The
test is not "is this good engineering". It is "whose `a` does this reduce".

**(c) It resolves the attention question exactly.** What matters is not hours
spent but whether the curve is **front-loaded and decaying** or **flat**. A
listing that costs twenty hours once and then distributes forever has an `a`
approaching zero. A channel needing a weekly post has a flat `a` — trivial at
one asset and eighteen hours a week at nine. **Prefer any asset whose
non-delegable share is spent once, at birth. Refuse assets with a flat curve,
however good their revenue looks in year one.**

## 3. Elastic: effort follows prediction error

"Think elastically like a brain does" has a precise and implementable meaning,
and it is not a metaphor to be admired.

A brain does not spend uniformly. It allocates metabolic resource to where
prediction error is high, prunes what carries no signal, consolidates episodes
into rules while resting, runs a cheap reflex before an expensive deliberation,
and regulates itself toward set points rather than growing without bound.

Translated, in order of how much each is worth here:

**Effort follows surprise.** An asset behaving as its sealed thesis predicted
should consume near-zero attention *and* near-zero compute. An asset diverging
should pull both toward it. Today every job runs on a fixed cron whether or not
anything changed — the opposite of elastic. A metronome, not a brain.

*This is why the return leg comes first.* You cannot allocate effort by
prediction error until predictions are resolved. Grading a decision against what
it was sold on is not bookkeeping — **it is the sensor the whole elastic
allocation runs on**, and nothing downstream can be built before it.

**Two-speed cognition.** Cheap deterministic triage; expensive model reasoning
only where it would change a decision. Directly serves the cost bound. The
reader currently pays the same price for a sentence it will discard as for one
that matters.

**Pruning.** Search terms that retrieve nothing retire themselves. Capabilities
that stop working degrade themselves. Assets below their covenant surface a kill
decision. Nothing in the institution currently retires anything.

**Consolidation.** Many episodic records become few general rules. There is not
a single aggregate across judgments anywhere in the venture or institution
services — every decision is perfectly auditable one at a time and teaches
nothing to the next. **Auditability is not intelligence.** It lets you defend
the tenth decision; it does nothing to improve the ten-thousandth.

**Homeostasis.** Set points — owner-minutes per week, overhead per asset, model
spend per decision — that the system regulates *toward*, rather than limits it
merely stops at.

## 4. Priority under contention

The scarce resources, in order of scarcity: **his attention**, legal surface,
capital, build capacity, model cognition. When two things compete:

1. **A bound about to be breached.** Legal, attention ceiling, irreversibility.
   Always first, and never traded.
2. **A threat to cash flow that already exists.** A live asset dying outranks a
   new one being born. Defending a nickel is cheaper than finding one, and the
   institution is currently built almost entirely the other way round — thousands
   of lines of origination and no capability to notice an asset has stopped
   serving.
3. **Prediction error on a live asset.** The elastic principle.
4. **A harvest or kill decision.** These *return* scarce resources; they
   outrank spending more.
5. **New origination.** Last, and this is the correction most at odds with how
   the system is built today.

**Defend the river before extending it.**

## 5. Correlation is what kills a river

Nine assets on one platform are one asset with nine names. A river of nickels
fails not by any tributary drying but by all of them sharing a source: one
payment processor, one traffic channel, one marketplace's policy, one API's
pricing page, one legal jurisdiction.

The institution already models this — `exposure_dimensions`, concentration on a
`legal_exposure` axis, and the ability to say *"another conventional SaaS would
increase a concentration you already have."* It is fed, for real companies, by
nothing at all. So on the day the first real asset launches, concentration
reports `null`, which reads as "nothing shared" and means "I have never been
told anything."

**Diversity of source is not a nice property of the portfolio. It is the
definition of a river rather than a pipe.**

## 6. What "more intelligent, agentic, nuanced" must mean

Left undefined, this is a licence to build subsystems forever, and this
repository already contains thirty audit documents proving that is what happens.
So it gets three measurable definitions, and nothing counts that does not move
one of them:

- **More agentic** = recurring owner-minutes per asset falling, at constant or
  rising cash flow. Not more actions taken. Fewer asks made.
- **More intelligent** = calibration improving. Of the predictions it sealed and
  that have since been graded, the proportion it got right is rising. This is
  unmeasurable today because nothing is ever graded.
- **More nuanced** = the same quality of decision at lower cost per decision, and
  a widening class of situations it can distinguish between rather than treat
  alike.

An addition that moves none of the three is machinery. It may still be correct
engineering, and it is still machinery, and the honest thing is to say so and
gate it behind an event rather than build it now.

## 7. The one test that outranks this whole document

Has one human being who is not the owner paid one dollar for anything?

If the answer requires a subsystem, the answer is no.
