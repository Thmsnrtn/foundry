-- =============================================================================
-- TWO OKR SERVICES, AND THE ONE WITH THE RULES IS THE ONE NOTHING CAN CALL.
--
-- `src/services/scp/okr.ts` held the OKR doctrine: status mapping between the
-- application's vocabulary and the database's, progress recalculation from key
-- results, archiving of completed objectives. Nothing imported it. No route, no
-- job, no agent, no test. It has sat on the unreachable-modules baseline.
--
-- The OKR feature people actually use is `routes/dashboard/agents-okr.ts`,
-- which does its own SQL and derives progress in the query:
--   (current - start) / (target - start), clamped to [0, 100].
--
-- So there were two answers to "how far along is this objective", and the
-- consequence was concrete. `company_okrs.progress_pct` is a stored column, and
-- its ONLY writer was `updateKeyResult` in the unreachable module — which
-- itself had no caller. The column was never written after insert. Anything
-- reading it got 0 for every objective, forever, while the page showed the real
-- derived number. `getOKRProgress` in that module returned zero progress for
-- every OKR of every company.
--
-- The module goes. The column goes with it, because progress is derived at the
-- one place it is displayed and a stored copy of a derived number is the
-- disagreement waiting to happen.
--
-- One consequence stated plainly: `okr_progress_updates.source` admits
-- 'agent_session', and the only code that would ever have written it was in the
-- retired module. Every row in that table today says 'founder_manual'. The
-- CHECK is left alone — an agent path may come back — and the OKR page renders
-- the distinction rather than assuming it away, so if one does, the founder
-- sees it the day it arrives.
-- =============================================================================

ALTER TABLE company_okrs DROP COLUMN progress_pct;

-- ─── AND TWO PRODUCING HALVES WITH NOTHING AT THE OTHER END ──────────────────
--
-- `portfolio_alerts` held portfolio id, product id, alert type, severity,
-- message and an `acknowledged` flag. `createPortfolioAlert` inserted into it
-- and had no caller — no route, no job, no agent. Nothing read the table, and
-- nothing ever set or read `acknowledged`. Both halves were absent: no alert
-- was ever raised, and there was nowhere for one to appear. An investor
-- alerting path also crosses portfolio isolation, which is an owner decision
-- and not one to take by leaving a writer lying around.
--
-- `expansion_analysis` stored the output of `generateExpansionBrief`, which
-- returns the brief to its caller. Nothing read a row. Its
-- `tam_penetration_rate` column was filled with the literal 0 — not computed,
-- not defaulted, a zero typed into the INSERT saying this company has captured
-- none of its addressable market. Nobody saw it, which is the only reason it
-- never misled anyone.
--
-- Both on the owner decision recorded at migration 157.

DROP TABLE IF EXISTS portfolio_alerts;
DROP TABLE IF EXISTS expansion_analysis;
