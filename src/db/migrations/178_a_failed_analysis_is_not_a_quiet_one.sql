-- =============================================================================
-- Migration 178: a transcript whose analysis failed should not look like one
-- that has not been analysed yet
--
-- `analyzeTranscript` ends:
--
--     } catch (err) {
--       console.error('[transcripts] analyzeTranscript error:', err);
--     }
--
-- and all three of its live callers — the Fathom webhook, the Fireflies
-- webhook, and the manual upload page — wrap it in `.catch(() => {})`. So a
-- failure is swallowed twice and lands in a console line nobody reads.
--
-- The consequence is not that a log is missing. It is that `processed_at IS
-- NULL` means BOTH "analysis has not run yet" and "analysis ran and failed",
-- and nothing can tell them apart. A founder opens a call and sees no summary
-- and no insights; there is no state in which Foundry says it tried. This is
-- the same shape as a credential that authenticates and has every request
-- thrown away, and as a support channel whose drops looked like a quiet inbox:
-- a failure that is indistinguishable from a calm state.
--
-- It also spends money to get there. `callSonnet` reserves against the AI
-- ceilings before dispatch, so a model call that succeeded and then failed to
-- parse has cost the company and left nothing behind.
--
-- WHAT IS RECORDED IS THE SHAPE, NEVER THE CONTENT — the same discipline as
-- migration 170. A transcript is customer speech and a model's failure output
-- may quote it; none of that lands here. The reason is a closed vocabulary this
-- system owns, enforced by CHECK rather than convention, so a future caller
-- cannot write free text into it with a convenient error string to hand.
-- =============================================================================

ALTER TABLE call_transcripts ADD COLUMN analysis_failed_at DATETIME;

ALTER TABLE call_transcripts ADD COLUMN analysis_failure_reason TEXT
  CHECK (analysis_failure_reason IS NULL OR analysis_failure_reason IN (
    -- There was nothing to read. Not a failure of the analysis so much as of
    -- what arrived, and the founder should see which.
    'transcript_empty',
    -- The model call did not return. Reserved spend is released by the client.
    'model_unavailable',
    -- It returned something that is not JSON. The spend is already made.
    'response_unparseable',
    -- It returned JSON that the bounding refused. Also already paid for.
    'response_out_of_bounds',
    -- The analysis was fine and the write was not.
    'could_not_store'
  ));

-- A row cannot be both analysed and failed. Success clears the failure and
-- failure clears nothing else; asserting it here means the two columns cannot
-- drift into a state no reader knows how to render.
CREATE TRIGGER IF NOT EXISTS transcript_analysis_state_coherent
BEFORE UPDATE ON call_transcripts
WHEN NEW.processed_at IS NOT NULL AND NEW.analysis_failed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'call_transcript:analysed_and_failed');
END;

-- The failure needs a reason and a reason needs a failure. Either alone is a
-- half-written record, and the page reads both.
CREATE TRIGGER IF NOT EXISTS transcript_failure_has_a_reason
BEFORE UPDATE ON call_transcripts
WHEN (NEW.analysis_failed_at IS NULL) <> (NEW.analysis_failure_reason IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'call_transcript:failure_incomplete');
END;
