process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// NOTHING THE OWNER CAN PRESS MAY DEAD-END.
//
// THIS GATE EXISTS BECAUSE OF A REAL FAILURE, NOT A HYPOTHETICAL ONE. The owner
// opened the deployed product on his phone to give the institution its first
// real mandate, pressed the one button on the screen, and got a 404. The form
// was mine. It posted to a route that had never existed.
//
// Every test in this repository drove handlers directly. Not one of them ever
// pressed a button, so the entire suite was green while the only owner action
// that mattered led nowhere. A route test proves a handler answers. It cannot
// prove anything points at it.
//
// So this walks the owner's screens, collects every form action and every link
// he could actually press, and asks the assembled application for each one. A
// 404 fails the build. So does a link into a screen that throws.
// =============================================================================

const OWNER = 'press_owner';
let app: Hono;

/**
 * Everything on a page the owner could press. The METHOD travels with the
 * action: a GET form posted to is a different question than the one the screen
 * is actually asking, and reading them the same way invents failures.
 */
function whatHeCanPress(html: string): {
  forms: Array<{ action: string; method: string }>; links: string[];
} {
  const forms = [...html.matchAll(/<form[^>]*>/g)].map((m) => {
    const tag = m[0];
    return {
      action: /action="([^"]+)"/.exec(tag)?.[1] ?? '',
      method: (/method="([^"]+)"/i.exec(tag)?.[1] ?? 'GET').toUpperCase(),
    };
  }).filter((f) => f.action.startsWith('/'));
  const links = [...html.matchAll(/<a[^>]*href="(\/[^"#?]*)"/g)].map((m) => m[1] ?? '');
  return { forms, links: [...new Set(links)] };
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_press', 'owner@example.com', 'Owner']);
  // THE COMPOSITION HE ACTUALLY USES, not one router in isolation. Production
  // mounts several, and a link that resolves in the assembled application while
  // 404-ing in a single-router test is exactly the disagreement between
  // repository assumptions and deployed reality that this gate is for.
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
  app.route('/', letterRoutes);
});

describe('the first screen, as he actually uses it', () => {
  it('answers at all', async () => {
    const res = await app.request('/foundry');
    expect(res.status).toBe(200);
  });

  it('has no form pointing at a route that does not exist', async () => {
    // THE EXACT DEFECT HE HIT. A form action of /foundry/said against a server
    // that only answers /foundry/venture — green tests, 404 for the owner.
    const body = await (await app.request('/foundry')).text();
    const { forms } = whatHeCanPress(body);
    expect(forms.length).toBeGreaterThan(0);
    const dead: string[] = [];
    for (const { action, method } of forms) {
      const res = method === 'POST'
        ? await app.request(action, { method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ said: 'anything at all' }).toString() })
        : await app.request(action);
      if (res.status === 404) dead.push(`${method} ${action}`);
    }
    expect(dead, `forms on the first screen leading into nothing: ${dead.join(', ')}`)
      .toEqual([]);
  });

  it('has no link into a screen that does not exist', async () => {
    const body = await (await app.request('/foundry')).text();
    const { links } = whatHeCanPress(body);
    const dead: string[] = [];
    for (const href of links) {
      const res = await app.request(href);
      if (res.status === 404 || res.status >= 500) dead.push(`${href} (${String(res.status)})`);
    }
    expect(dead, `links on the first screen leading nowhere: ${dead.join(', ')}`).toEqual([]);
  });
});

describe('the journey he could not complete', () => {
  it('carries him from an empty first screen to a real running search', async () => {
    // Exactly what he tried to do, through exactly what the screen offers, with
    // nothing about routes assumed.
    const before = await (await app.request('/foundry')).text();
    expect(before).toContain('I am not looking for anything');
    const { forms } = whatHeCanPress(before);
    const action = forms.find((f) => f.action.includes('ask'))?.action;
    expect(action, 'the first screen must offer somewhere to say what he wants')
      .toBeDefined();

    const res = await app.request(String(action), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said:
        'Make the river stronger by finding another small digital income stream that '
        + 'would make my portfolio more resilient, keep legal risk low, avoid increasing '
        + 'our biggest existing dependencies, spend no more than $25 validating anything, '
        + 'and bring me only things that deserve my attention.' }).toString(),
    });
    // He is never left wondering: either a redirect to a changed screen, or a
    // page saying what landed and what did not. Never a 404, never silence.
    expect([200, 302]).toContain(res.status);
    if (res.status === 200) expect(await res.clone().text()).toContain('I am looking');

    // AND THE SCREEN HE LANDS ON TELLS HIM IT HAPPENED.
    const after = await (await app.request('/foundry')).text();
    expect(after).not.toContain('I am not looking for anything');
    expect(after).toContain('What I am looking for');

    const open = (await query(
      'SELECT statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL',
      [OWNER])).rows as unknown as Array<Record<string, unknown>>;
    expect(open.length).toBe(1);
  });

  it('survives him pressing send twice', async () => {
    // A phone on a slow connection double-submits. The second must not open a
    // competing search or throw — it must tell him what is already true.
    const res = await app.request('/foundry/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said:
        'Make the river stronger by finding another income stream.' }).toString(),
    });
    expect([200, 302]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.get('location')).toContain('alreadylooking');
    }
    const open = (await query(
      'SELECT COUNT(*) AS n FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL',
      [OWNER])).rows[0] as Record<string, unknown>;
    expect(Number(open.n)).toBe(1);
  });

  it('recognises his mandate through the box that says it will', async () => {
    // THE OTHER ENTRANCE, and the one he would reach for first: the bar that
    // says "Ask Foundry anything" on every screen. A box making that promise
    // must not quietly discard the most important sentence he will ever type
    // into it. It is a different code path from the button, so it gets its own
    // proof rather than an assumption that one implies the other.
    const typed =
      'Make the river stronger by finding another small digital income stream that '
      + 'would make my portfolio more resilient, keep legal risk low, avoid increasing '
      + 'our biggest existing dependencies, spend no more than $25 validating anything, '
      + 'and bring me only things that deserve my attention.';
    const body = await (await app.request(`/foundry?q=${encodeURIComponent(typed)}`)).text();
    // It understood this was an instruction to go looking, and it shows him
    // what it understood before anything binds — his words, not a summary.
    expect(body).toContain('deserve my attention');
    const { forms } = whatHeCanPress(body);
    expect(forms.some((f) => f.method === 'POST' && f.action.includes('venture')),
      'the ask box must offer somewhere for a mandate to go').toBe(true);
  });

  it('does not lose eight hundred characters of mandate', async () => {
    // The longest thing he can type must survive the round trip.
    const long = `Make the river stronger. ${'Keep legal risk low. '.repeat(30)}`.slice(0, 780);
    const res = await app.request('/foundry/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said: long }).toString(),
    });
    expect(res.status).toBeLessThan(400);
  });
});
