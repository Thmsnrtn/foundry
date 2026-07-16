# The 14-Day Dogfood Plan — AcreOS as Foundry's customer #1

**Purpose:** the concrete runbook for the dogfood fortnight, ready to execute
the moment the deploy clears. Exit criterion (from the finish-line directive):
*Thomas operates AcreOS for two weeks primarily through Foundry's briefing +
inbox.* That run IS the launch story and the demo.

**Gate:** production is live (`/internal/health` green — see
`docs/blockers/BLOCKER-FLY-TOKEN.md`). Everything below assumes that's done.

## Day 0 — Setup (~30 min)

1. **Create the AcreOS product** in Foundry (no-code onboarding path, or the
   GitHub path if you want the code audit): name "AcreOS", its URL.
2. **Seed the dogfood defaults:** `foundry seed:dogfood <acreos_product_id>`
   — North Star (5 paying alpha founders / $11,940 ARR / 91-day target) +
   the voice fingerprint. Verified working end-to-end 2026-07-14.
3. **Connect real data** on `/connections` / Integrations:
   - Stripe (AcreOS's real MRR/churn) — read-only; money tools stay OFF.
   - Whatever analytics/support you actually use.
   Or, if connectors aren't ready, post metrics to `/ingest/<token>` from a
   cron so the Signal is real.
4. **Set the fluency** you want (Settings) and your **interruption ceiling**
   (`max_channel`) so paging matches your tolerance.
5. **Leave all autopilot categories at `shadow`.** The first week is
   observation — you're grading its judgment, not granting it hands.

## Days 1–7 — Observe & grade (the taste week)

The discipline: **operate AcreOS through the Letter + decisions inbox, and
every rough edge is a defect with an evidence-file diff.**

- **Each morning:** read The Letter first (`/letter`). Does the "one thing
  that needs you" match what you'd actually have prioritized? Does "what I
  learned" surface anything real (an expired belief, a radar warning)? The
  briefing must earn its 90-second read.
- **Log real decisions** as you make them, with the belief behind them
  ("we'll hold pricing because churn is mix-shift, not dissatisfaction").
  Watch the memory kernel monitor them.
- **Run `npm run sim:golden` mentality on the live output:** when a surface
  reads like generic advice instead of a sharp operator, that's a defect.
  Capture it: a one-line note + the artifact, into `docs/audits/dogfood-log.md`.
- **Grade the autopilot's shadow work** in the Letter ("customer success is
  still watching — it saw 3 things it would have acted on"). Would you have
  made those calls? That's the promotion evidence.
- **Watch the operator pack** ("Your machine" lines): AI spend anomalies,
  verifier drops, failed executions. This is Foundry running Foundry.

**Daily 2-minute check:** is anything false, noisy, or missing? A Class-C
escalation (something that reached you but shouldn't have) is a defect — patch
the knowledge so it never recurs.

## Days 8–14 — Grant & feel the leverage (the trust week)

- **Promote what earned it.** For any category whose shadow calls you'd have
  made yourself, grant `suggest` (or `act`, with the recorded consent
  disclosure). Start with customer success — lowest risk.
- **Let it act** where you granted it, and watch the action-verifier close the
  loop (pre-declared success criteria, checked in days; failures demote).
- **Reply to the Letter / use `/talk`** ("what needs me?") as your primary
  interface. Measure: how many mornings did the Letter + inbox fully suffice,
  with no need to dig into raw dashboards?
- **The exit check:** by day 14, are you operating AcreOS *primarily* through
  the briefing + inbox? If yes → that's the launch story. If no → the gap
  between "had to go around it" and "it handled it" is the exact next-work
  backlog.

## What to capture (the artifacts that become the launch)

Create `docs/audits/dogfood-log.md` on day 1 and append to it:
- **Defects:** each rough edge, with the artifact + a one-line fix note.
- **Wins:** each moment the product genuinely saved you attention (these are
  the testimonials/demo beats).
- **Trust curve:** which categories you promoted, when, and why (the
  "autonomy earned on a real business" proof — the trust-factory story).
- **The one-number outcome:** on day 14, "% of AcreOS operating days run
  primarily through Foundry." That number is the headline.

## After the fortnight → design partners

Only after the dogfood exit criterion is met: recruit 3–5 design partners from
where solo SaaS founders gather (build-in-public, indie-hacker forums). Manual,
founder-led onboarding. No paid acquisition until week-4 retention of design
partners is proven — then pre-register kill/scale criteria as executable config
before the first ad dollar (per the finish-line directive). This is also when
Arc 1 (the network) gets its first real nodes — see NORTH-STAR.md.

## Standing rule during dogfood

Every incident or override produces a written evidence diff. No exceptions.
The compounding loop: incidents → evidence write-back → fewer escalations →
more earned autonomy → more the machine handles → more you can step away.
That loop, lived on AcreOS for two weeks, is the whole proof.
