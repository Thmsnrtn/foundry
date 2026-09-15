-- =============================================================================
-- WHAT THE THINKING WAS FOR
--
-- `ai_spend_reservations` records who pays for every model call: the product,
-- the founder, the model, the cents. Read against production it says that
-- fourteen dollars and eighty-eight cents were spent across one thousand and
-- ninety-nine calls, and that ten dollars and forty-five cents of it — seven
-- hundred per cent of a week's ceiling, seventy per cent of everything — was
-- Sonnet, on eight hundred and seventy-eight calls that name no purpose at all.
--
-- `purpose_kind`/`purpose_id` exist and are the right shape for what they do:
-- they link a call to an OBJECT, so what an opportunity cost to reason about can
-- sit beside what it cost to test. One hundred and fifty-two calls carry one.
-- But most calls have no such object — a briefing about a company, a gate
-- evaluation, a nightly synthesis — and forcing a made-up object id onto them
-- would add nothing over `product_id`, which is already here.
--
-- What is missing is simpler and is the owner's actual question: WHICH PIECE OF
-- WORK SPENT THIS. Not which row it points at, but what Foundry was doing.
--
-- So one column, naming the work from a closed vocabulary that lives in
-- `src/services/ai/what-it-is-for.ts` — closed so that adding a model call
-- means saying what it is for, and so the ledger can be grouped by something a
-- person can read. No new table, no new writer, no sampling, no tracing: the
-- row is already being written and gains one more field.
--
-- NULLABLE, because the eleven hundred rows already here cannot be attributed
-- after the fact and guessing would be worse than the gap. The type boundary
-- makes it impossible to write a new one without it; the old ones say what they
-- are, which is unattributed.
-- =============================================================================

ALTER TABLE ai_spend_reservations ADD COLUMN work TEXT;

-- Grouping the bill by what Foundry was doing, over a window. The date is first
-- because every reading of this table is "in the last N days".
CREATE INDEX IF NOT EXISTS idx_ai_spend_work ON ai_spend_reservations(date, work);
