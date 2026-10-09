# What the simulation says

Written 2026-10-09 03:28 UTC. 5 simulated worlds of the real institution against the market twin (capable), every rule checked after every simulated day.

**How to read this.** Each run imagines a different market, because nobody knows the real one: how many people search, how many buy, how many ask for their money back. Every number below is a range across those imagined markets — the low case (p10), the middle (p50) and the high case (p90). A wide range means we do not know. None of it is a measurement of the real world.

## With a capable model (5 runs × 365 days)

| | low / middle / high |
|---|---|
| Days until the first sale | 128 / 366 / 366 (a sale in 2 of 5 runs; "366" means none) |
| Products for sale at the end | 2 / 3 / 3 |
| Money kept after fees and refunds | $0 / $0 / $13 |
| Your minutes per week (whole run) | 13.0 / 18.7 / 22.7 |
| Your minutes per week (last four weeks) | 9.2 / 14.3 / 19.3 |
| Times Foundry refused something invented | 0 / 0 / 0 |
| Rules broken | **0** (must be 0) |
| Runs where the forge had gone quiet by the end | 2 of 5 |

Your time: in the middle case about **14 minutes a week** once it settles in — inside 1% of a 40-hour week (24 minutes) but above Foundry's own target of 10.

## What would most change the answer

One at a time: each parameter pinned at its 10th and then 90th percentile, every other at the seed's own draw, averaged over the capable worlds. Open loop: the institution's own timeline (which products were live when, what reached the owner) is held fixed and only the market and the minutes model are re-run.

Money:

- **market.impressionsPerDay** (search impressions a live listing gets per day at full demand for its theme; source: assumption) moves money kept by about $68 between its low and high case.
- **market.indexLagDays** (days between a page being announced and search sending it anybody; source: assumption) moves money kept by about $-22 between its low and high case.
- **market.baseConversion** (visit-to-purchase rate for a sound product, priced within the visitor's willingness to pay; source: calibration) moves money kept by about $15 between its low and high case.

Your minutes:

- **minutes.perWaitingItemPerDay** (owner minutes per day an unanswered item costs him by being seen again; source: assumption) moves your minutes a week by about 9.4.
- **minutes.weeklyRead** (owner minutes a week reading the Brief when nothing needs him; source: assumption) moves your minutes a week by about 7.4.
- **minutes.perNewItem** (owner minutes to read and decide one new needs-you item; source: assumption) moves your minutes a week by about 3.3.

## The stranger panel

21 held-out buyers, judged by three different judges on 14 files (scripted judges, not models): all three agreed on 64% of 90 judgements (Fleiss' kappa 0.57). They said yes 56% of the time to a capable model's files and 0% to a sloppy model's. 32 judgements split the judges and are listed for a person to read.

## How sure we are of what Foundry can do

evidence levels: every one of 58 claims in 4 tables carries a level, and every E3+ a pointer (E0 1, E1 5, E2 46, E3 6)

## What this cannot tell you

- 12 of the 22 numbers the imagined market runs on are guesses nobody has measured. They are listed in scorecard.json, each with why it is what it is.
- The model's answers are scripted. A real model can be better, worse, or differently wrong.
- The buyers are imagined. Five model-played buyers and one seller's self-report are the only outside voices, and both lean optimistic.
