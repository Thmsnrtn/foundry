# Adversarial review of the River port tranche (2026-09-08)

The campaign steward's review of `402b1f99..HEAD` on `claude/foundry-river-constitution-rvd0mx` before it carried a deploy marker. Read as an attacker of the port's own claims: that an experimental asset can reach the world only under an act the owner approved; that money moves only as he allowed; that a refunded purchase validates nothing; that the owner's page tells the truth in his absence. Every finding was either fixed with a test in this tranche or recorded here with the reason it was not. Nothing was left silent.

## Confirmed, and what was done

### [high] The first port of the campaign act would have sent nothing: the kill switch refuses every effect from an experimental asset, and the ask-first door spends an approval per exact act
`src/services/outbound/kill-switch.ts`, `src/services/institution/standing-intent.ts`

**Scenario.** Allow proposed one River-style campaign act over the recipient list and template; the hand's per-message `invoke` carried per-message params. The kill switch's experimental-asset rule ("this act names none") refused before anything else; had it passed, `spendApprovalFor` would have found no act with the message's fingerprint and consumed the campaign act on its first use. The rehearsal caught it on its first run past Allow.

**Done.** fixed: the door resolves the act from rows (`experimentActFor`: the planned, guarded, claimed outbound row; a refund requested on an owed purchase; the exact params the owner approved; a withdrawn exposure under the placement act) and the ask-first branch treats that act as the answer, marking it used once (kill-switch.ts, gateway.ts, standing-intent.ts); `nothing_asked_for_this` is met by three ask-first boundaries the owner's Allow states on the asset. Tests: the rehearsal's eleven offers, the delivery, the refund and the take-down all cross the real door.

### [high] A payment counted as the paid event even after it bounced and was refunded; a refunded purchase would have validated the test
`src/services/venture/proof-1.ts`, `src/services/venture/hand.ts`

**Scenario.** Rule `{event: payment, at_least 1}`. A buyer pays; the delivery bounces; the hand refunds; `settleFromTheWorld` still counts the payment (it nets nothing) → `as_predicted`, asset earned.

**Done.** fixed: the rule is sealed on `delivery`, which exists only after the provider confirms the brief reached the buyer; the delivery is classified by who paid, read from the provider at reconciliation and dropped, so the owner's own purchase counts for nothing (hand.ts `reconcileAction`). Test: "a bounced delivery is refunded …; a refunded purchase validates nothing".

### [high] The payment link stayed live after the test settled or was stopped; a later purchase would have been recorded nowhere or delivered never
`src/services/venture/hand.ts`, `src/services/integration/stripe-gateway.ts`, migration 284

**Scenario.** Settlement set `ran_at`; Stop withdrew the exposure row; the Stripe link stayed active. A purchase after that: `exposureOf` returned the withdrawn row (fine), the fulfilment opened, but the plan guard refused any delivery (`experiment_not_live`) and the hand only looked at live tests. Money taken, nothing delivered, nobody told.

**Done.** fixed: `withdraw_payment_link` capability and `stripe_deactivate_payment_link` handler; the hand takes the link down on settlement and on stop (before the acts are revoked); deliveries outlive settlement in the guard and at the door; what is owed under a withdrawn, unsettled offer is refunded; the aftermath loop carries owed purchases for seven days after the end. Tests: "settled as predicted and taken down", "a second test … stopped: … link inactive".

### [medium] The take-down retried forever after a stop, with a door refusal on every pass
`src/services/venture/hand.ts`

**Scenario.** Stop revoked every act; the aftermath loop found a withdrawn exposure and called the door, which refused ("this act names none") on every hourly pass for seven days, filling the report with an exception the owner could do nothing about.

**Done.** fixed: no standing placement act, nothing to retry (`takeDownExposure`). Test: the stopped test's hand is idle.

### [medium] The hand's clock could read a receipt before its reconcile time and settle a prediction in the same second it was made
`tests/unit/the-first-real-experiment-runs-by-hand.test.ts`

**Scenario.** A test clock ahead of the wall clock reconciled receipts immediately; `prediction_resolution:not_after_the_prediction` refused the settlement when the clock was behind. Both were the test's, not the hand's: in production `now` is the wall clock.

**Done.** the rehearsal pins its clock behind the wall clock, dates the prediction before it as the other settlement proofs do, and states why.

### [medium] An exception the owner needed vanished the moment the test settled
`src/services/venture/hand.ts` `handExceptions`

**Scenario.** A buyer asks for a refund through the link after settlement with money tools off; `handExceptions` returned nothing for settled tests; the request lived only in the timeline.

**Done.** fixed: a settled or stopped test can still owe a buyer; those lines stay. Test: the refund-link case asserts the exception appears and clears.

## Recorded, not fixed

- **A failed take-down has no receipt of its own.** If Stripe refuses to deactivate the link, the failure is in the hand's report and the gateway invocation log, and retried hourly for seven days; the owner's page does not carry it. A `taken_down_at` on the exposure would be a schema change for a case the rehearsal shows no path to; deferred until it happens once.
- **Replies are not read.** The offer's reply-to is the owner's inbox; Foundry cannot see a reply. Deliberate (no receiving domain before one test shows buyers write back).
- **The brief's freshness is a launch prerequisite.** The quality gate refuses a brief older than seven days; Proof 1's brief was pulled 2026-09-07. Re-pull and re-embed before the owner allows it, or the first delivery will be refused and shown as an exception. Recorded in the handoff.
- **`FOUNDRY_ENABLE_MONEY_TOOLS` is absent in production.** Refunds will be recorded and shown as needing the owner until it is set; the rehearsal proves both states.
- **The Controls page at 430 px and 200% text** had 7 px of its last line under the fixed bars once the seed added a live search; 8 px of slack was added to the page's bottom padding rather than to that page alone.
