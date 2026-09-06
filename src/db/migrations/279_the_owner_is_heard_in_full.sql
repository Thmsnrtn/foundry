-- =============================================================================
-- THE OWNER'S GUIDANCE REACHES THE SEARCH, WITHOUT NAMING A SHAPE
--
-- What he said held the candidates to account after they were found, and never
-- shaped where the search looked. "Require almost none of my attention" was
-- read as part of "keep legal risk low", so only the legal preference was
-- heard; and his two mandate sentences were read as two mandates, the second
-- silently dropped. This migration gives the search a constitutional
-- vocabulary of what to look for when he says what he wants — phrases about
-- the WORK people describe, never about a product form — and records on each
-- brief where its terms came from, so a barren search can be told from a
-- search that never heard him.
-- =============================================================================

CREATE TABLE search_emphasis (
  id             TEXT PRIMARY KEY,
  -- The guidance this phrase answers: the dimension and kind the reader files.
  dimension      TEXT NOT NULL,
  guidance_kind  TEXT NOT NULL CHECK (guidance_kind IN ('avoid','prefer')),
  -- The subject the guidance names, or NULL for any subject on that dimension.
  subject        TEXT,
  -- The words people use when describing the work this preference points at.
  -- About effort and situation, never about what might be sold to them.
  phrase         TEXT NOT NULL,
  why            TEXT NOT NULL,
  sort_order     INTEGER NOT NULL
);
CREATE INDEX idx_search_emphasis_dimension ON search_emphasis(dimension, guidance_kind);
INSERT INTO search_emphasis (id, dimension, guidance_kind, subject, phrase, why, sort_order) VALUES
  ('se_attention_1', 'owner_attention', 'prefer', NULL, 'set it up once and forgot about it',
   'work somebody did once and never again is work that needs nobody', 1),
  ('se_attention_2', 'owner_attention', 'prefer', NULL, 'runs itself without me',
   'the same, said the way people say it', 2),
  ('se_attention_3', 'owner_attention', 'prefer', NULL, 'only have to touch it once a year',
   'attention front-loaded, then almost none', 3),
  ('se_legal_1', 'legal_exposure', 'prefer', NULL, 'pay once and download',
   'a one-off purchase of a file collects nothing and promises nothing ongoing', 4),
  ('se_legal_2', 'legal_exposure', 'prefer', NULL, 'no signup just want the',
   'people resenting an account are people who would pay to skip one', 5),
  ('se_legal_3', 'legal_exposure', 'prefer', NULL, 'nothing to install nothing to log into',
   'the lightest architecture, in the words of somebody wanting it', 6),
  ('se_support_1', 'support_burden', 'prefer', NULL, 'never needed to contact support',
   'a thing that works without help is a thing that asks for none', 7),
  ('se_support_2', 'support_burden', 'prefer', NULL, 'explains itself',
   'the same, said the way people say it', 8),
  ('se_subscription_1', 'revenue_model', 'avoid', 'subscription', 'would pay once for',
   'people who resent a subscription say what they would pay once for', 9),
  ('se_subscription_2', 'revenue_model', 'avoid', 'subscription', 'sick of another monthly',
   'the resentment itself is the signal', 10),
  ('se_business_1', 'customer_type', 'prefer', 'businesses', 'our team keeps',
   'work described as a team''s is work a business pays for', 11),
  ('se_business_2', 'customer_type', 'prefer', 'businesses', 'at work we still',
   'the same, said the way people say it', 12),
  ('se_consumer_1', 'customer_type', 'prefer', 'consumers', 'for my own use I',
   'work described as one person''s is work a person pays for', 13),
  ('se_acquisition_1', 'acquisition_channel', 'avoid', 'paid acquisition', 'found it through a friend',
   'things that spread by hand do not need buying attention', 14),
  ('se_ticket_high_1', 'pricing_model', 'prefer', 'higher ticket', 'would happily pay a few hundred',
   'a price people volunteer is a price they would pay', 15),
  ('se_ticket_low_1', 'pricing_model', 'prefer', 'lower ticket', 'would pay a few dollars for',
   'the same, at the other end', 16);
CREATE TRIGGER search_emphasis_constitutional_insert
BEFORE INSERT ON search_emphasis
BEGIN SELECT RAISE(ABORT,'search_emphasis:constitutional'); END;
CREATE TRIGGER search_emphasis_constitutional_update
BEFORE UPDATE ON search_emphasis
BEGIN SELECT RAISE(ABORT,'search_emphasis:constitutional'); END;
CREATE TRIGGER search_emphasis_constitutional_delete
BEFORE DELETE ON search_emphasis
BEGIN SELECT RAISE(ABORT,'search_emphasis:constitutional'); END;

-- WHERE THE TERMS CAME FROM: what the portfolio lacks, what he said, or the
-- shape he named — so the record shows whether a search ever heard him.
ALTER TABLE search_briefs ADD COLUMN terms_from TEXT;
