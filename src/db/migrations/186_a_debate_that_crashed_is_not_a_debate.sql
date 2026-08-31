-- =============================================================================
-- A DEBATE THAT CRASHED IS NOT A DEBATE.
--
-- Two findings, one table and one word.
--
-- 1. `agent_positions` was a shadow of `debate_sessions.positions_json` and
--    `conflicts_json`. Every assertion was written to both; every challenge was
--    written to both. Only the JSON columns are read — by the debate dashboard,
--    which is the only surface there is.
--
--    The shadow was also wrong in a way the original is not. The challenger did
--    not mark the assertion it challenged; it INSERTED A SECOND ROW carrying the
--    same assertion text with `challenged_by='challenger'`. So the challenged
--    assertion appeared twice, once looking unchallenged, and the original row's
--    `challenged_by` / `challenge_response` columns — the entire point of the
--    schema — were never once populated. `position_type` promised
--    'assertion' | 'recommendation' | 'risk_flag' and only ever held the first.
--
--    A copy nobody reads cannot be found to be wrong. This one was wrong for
--    however long it existed. It goes; the read path stays.
--
-- 2. When the debate threw, the catch block set `status = 'complete'`.
--
--    The dashboard paints 'complete' as a green "Complete" badge, and the list
--    view shows the session beside a conflict count that a crashed run leaves at
--    zero. So "the agents debated and nobody disagreed" and "the debate crashed
--    before the synthesizer answered" rendered as the same green row. The
--    failure text existed — "Debate synthesis failed." — inside the card headed
--    "Unified Synthesis", styled as a result.
--
--    `status` gains 'failed'. Existing rows written by that catch block are
--    identifiable exactly: it is the only writer of that executive summary.
-- =============================================================================

DROP TABLE IF EXISTS agent_positions;

UPDATE debate_sessions
   SET status = 'failed'
 WHERE status = 'complete'
   AND synthesis_json IS NOT NULL
   AND json_valid(synthesis_json)
   AND json_extract(synthesis_json, '$.executiveSummary') = 'Debate synthesis failed.';
