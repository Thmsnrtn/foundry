# The Foundry Constitution

*The design laws every feature is built to. If a proposed feature can't say
which law it serves and which loop stage it occupies, it doesn't ship.*

## The One Concept

Foundry is an **institution-in-a-box**: a closed decision loop that converts
telemetry into judgment, judgment into action, and outcomes into calibrated
trust — so a company of one gains the emergent properties of a company
(memory that outlives moods, dissent that precedes commitment, judgment that
survives fatigue, continuity of intent across time).

## The Loop

```
sense → frame → contest → decide → commit → execute → observe → learn
  │        │        │         │        │         │         │        │
integr.  agents  Red Team   gates   Memory    outbound  metrics  calibration
telem.  briefing pre-mortem founder  Kernel    gateway   signal   & evolution
```

Every feature is a stage of this loop. The product is not twelve agents; it is
**one loop that compounds**.

## The Laws

1. **Loop Law** — every feature occupies a named stage of the decision loop,
   or it is cut.
2. **Ledger Law** — every claim, recommendation, and decision is recorded with
   its premises and confidence, and is later *scored* against reality. Nothing
   the system says is unaccountable. (Substrate: `decision_premises`,
   `red_team_reviews`, prediction-accuracy tracking.)
3. **Trust Law** — autonomy is priced, not configured:
   `gate(category) = f(measured calibration × stakes × reversibility)`.
   Delegation to the Second Self is earned on the record, category by category.
4. **Dissent Law** — no gate-3+ decision proceeds uncontested. The Red Team
   pre-mortem is a structural stage, not an optional feature. Overruling
   dissent is allowed — but the overruled objection becomes a monitored
   premise, so being wrong is always discoverable.
5. **Attention Law** — optimize for attention *returned*, not consumed. North
   star: days the founder could safely not look. Fewer doors as autonomy grows;
   the route count may only shrink (ratchet-enforced, per AcreOS).
6. **Honesty Law** — the system displays its own batting average and lowers its
   own voice where its record is weak. Confidence must be backed by track
   record; unverifiable claims never ship (truth-engine).
7. **Human Law** — the founder's state (fatigue, overload, streaks, hours) is
   first-class telemetry. Pacing, tone, and timing adapt to it. Protect sleep.
   Celebrate wins. The human is the engine.
8. **Compounding Law** — every interaction leaves a residue (premise, lesson,
   calibration point) that improves the next decision. If it doesn't compound,
   it's a cost.
9. **Fluency Law** — the product NEVER forks by audience. Newbies and experts
   get the same features, data, and power; only the *voice* adapts — how much
   technical vocabulary is used and how much hand-holding is shown. Onboarding
   infers a default; the dial lives in Settings; plain speech keeps the
   technical term visible (users are learning the vocabulary, not being
   protected from it). Substrate: `services/ux/fluency.ts`.

## The key unification

A Red Team **objection is an anti-premise** — a falsifiable prediction of
failure. Overruling it converts its inverse into a monitored belief in the
Memory Kernel. Falsification then simultaneously (a) surfaces an expired belief
to the founder and (b) **vindicates** the dissent — a calibration point that
raises the Red Team's voice in that category. One substrate
(`decision_premises`), two ledgers (the founder's beliefs, the system's track
record). Laws 2, 3, 4, 6, 8 in a single mechanism.

## How the evolutions map to the loop

| Evolution | Loop stage | Law |
|---|---|---|
| Memory Kernel (B1) | commit | 2, 8 |
| Red Team (B2) | contest | 4, 6 |
| Ghost Company (B3) | frame/decide (counterfactual) | 2 |
| Network Nervous System (B4) | sense/learn (collective) | 8 |
| Human Layer (B5) | all (pacing) | 7 |
| Second Self (B6) | decide (earned autonomy) | 3 |
| Overnight Operator (B7) | the whole loop, ambient | 5 |
