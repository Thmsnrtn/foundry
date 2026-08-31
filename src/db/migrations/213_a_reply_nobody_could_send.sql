-- =============================================================================
-- Migration 213: the inter-agent response protocol nothing used
--
-- `agent_messages` carried four columns for a request-and-answer loop between
-- agents: `requires_response`, `response_deadline`, `responded_at`,
-- `response_id`. None of them was ever filled with anything meaningful.
--
--   NOBODY ASKED. `sendMessage` took `requiresResponse` and
--   `responseDeadlineHours`, and no caller in the codebase has ever passed
--   either — so `requires_response` was 0 and `response_deadline` NULL on every
--   message ever sent.
--
--   NOBODY COULD ANSWER. `responded_at` and `response_id` had exactly one
--   writer, `replyToMessage`, which had no caller anywhere: not an agent, not a
--   route, not a job.
--
--   AND THE DASHBOARD DREW BOTH. The message bus page showed an "Unanswered"
--   card counting `requires_response = 1 AND responded_at IS NULL` — a number
--   that could only ever be zero — and a "⏳ Response requested" badge that
--   could never render.
--
-- So this is not a feature with a gap; it is four columns, one function and two
-- pieces of interface for a loop that has never had a sender OR a replier. They
-- go together. If agents are to ask each other for answers, that is a real
-- mechanism — who asks, who is obliged to answer, what happens at the deadline
-- — and it comes back whole.
--
-- SQLite drops a column in place when no index or trigger references it. The
-- four indexes on this table are on `product_id`, `to_agent`, `from_agent`,
-- `read_at` and `thread_id`; there are no triggers.
-- =============================================================================

ALTER TABLE agent_messages DROP COLUMN requires_response;
ALTER TABLE agent_messages DROP COLUMN response_deadline;
ALTER TABLE agent_messages DROP COLUMN responded_at;
ALTER TABLE agent_messages DROP COLUMN response_id;
