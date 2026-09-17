-- =============================================================================
-- THE WORKSHOP SPEAKS FOR ITSELF
--
-- The owner is not a public figure. The Workshop's founding statement was
-- written in the first person and named him; it was inserted into the row at
-- founding and never read from code again, so changing the constant would
-- leave the live site saying what he asked it not to. This brings a Workshop
-- founded under the earlier text into line, and touches no other row: a
-- statement he has since written in his own words is his.
-- =============================================================================
UPDATE public_workshop
   SET statement = 'Apex Micro is a small digital workshop in Massachusetts. It builds practical, niche things, tries them out in the real world, and keeps working on the ones that turn out to be useful.' || char(10) || char(10)
                || 'Software built here does a lot of the research and the day-to-day running. A person is responsible for all of it and answers every message. Each thing says what it costs, what you get and what it doesn''t cover. The ones that don''t work get closed, and their page stays up saying so.',
       updated_at = datetime('now')
 WHERE public_name = 'Apex Micro' AND statement LIKE '%I''m Thomas Norton%';
