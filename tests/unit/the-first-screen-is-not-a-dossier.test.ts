process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE FIRST SCREEN IS NOT A DOSSIER.
//
// A rehearsal search produces four candidates, and every one of them rendered
// its entire case on the first screen: who has the problem, why it might work,
// how it earns, what it would cost him in attention, its legal surface, what
// it would take to build, its kill thesis, what has been checked and what is
// unknown. A hundred and eleven lines.
//
// Not one of those four was asking him for anything. All of them said "not
// yet". The first screen is for what needs him; work in progress is a count.
//
// This also makes the opportunity surface reachable at all. The reference world
// had seven invented companies and no invented search, so the one surface where
// an enormous amount of research is supposed to collapse into a single decision
// could only be seen by a real candidate surviving real evidence — which has
// never happened, and should not be rushed to make a screen viewable.
// =============================================================================

const OWNER = 'dossier_owner';
let app: Hono;

function lines(html: string): number {
  return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).length;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_dossier', 'owner@example.com', 'Thomas Norton']);
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

describe('a search he can watch before he has a real one', () => {
  it('is offered where the rest of the invented world already lives', async () => {
    const body = await (await app.request('/foundry/companies')).text();
    expect(body).toContain('/foundry/reference/search');
  });

  it('produces real candidates through the real machinery', async () => {
    const res = await app.request('/foundry/reference/search',
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '' });
    expect(res.status).toBe(302);
    const n = (await query('SELECT COUNT(*) AS n FROM venture_opportunities'))
      .rows[0] as Record<string, unknown>;
    expect(Number(n.n)).toBeGreaterThan(0);
  });

  it('can never be mistaken for a search he asked for', async () => {
    // The one thing the reference world exists to prevent.
    const body = await (await app.request('/foundry')).text();
    expect(body).toContain('A search I made up');
    expect(body).toContain('You did not ask for this one');
    expect(body).not.toContain('<h3>What I am looking for</h3>');
  });

  it('refuses to displace a real search', async () => {
    const res = await app.request('/foundry/reference/search',
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '' });
    expect(res.headers.get('location')).toContain('alreadylooking');
    const n = (await query('SELECT COUNT(*) AS n FROM venture_mandates WHERE closed_at IS NULL'))
      .rows[0] as Record<string, unknown>;
    expect(Number(n.n)).toBe(1);
  });
});

describe('what the first screen does with four candidates', () => {
  it('shows the case only for the one that is asking him to act', async () => {
    const body = await (await app.request('/foundry')).text();
    // Exactly one dossier, and it is the one recommending a decision. The
    // other three said "not yet" and are a sentence instead.
    // The facts became a description list — <dt>/<dd> — when the dossier was
    // given a real structure a screen reader can hear. This regex still looked
    // for <b>/<span> and therefore found nothing, which reads identically to
    // "no candidate is recommending anything" and is why it went unnoticed.
    const shown = [...body.matchAll(/<dt>I recommend<\/dt><dd>([^<]{0,120})/g)]
      .map((m) => m[1] ?? '');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/Take it forward|Run the test/);
  });

  it('keeps the ones that are not asking for anything off the screen', async () => {
    const body = await (await app.request('/foundry')).text();
    // These headlines all recommended "not yet". Their dossiers are what made
    // the screen a hundred and eleven lines deep while nothing needed him.
    expect(body).not.toContain('Shift handover for independent veterinary practices');
    expect(body).not.toContain('paid-search arbitrage');
  });

  it('says how many it is working through, and that none has earned him', async () => {
    const body = await (await app.request('/foundry')).text();
    expect(body).toMatch(/working through\s+\d+ possibilit/);
    expect(body).toContain('earned your attention yet');
  });

  it('stays a first screen rather than a filing cabinet', async () => {
    const body = await (await app.request('/foundry')).text();
    // One opportunity genuinely needs him, so its case is here and the screen
    // earns its length. Before this it carried four cases and needed none.
    expect(lines(body)).toBeLessThan(70);
  });
});
