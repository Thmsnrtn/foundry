-- =============================================================================
-- 392 — WHETHER THE HANDS MAY MAKE PRINTABLE FILES IS THE OWNER'S (PENDING 41).
--
-- The printable_pdf kind (services/venture/products/printable.ts) lets the
-- forge sell a file whose words a model wrote, inside a design system the
-- repository owns, printed by headless Chromium and refused at six gates.
-- Whether Foundry may make such files itself is the class of decision PENDING
-- 34 asks about for workbooks, and STRATEGY H52 refuses a universal factory.
-- So the institution's default is "not yet", as a 'policy' row: it binds no
-- offer verdict (policyVerdictsFor skips 'policy'), and only the owner's own
-- row, value 'yes', set through supersedeOriginationPolicy, turns it on.
-- =============================================================================
INSERT INTO origination_policy (id, founder_id, requirement, treatment, value, why, set_by) VALUES
  ('fec_make_printable_pdf', NULL, 'make_printable_pdf', 'policy', 'not_yet',
   'a printable file is made by the hands from a model''s words; whether Foundry may make and sell one without a person making it is the owner''s decision (PENDING 41)',
   'proof_program:first_economic_closure');
