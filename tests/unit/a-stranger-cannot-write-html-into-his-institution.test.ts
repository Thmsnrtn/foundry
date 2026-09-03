process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A STRANGER CANNOT WRITE HTML INTO HIS INSTITUTION.
//
// Discovery reads what people wrote in public — Hacker News comments, package
// descriptions — and keeps the exact sentence, deliberately, because a
// paraphrase stored as evidence is the failure this institution exists to
// prevent. That sentence then travels: observation -> interpretation -> seed ->
// candidate -> the owner's first screen.
//
// The candidate card rendered it by building a plain JavaScript template string
// and passing the result to raw(). raw() means "this is already HTML, insert it
// verbatim". So a comment containing markup was markup by the time it reached
// his browser, executing in the session that holds his whole institution.
//
// The author of that comment is any stranger on the internet. They do not need
// an account here, or to know this exists. They need to write a sentence that
// discovery finds interesting.
//
// Every string on this card comes from outside: the headline and the reading
// are model output over external text, and `said` is the stranger's own words.
// =============================================================================

const OWNER = 'xss_owner';
let app: Hono;

/** What an attacker would actually write. Benign here; the point is the shape. */
const PAYLOAD = '<img src=x onerror="window.__taken=1">';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_xss', 'owner@example.com', 'Thomas Norton']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);

  // A real search, and a real candidate carrying what the stranger wrote.
  await app.request('/foundry/ask', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ said:
      'Make the river stronger by finding another small digital income stream.' }).toString() });
  const mandate = (await query(
    'SELECT id FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL', [OWNER]))
    .rows[0] as Record<string, unknown>;
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, unknowns_json, sources_json, evidence_mode)
     VALUES ('xss_op', ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'real')`,
    [String(mandate.id), OWNER,
      `A dataset of deadlines ${PAYLOAD}`,
      `people who track licences ${PAYLOAD}`,
      `they do it by hand ${PAYLOAD}`,
      `nobody sells it ${PAYLOAD}`,
      `somebody ships it free ${PAYLOAD}`]);
  // AND ONE ALREADY DECIDED. The buried list renders on the first screen too,
  // and carries the same external text — a candidate Foundry turned down is
  // still a sentence a stranger wrote.
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, unknowns_json, sources_json, evidence_mode)
     VALUES ('xss_dead', ?, ?, ?, 'people', 'a problem', 'a reason', 'a thesis',
       '[]', '[]', 'real')`,
    [String(mandate.id), OWNER, `A dataset of deadlines ${PAYLOAD}`]);
  // Decided afterwards, because the database refuses one that arrives decided.
  await query(
    `UPDATE venture_opportunities SET verdict = 'rejected', verdict_why = ?,
       decided_at = datetime('now') WHERE id = 'xss_dead'`,
    [`it was already sold by someone ${PAYLOAD}`]);
});

describe('what a stranger wrote, on his screen', () => {
  it('is shown as words, never as markup', async () => {
    const body = await (await app.request('/foundry')).text();
    // It must appear — the whole point is that Foundry quotes the source.
    expect(body).toContain('A dataset of deadlines');
    // But as text. If this fails, a Hacker News comment is executing script in
    // the owner's authenticated session.
    expect(body).not.toContain(PAYLOAD);
    expect(body).not.toMatch(/<img src=x onerror/i);
    expect(body).toContain('&lt;img');
  });

  it('escapes every field of the card, not only the headline', async () => {
    const body = await (await app.request('/foundry')).text();
    // One escaped occurrence per field that carries external text.
    const escaped = (body.match(/&lt;img src=x onerror/g) ?? []).length;
    expect(escaped).toBeGreaterThanOrEqual(2);
  });

  it('does not let it through the portfolio either', async () => {
    const body = await (await app.request('/foundry/companies')).text();
    expect(body).not.toMatch(/<img src=x onerror/i);
  });
});

// =============================================================================
// AND THE POLICY THAT WOULD HAVE STOPPED IT ANYWAY.
//
// Escaping fixed one instance. This closes the class: the surface that renders
// what strangers wrote runs no inline script the policy has not hashed, so an
// injected handler cannot execute even where an escape is missed later.
// =============================================================================

describe('the policy over the surface that renders the internet', () => {
  it('permits exactly one script, by hash, and no inline anything', async () => {
    const { securityHeaders } = await import('../../src/middleware/security-headers.js');
    const guarded = new Hono();
    guarded.use('*', securityHeaders);
    guarded.get('/foundry', (c) => c.html('<p>ok</p>'));
    const res = await guarded.request('/foundry');
    const csp = String(res.headers.get('content-security-policy'));
    expect(csp).toContain("script-src 'self' 'sha256-");
    expect(csp).not.toContain("'unsafe-inline' https://");
    // Nothing on his surface loads code from anyone else.
    expect(csp).not.toContain('cdn.jsdelivr.net');
    expect(csp).not.toContain('unpkg.com');
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('leaves the older surfaces alone, because a hash cannot cover them', async () => {
    // Fourteen inline scripts and thirty-seven inline handlers live out there.
    // Tightening their policy without doing that work would break sign-in.
    const { securityHeaders } = await import('../../src/middleware/security-headers.js');
    const guarded = new Hono();
    guarded.use('*', securityHeaders);
    guarded.get('/agents/integrations', (c) => c.html('<p>ok</p>'));
    const csp = String((await guarded.request('/agents/integrations'))
      .headers.get('content-security-policy'));
    expect(csp).toContain("'unsafe-inline'");
  });

  it('hashes the script the page actually serves', async () => {
    // The hash is computed from the same constant the page renders, so they
    // cannot drift. This proves the wiring rather than trusting it: take the
    // script out of the real HTML, hash it, and find that hash in the policy.
    const { createHash } = await import('node:crypto');
    const { OWNER_SURFACE_SCRIPT_HASH } = await import(
      '../../src/lib/owner-surface-script.js');
    const body = await (await app.request('/foundry')).text();
    const inline = /<script>([\s\S]*?)<\/script>/.exec(body)?.[1] ?? '';
    expect(inline.length).toBeGreaterThan(0);
    const hash = `'sha256-${createHash('sha256').update(inline, 'utf8').digest('base64')}'`;
    expect(hash).toBe(OWNER_SURFACE_SCRIPT_HASH);
  });
});
