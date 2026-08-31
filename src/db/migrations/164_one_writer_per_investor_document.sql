-- =============================================================================
-- Migration 164: one writer per investor document
--
-- `board_packets` HAD TWO WRITERS WITH DISJOINT COLUMNS, and so did
-- `investor_updates`.
--
--   /board      → services/scp/investor/    writes `narrative_json`
--   /investors  → services/investor/        writes `executive_summary`,
--                                           `signal_narrative`, `mrr_narrative`,
--                                           `cohort_narrative`,
--                                           `competitive_narrative`, …
--
-- Both routes were mounted. Both listed the same table. So a packet generated
-- on one surface appeared on the other as a document with a title, a quarter,
-- and every section empty — because the columns that surface renders were
-- never filled by the generator that wrote the row. Nothing was broken enough
-- to raise; each half worked perfectly on its own rows and rendered the
-- other's as a quiet quarter.
--
-- `investor_updates` was the same split with a sharper edge: the API path
-- (`POST /api/products/:id/investor-update`) never set `month`, and every
-- dashboard read keys on it — `WHERE product_id=? AND month=?` for the
-- duplicate check, `ORDER BY month DESC` for the list. Updates created through
-- the API were therefore invisible to the surface that shows them AND invisible
-- to the check that stops a second one being generated for the same month.
--
-- THE SCP SURFACE IS CANONICAL. Not by preference: `/board` is what the
-- navigation points at, in both the sidebar ("Investor Board") and the tab bar
-- ("Investor Hub"). `/investors` appears in no navigation at all. One is the
-- product; the other is the projection that was left behind.
--
-- So the legacy writers are gone and the rows they wrote are migrated into the
-- canonical shape rather than abandoned in it. The prose columns have no
-- structured slot in `BoardPacketNarrative` and are NOT scattered into `wins`
-- or `risks`, which they were never written as — they are carried, labelled,
-- inside the executive summary, which is where a reader will actually find
-- them. The columns stay on the table: dropping them would destroy the only
-- copy of anything this backfill got wrong, and they cost nothing empty.
-- =============================================================================

-- Board packets written in the legacy shape become readable by the canonical
-- reader. `json_object` builds the same structure `parseJSON` expects, with
-- the empty collections the narrative type declares.
--
-- THE EMPTY ONE IS `{}`, NOT NULL. `narrative_json` is NOT NULL DEFAULT '{}',
-- so a row that has no narrative carries an empty object rather than an absent
-- one — and the canonical reader's `parseJSON(row.narrative_json, {…})` only
-- falls back to its default when parsing FAILS. `{}` parses perfectly, so
-- every field came back undefined and the page rendered a packet with no
-- sections. Matching on IS NULL here would have skipped every row this
-- migration exists for.
UPDATE board_packets
   SET narrative_json = json_object(
         'executive_summary',
         TRIM(
           COALESCE(executive_summary, '')
           || CASE WHEN COALESCE(signal_narrative, '') <> ''
                   THEN char(10) || char(10) || 'Signal & health: ' || signal_narrative ELSE '' END
           || CASE WHEN COALESCE(mrr_narrative, '') <> ''
                   THEN char(10) || char(10) || 'Revenue: ' || mrr_narrative ELSE '' END
           || CASE WHEN COALESCE(cohort_narrative, '') <> ''
                   THEN char(10) || char(10) || 'Cohorts: ' || cohort_narrative ELSE '' END
           || CASE WHEN COALESCE(competitive_narrative, '') <> ''
                   THEN char(10) || char(10) || 'Competitive: ' || competitive_narrative ELSE '' END
           || CASE WHEN COALESCE(next_quarter_focus, '') <> ''
                   THEN char(10) || char(10) || 'Next quarter: ' || next_quarter_focus ELSE '' END
         ),
         'key_metrics', json('[]'),
         'wins', json('[]'),
         'risks', json('[]'),
         'asks', json('[]'),
         'next_quarter_goals', json('[]'),
         'agent_insights', json('[]')
       )
 WHERE COALESCE(narrative_json, '') IN ('', '{}')
   AND COALESCE(executive_summary, '') <> '';

-- Investor updates created through the API never carried the month every
-- dashboard read keys on. `period` is the same value under the older name.
UPDATE investor_updates
   SET month = period
 WHERE month IS NULL
   AND period IS NOT NULL;

-- And the canonical reader reads `draft_text`; the legacy writer filled
-- `content`. They are the same document.
UPDATE investor_updates
   SET draft_text = content
 WHERE COALESCE(draft_text, '') = ''
   AND COALESCE(content, '') <> '';
