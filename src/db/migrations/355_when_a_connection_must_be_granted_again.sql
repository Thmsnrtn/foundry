-- =============================================================================
-- WHEN A CONNECTION MUST BE GRANTED AGAIN.
--
-- An access token that lasts an hour is renewed every hour. What renews it is
-- the refresh token, and a provider may give that its own life: Etsy gives it
-- ninety days. If the provider hands back a fresh one on each renewal, the
-- connection lives as long as it is used. If not, it ends on a date fixed when
-- the owner connected, and the first sign was going to be a failed renewal and
-- a shop gone dark.
--
-- NULL means no end is known: the provider set none, or nothing has said so.
-- It is set at the grant, moved only when the provider actually hands back a
-- different refresh token, and read by the Brief two weeks ahead.
-- =============================================================================

ALTER TABLE sense_credentials ADD COLUMN refresh_expires_at TEXT;
