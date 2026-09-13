process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// ONE THING TO PRESS, IN EVERY STATE HE CAN REACH.
//
// The rule — one card that needs him, one primary button — was asserted by a
// test whose fixture had no search running, no company named in the ask bar and
// nothing else in flight. It passed because the state it examined was the
// simplest one. In the states the owner actually reaches, four independent
// branches could each emit a primary button, and the card that needed nothing
// carried the only accent border while the decision was rendered last, below
// ninety lines of search.
//
// This drives the page into the busiest state it has and asserts the rule
// there, which is the only place the rule was ever needed.
// =============================================================================

const OWNER = 'press_state_owner';
let app: Hono;

function primaries(body: string): number {
  return (body.match(/class="btn go"/g) ?? []).length;
}
function decisionCards(body: string): number {
  return (body.match(/class="one(?: alert)?"/g) ?? []).length;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_press_state', 'owner@example.com', 'Thomas Norton']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
});

describe('the busiest screen he can reach', () => {
  it('keeps one primary action with a rehearsal search running', async () => {
    // One tap from the Portfolio page, and it produces four candidates, one of
    // which recommends taking it forward.
    await app.request('/foundry/reference/search', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
    const body = await (await app.request('/foundry')).text();
    expect(body).toContain('A search I made up');
    expect(primaries(body), 'one place to press, never two').toBeLessThanOrEqual(1);
  });

  it('keeps one decision card with a candidate and a company answer on screen', async () => {
    await app.request('/foundry/companies', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Tidewater' }).toString() });
    const body = await (await app.request('/foundry?q=How is Tidewater doing?')).text();
    expect(decisionCards(body), 'one card that needs him, never two')
      .toBeLessThanOrEqual(1);
    expect(primaries(body), 'one place to press, never two').toBeLessThanOrEqual(1);
  });

  it('puts what needs him above what does not', async () => {
    const body = await (await app.request('/foundry')).text();
    const search = body.indexOf('A search I made up');
    const decision = body.search(/class="one(?: alert)?"/);
    if (decision === -1) return; // nothing needs him in this state; nothing to order
    expect(decision, 'the decision comes first').toBeLessThan(search);
  });

  it('gives the attention border to the thing that needs him and nothing else', async () => {
    // THE STYLESHEET IS A FILE NOW, so the rule is read where it lives rather
    // than scraped out of the page. And the border is gold: the one colour the
    // surface reserves for owner attention and consequence, used here and on
    // nothing that merely contains information.
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/public/owner.css', 'utf8');
    const rule = (sel: string): string => css.slice(css.indexOf(`\n${sel}{`), css.indexOf('}', css.indexOf(`\n${sel}{`)));
    expect(rule('.one')).toContain('border:1px solid var(--alert)');
    for (const quiet of ['.tile', '.item', '.hero', '.noticed', '.done', '.layer']) {
      expect(rule(quiet), `${quiet} carries no attention border`).toContain('border:1px solid var(--line)');
    }
    // And the page links the file it depends on.
    const body = await (await app.request('/foundry')).text();
    expect(body).toContain('href="/static/owner.css"');
  });
});
