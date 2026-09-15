# Foundry — post-tranche closeout, acceptance

*Read from production rows on 15 September 2026. Every figure below is a count
of something, and says what it counts.*

---

## NOW — what is true

### Experiment 001, reconciled from the rows

| | | |
|---|---|---|
| authorised cohort | **21** | one act, `AEk3lSzEsRiJBCz1ggwk2`, decided by the founder 12 Sep 18:33, consumed 23:20 |
| sent / provider-accepted | **21 / 21** | every one carries a Resend receipt |
| delivered | **19** | verified against the provider afterwards |
| unresolved | **0** | |
| bounced | **2** | both real, both suppressed |
| **replies from the 21** | **0** | no mail from any approved recipient |
| opted out | **0** | the one suppression is a `.test` address, two days *before* the send |
| purchased | **0** | no fulfilment row, no economic event |
| proposed, never approved | **10** | candidates; no act covers them, nothing was sent, nothing may be |
| struck | **3** | with reasons on the rows |

### What authority remains — stated exactly, because "none" was wrong

An earlier draft of this report said *no authority remains*. Re-read from
`proposed_acts` estate-wide, that is not true, and the difference matters more
than the tidier sentence did.

**The writing act is consumed.** `AEk3lSzEsRiJBCz1ggwk2` was used at 23:20 on
12 September and nothing further may be sent under it. It never grew: every
approval predates it, there is exactly one, and its own summary names the
number. Reaching anyone else needs its own authority over its own named set.

**Two acts are live**, both decided 12 September, both expiring 3 October,
**neither of which writes to a stranger**:

| act | what it may do | can it reach a person? |
|---|---|---|
| `8mzBurxvcgsQWsZmGCiVm` | create the $29 one-time payment link | No. It reaches Stripe. |
| `-hpOKK8k605ESrGozy3Yp` | refund, in full, any purchase that could not be delivered | Only a buyer, only to return their money — and there are no purchases, so it cannot fire. |

**And the declined experiment is the strongest evidence the boundary holds.**
`SkQeFRIbU9SR6oMNC3MSX` was declined on 9 September and superseded by
Experiment 001, because its design pointed a raw payment link from a fresh
domain and carried more identity and reputation cost than it counted. It still
holds **22 approved recipients** — real businesses, reviewed and said yes to.

Zero of them carry an authorising act, and **zero acts name that experiment at
all**. Nothing can be sent to any of them. That is the invariant doing its job:
approving a recipient is a review of the population, never authority to write to
it, and the outbound door reads the act on the row rather than the review. A
declined experiment keeps the review and gets none of the authority.

Eleven outbound proposals sit `pending_approval` against no experiment. They are
internal agent proposals about the institution itself; they reach nobody
outside, and the society that wrote them is off the timer.

The earlier report's "4 questions back, 1 opt-out, 11 pending" were each a true
count of a real table and together described an experiment that does not exist:
the questions were rehearsal traffic (`.test` addresses, the SES simulator, a
DMARC report, the owner's own mailbox), the opt-out was a `.test` address
suppressed *before* the send, and the eleven pending were internal agent
proposals belonging to no experiment.

### The owner queue

`behavioral_triggers` — **retired**, not repaired. Commercial Foundry's
activation funnel, 50 consecutive failures since 1 September, addressed to the
personal address ruled out of Foundry operations. A broken job was the only
thing standing between that rule and 50 breaches of it.

The agent society — **27 loops retired**, 75 still scheduled. Twelve agents, a
fortnight, 90 sessions, 36 briefings, 18 messages to each other, **11 proposals
and not one ever approved**; every `agent_evolution_versions` row an initial
provision; five agent tables empty; nothing behind the six doors reading any of
it. The modules are preserved — reached at boot and by two live routes — and any
of them may come back by being put in the registry deliberately, with a reason.

Self-observability — **built**, as `deployment/self-check`: five readings, each
able to answer "I cannot tell", and **no product id resolved anywhere**, because
`recursive-institution` refused a kernel that could ask whether it is operating
Foundry.

Frontier warrants — **not an owner decision**. Nine files reach the expensive
model, each with a written argument, none `watched`. Which model answers a
routine internal question is routing.

### Recoverability

A ladder: every day for a fortnight, Mondays for three months, firsts for a
year. Compressed, ~95 MB of a 974 MB volume, no new provider and no new bill.
Thinned by the **date in the name**, because a restore or a volume move touches
every mtime at once.

**11 copies on the volume, reaching back 11 days, newest 20 hours old.**
`restoreTheInstitution` refuses to write over the live database, and a test
restores a real compressed copy and reads the institution out of it.

### The clean UI

Nothing but the Clerk sign-in pages carries inline behaviour. **Zero** `on…=`
handlers remain anywhere in `src`; three inline `<script>` blocks remain, all of
them Clerk's. Every authenticated path — `/foundry`, `/letter`, `/settings`,
`/privacy`, `/autopilot`, `/connections`, `/onboarding` — serves a policy with
no `'unsafe-inline'` at all, verified against production.

`/talk` is a 404. `/autopilot` is a 308 to Controls.

### Cognition

$14.88 over 1,099 model calls, of which **$10.45 — seventy per cent — named no
purpose**. Every call site now declares what work it is, from a closed
vocabulary of 31 kinds, enforced by the type system. No new instrumentation: the
row was already written and gains a field.

### The economy, and tax

Both were audited against production rows rather than described.

**Nothing has been manufactured.** `economic_events`, `experiment_fulfilments`
and `stripe_events` are all empty. No money has moved, so the surfaces say
nobody has paid for anything yet — which is what honest maturity looks like when
an institution is this young, and is the reason there is nothing to take out.

**Nothing about tax has been invented.** `economic_policies` is empty: no rate,
no entity type, no jurisdiction, no filing obligation, no deadline. Nor could
one appear by accident — the ledger refuses a tax reserve that does not carry
both a rate and a basis, refuses any policy that does not say where it came from
and why, and falls back to nothing. An institution with no stated tax assumption
has not made one, and the surface says so rather than quietly holding back
thirty per cent of something. A policy is superseded rather than updated, so a
reserve computed under an old rate stays explicable.

### Could he leave? The five questions at three lengths

Read against the live estate on 15 September, after the fixes, at 02:12 UTC.
**Reported separately and never averaged** — a property that holds for a week and
fails at ninety days is not a property that holds; it is one nobody had asked
the longer question.

| | 7 days | 30 days | 90 days |
|---|---|---|---|
| truthful | ✗ | ✗ | ✗ |
| bounded | ✓ $35 | ✓ $150 | ✓ $450 |
| understandable | ✓ | ✓ | ✓ |
| recoverable | ✓ | ✗ | ✗ |
| only real decisions | ✓ | ✓ | ✓ |

**truthful** fails for exactly one reason at every horizon: *Foundry has nothing
connected to it, so I observe nothing about it.* It used to fail for two — the
second was `behavioral_triggers`, a job already retired whose gravestone in
`job_health` was being read as a fire. The other two lines in that reading are
now positive: the deployment can see itself, and the ledger refuses an estimate
with no written policy behind it.

**recoverable** holds at 7 and fails at 30 and 90 because the ladder started
eleven days ago, not because it is misconfigured. Copies reach back 11 days,
which covers the whole of a seven-day absence; a fault in the first 19 days of a
thirty-day one would have no clean copy left by the time he noticed. It will
hold at 30 around 4 October and at 90 around 3 December, with no intervention.
Until then the claim is not made.

**bounded** is a real number rather than a promise: at most $5 a day of thinking,
and every permission ends by itself whether or not he comes back.

---

## PROOF — what was actually checked

- **The chain**, green: 547 test files, 4,702 tests, exit 0.
- **The retirement, in production**: five loops that had run every hour last ran
  at 21:00; the deploy landed 21:29; 22:00, 23:00 and 00:00 passed with none of
  them running, while four other jobs ran at 00:00. The scheduler is alive; it
  is the society that is quiet.
- **The policy, in production**: all seven owner paths return the hashed
  `script-src`; `/talk` returns 404.
- **The layout**, at 375–430 px and 1024–1440 px, at 100% and 200% text, with
  **the stylesheet actually served** — which it never had been before.

---

## OWNER — what genuinely needs Thomas

**One.** Everything else was either decided by evidence or was never his to
decide.

> **Foundry has nothing connected to it.** It is an ordinary company in this
> system and no sense reports on it, so silence from it means nothing — and
> after 7, 30 or 90 days away there would be no way to tell the difference.
> Connect something that reports on Foundry, or say on its page that quiet from
> it means nothing.

That is the whole owner queue. Not 22 clerical approvals; not "should this
internal module exist"; not "which model should answer a routine question".

---

## WATCH — true, and will change on its own

- **Recoverability at 30 and 90 days.** The ladder holds at 7 and does not yet
  reach 30 or 90 — because it started 11 days ago, not because it is
  misconfigured. It will hold at 30 days around 4 October and at 90 around
  3 December, with no intervention. Until then the claim is not made.
- **What the thinking is for.** The 1,099 historical calls cannot be attributed
  after the fact and are reported as unattributed rather than dropped. The
  grouping becomes useful as new calls accumulate.
- **The retired society's modules.** Preserved and unreachable from any owner
  surface. If they are still unscheduled in a few months, deleting them is a
  smaller change than it is today.

---

## NEXT — nothing is proposed

The tranche is closed. No further capability phase is proposed, no experiment is
designed, and no person-facing act is pending. The one owner decision above is
the only thing waiting.
