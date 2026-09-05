-- THE ENDPOINT ANSWERED.
--
-- Everything recorded about this substrate so far was read from a vendor page.
-- A page can be out of date, aspirational, or describe a product tier nobody
-- has. This is the one fact that was not read: the adapter, under test with a
-- deliberately invalid token, reached `POST https://api.sprites.dev/v1/sprites`
-- and got HTTP 401 with a JSON error body.
--
-- That is weak evidence and it is the right kind. It does not show a sprite can
-- be created, that the filesystem persists, or that anything costs what it is
-- said to. It shows the host resolves, the path exists, and the service rejects
-- an unauthenticated caller rather than ignoring it — which is more than any
-- documentation can establish, and exactly the sort of thing this institution
-- is supposed to distinguish from a claim.

INSERT INTO substrate_evaluations (id, substrate, property, finding, source) VALUES
  ('fly_sprites:reachable', 'fly_sprites', 'endpoint reachable',
   'POST https://api.sprites.dev/v1/sprites answered HTTP 401 with a JSON error '
   || 'to a deliberately invalid bearer token — the host resolves, the path '
   || 'exists, and it rejects rather than ignores. Not evidence that anything '
   || 'can be created',
   'observed by the adapter under test, 2026-09-05'),
  ('fly_sprites:access boundary', 'fly_sprites', 'access boundary',
   'needs SPRITE_TOKEN, obtained by authorizing a Fly organisation. Whether '
   || 'that is covered by the Fly relationship this institution already runs on, '
   || 'or is new spend and a new billing relationship, is a fact about the '
   || 'owner''s account that cannot be read from here',
   'https://fly.io/sprites/ (read 2026-09-05) and the absence of a readable '
   || 'account fact');
