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

**Remaining person-facing authority: none.** The act is consumed, and it never
grew — every approval predates it, there is exactly one, and its own summary
names the number. Nothing may be sent to anybody under it. Reaching anyone else
needs its own authority over its own named set.

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

---

## PROOF — what was actually checked

- **The chain**, green: 546 test files, 4,696 tests, exit 0.
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
