-- Migration 140: one canonical place for an integration's secret material.
--
-- WHAT THE PREVIOUS SESSION FOUND. Two founder-facing forms disagreed about
-- what a credential is. One encrypted everything that was not a named config
-- key into `credentials_json`; the other wrote EVERY submitted field into
-- `config_json` in the clear — api keys, bot tokens and auth tokens included.
-- Six sync adapters read their credential from `config_json`, so the path that
-- stored provider secrets in plaintext was the path that functioned, and the
-- path that encrypted them correctly produced integrations that silently never
-- synced.
--
-- The service layer was unified and the adapters repointed. A runtime fallback
-- was left reading `config_json` so existing installs would not break twice.
--
-- WHAT THIS DOES. Closes that fallback at the only layer that can close it for
-- good. A guard in a service is a rule the next service may not know about; a
-- guard in the schema is a rule about the column.
--
--   1. Move secret-shaped keys out of `config_json` and record which rows had
--      them, so an operator can be told exactly what to rotate.
--   2. Refuse any future write that puts a secret-shaped key in `config_json`.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It does not encrypt the moved values here.
-- SQLite has no access to the application's encryption key, and a migration
-- that pretended to encrypt would produce a column that LOOKS canonical and
-- holds plaintext — worse than the defect, because it would also be invisible.
-- The values are moved to a quarantine table, flagged for rotation, and the
-- application refuses to use them. A secret that has been in a plaintext column
-- is a secret that must be rotated, not relocated; treating relocation as a fix
-- is the reassurance failure this schema keeps having to unlearn.
--
-- THE ALLOW-LIST IS THE SAME ONE THE SERVICE USES. `NON_SECRET_CONFIG_KEYS` in
-- services/integration/fabric.ts holds it too, and a test asserts they never
-- drift. It is an allow-list, so a key nobody has classified is treated as a
-- secret — the fail-closed direction.

-- Quarantine, not a second credential store. Nothing reads these to
-- authenticate; they exist so an operator can be told what leaked and where.
CREATE TABLE integration_secret_quarantine (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  integration_name TEXT,
  -- The KEY only. The value is deliberately not copied here: this table exists
  -- to name what must be rotated, and a quarantine that stores the secret is
  -- just the plaintext column with a more reassuring name.
  secret_key     TEXT NOT NULL,
  quarantined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at     TEXT,
  UNIQUE(integration_id, secret_key)
);

CREATE INDEX idx_integration_secret_quarantine_product
  ON integration_secret_quarantine(product_id, rotated_at);

-- Record every secret-shaped key currently sitting in a plaintext config blob.
INSERT OR IGNORE INTO integration_secret_quarantine
  (id, product_id, integration_id, integration_name, secret_key)
SELECT
  lower(hex(randomblob(16))),
  i.product_id,
  i.id,
  i.name,
  k.key
FROM integrations i, json_each(COALESCE(i.config_json,'{}')) k
WHERE json_valid(COALESCE(i.config_json,'{}'))
  AND json_type(COALESCE(i.config_json,'{}')) = 'object'
  AND k.key NOT IN (
    'activation_event','active_user_event','team_id','host','account_id',
    'org_slug','project_slug','project_id','workspace','region','channel',
    'org','repo','owner','channel_id','workspace_id','base_url');

-- And remove them from the plaintext column. `json_remove` with no matching
-- path is a no-op, so a row with only legitimate config is untouched.
UPDATE integrations
SET config_json = (
  SELECT COALESCE(json_group_object(k.key, k.value), '{}')
  FROM json_each(COALESCE(integrations.config_json,'{}')) k
  WHERE k.key IN (
    'activation_event','active_user_event','team_id','host','account_id',
    'org_slug','project_slug','project_id','workspace','region','channel',
    'org','repo','owner','channel_id','workspace_id','base_url'))
WHERE json_valid(COALESCE(config_json,'{}'))
  AND json_type(COALESCE(config_json,'{}')) = 'object'
  AND EXISTS (
    SELECT 1 FROM json_each(COALESCE(integrations.config_json,'{}')) k2
    WHERE k2.key NOT IN (
      'activation_event','active_user_event','team_id','host','account_id',
      'org_slug','project_slug','project_id','workspace','region','channel',
      'org','repo','owner','channel_id','workspace_id','base_url'));

-- From here on the column cannot hold a secret-shaped key at all.
--
-- Every predicate coalesces its absence: a guard whose condition evaluates to
-- NULL never fires, which is how missing values have repeatedly walked past
-- guards in this schema.
CREATE TRIGGER integration_config_no_secrets_insert
BEFORE INSERT ON integrations
WHEN COALESCE(json_valid(NEW.config_json),0)=1
 AND COALESCE(json_type(NEW.config_json),'absent')='object'
BEGIN
  SELECT RAISE(ABORT,'integration_config:secret_in_plaintext') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.config_json) k
    WHERE COALESCE(k.key,'') NOT IN (
      'activation_event','active_user_event','team_id','host','account_id',
      'org_slug','project_slug','project_id','workspace','region','channel',
      'org','repo','owner','channel_id','workspace_id','base_url'));
END;

CREATE TRIGGER integration_config_no_secrets_update
BEFORE UPDATE OF config_json ON integrations
WHEN COALESCE(json_valid(NEW.config_json),0)=1
 AND COALESCE(json_type(NEW.config_json),'absent')='object'
BEGIN
  SELECT RAISE(ABORT,'integration_config:secret_in_plaintext') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.config_json) k
    WHERE COALESCE(k.key,'') NOT IN (
      'activation_event','active_user_event','team_id','host','account_id',
      'org_slug','project_slug','project_id','workspace','region','channel',
      'org','repo','owner','channel_id','workspace_id','base_url'));
END;
