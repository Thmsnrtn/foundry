-- =============================================================================
-- Migration 184: a website the founder gave us and we could not recall
--
-- Onboarding asks a founder for their website. The answer went into
-- `web_audit_results` as a bare row — url plus ids, every analysis column NULL —
-- and `products` has no website column at all, only `github_repo_url`. Nothing
-- reads `web_audit_results`. So the founder volunteered a plain fact about
-- their company and the institution could not afterwards say what it was.
--
-- The audit that would fill those columns, `runWebAudit`, is reachable only
-- through `routes/api/tier2.ts` — part of the clientless API that frontier item
-- 2 covers — so a row written at onboarding was never going to become an audit
-- either. A table named for audit results held a URL and nothing else.
--
-- A company's website belongs with the company. `products.website_url` is where
-- it goes, beside the repository URL that the settings page already shows, and
-- the settings page shows this one too — so the fact is recoverable by the
-- person who supplied it, which is the whole test it was failing.
--
-- `web_audit_results` keeps its purpose: real audit output, when an audit runs.
-- It stays on the unread-tables baseline until something reads that output,
-- which is item 2's decision to make, not this migration's.
-- =============================================================================

ALTER TABLE products ADD COLUMN website_url TEXT;

-- Carry across anything already recorded. There is no production data today, so
-- this is expected to move nothing — but a column changing homes without
-- bringing its contents is how a fact gets lost twice.
UPDATE products SET website_url = (
  SELECT w.url FROM web_audit_results w
   WHERE w.product_id = products.id AND w.url IS NOT NULL
   ORDER BY w.created_at DESC LIMIT 1
) WHERE website_url IS NULL;
