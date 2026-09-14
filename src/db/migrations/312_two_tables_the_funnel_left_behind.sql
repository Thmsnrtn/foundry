-- =============================================================================
-- THE FUNNEL'S LAST TWO TABLES.
--
-- Nine onboarding routes were deleted with Commercial Foundry: the GitHub OAuth
-- exchange, the repository picker, the competitor forms, and the first audit
-- with its progress page. Four modules lost their only caller and went with
-- them — `lib/validation.ts`, `middleware/validate.ts`,
-- `services/audit/progress.ts` and `services/ux/hints.ts`. These are the two
-- tables underneath.
--
--   `onboarding_audit_progress` — one row per company being audited, holding a
--     step number, a label and a percentage. It existed so a page could poll
--     "Analyzing your product… step 4 of 9" while a stranger's repository was
--     read. The audit ENGINE survives and is reachable; what is gone is the
--     funnel step that ran one on the way to asking for a card.
--
--   `dimension_hints` — a model-written tooltip per audit dimension, generated
--     at the end of that same first audit. Its writer and its reader were both
--     in the wizard.
--
-- Neither holds anything the owner's instance can want: no audit has ever been
-- run here through a funnel that was never walked, and nothing else in the
-- codebase can name either table. `check-unreferenced-tables` is what found
-- them — the strict gate, which asks for a reference in EITHER direction and
-- accepts a trigger body or a foreign key as one.
--
-- `dimension_hints` holds a foreign key into `audit_scores`, which stays; the
-- reference points outward, so nothing that remains is left dangling.
-- =============================================================================

DROP TABLE IF EXISTS onboarding_audit_progress;
DROP TABLE IF EXISTS dimension_hints;

-- AND A THIRD, WHOSE WRITER WAS THE TIER WALL.
--
-- `gate_events` recorded which feature a founder hit a paywall on, and which
-- plan they were on when they hit it. Its only writer was `requireTier` in
-- `middleware/tier-gate.ts`, deleted with the sixteen subscription gates it
-- enforced; nothing has ever read it. It survived the strict gate only because
-- the privacy erasure map named it — which is not a use, it is a promise to
-- delete on request, and there is nothing left to delete.
--
-- Its entry in `services/privacy/consent.ts` goes with the table. The private
-- owner is not on a plan, so no row here can be about him; in a commercial
-- instance the question is answered by `services/billing/entitlement.ts`, which
-- asks whether an account has lapsed rather than which door it was refused at.
DROP TABLE IF EXISTS gate_events;
