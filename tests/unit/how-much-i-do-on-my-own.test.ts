process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { authorityOf } from '../../src/services/founder/authority.js';
import { interpret, setAllowance, setBoundary } from '../../src/services/institution/standing-intent.js';

// =============================================================================
// HOW MUCH I DO ON MY OWN.
//
// The owner wanted to look at a company and turn the autopilot as heavy or as
// light as he likes. Foundry had every primitive the dial could move and no
// dial. What this file proves:
//
//   - the setting is DERIVED from the rows that govern — boundaries, the
//     allowance, standing grants — and there is no column anywhere that stores
//     it, so what he sees is what the gates read;
//   - lighter is one tap, shown first as the exact sentences that will be
//     written, and applied through the writers that already exist, each row
//     carrying his reason;
//   - a confirmation that arrives after the rows changed is refused, not
//     applied to a state he did not see;
//   - heavier is never one tap: it is offered as sentences through the door;
//   - the thirty-day line says "this would have changed nothing" when nothing
//     was proposed, instead of projecting a number from nothing;
//   - a company that is not his has no Authority page.
// =============================================================================

const OWNER = 'dial_owner';
const OTHER = 'dial_other';
const P = 'p_dial';
let app: Hono;
let stranger: Hono;

function appFor(founderId: string, routes: Hono): Hono {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('founder' as never, { id: founderId, email: founderId === OWNER ? 'owner@example.com' : 'x@example.com', name: 'X' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  a.route('/', routes);
  return a;
}

const post = (a: Hono, path: string, body: Record<string, string>) => a.request(path, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_dial', 'owner@example.com', 'Owner']);
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OTHER, 'clerk_dial2', 'x@example.com', 'Other']);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Acme', ?, 'active')", [P, OWNER]);
  const { placeRoutes } = await import('../../src/routes/dashboard/places.js');
  app = appFor(OWNER, placeRoutes);
  stranger = appFor(OTHER, placeRoutes);
});

describe('the setting is read, not stored', () => {
  it('has no column that stores it', async () => {
    const rows = (await query("SELECT name FROM sqlite_master WHERE sql LIKE '%autopilot_level%' OR sql LIKE '%authority_setting%'", [])).rows;
    expect(rows).toHaveLength(0);
  });

  it('is watch for a company he has said nothing about, and says why honestly', async () => {
    const a = (await authorityOf(OWNER, P))!;
    expect(a.setting).toBe('watch');
    expect(a.sentence).toMatch(/Nothing is allowed behind the doors/);
    expect(a.projections.every((p) => /would have changed nothing/.test(p.sentence))).toBe(true);
    expect(a.lighter.map((m) => m.to)).toEqual(['watch']); // shut the doors is still lighter
    expect(a.heavier.some((h) => /Spend up to/.test(h.said))).toBe(true);
  });

  it('moves as the rows move: ask-first makes propose; an allowance makes carry; a shut door makes mixed', async () => {
    await setBoundary({ productId: P, subject: 'spend_money', statement: 'Ask me first before you spend money for Acme.', mode: 'ask_first' });
    expect((await authorityOf(OWNER, P))!.setting).toBe('propose');
    await setAllowance({ productId: P, statement: 'Spend up to $25 on what Acme needs.', amountCents: 2500, purpose: 'what Acme needs' });
    expect((await authorityOf(OWNER, P))!.setting).toBe('carry');
    await setBoundary({ productId: P, subject: 'contact_people', statement: 'Never contact people for Acme.', mode: 'never' });
    const a = (await authorityOf(OWNER, P))!;
    expect(a.setting).toBe('mixed');
    expect(a.lighter.map((m) => m.to).sort()).toEqual(['propose', 'watch']);
    expect(a.lighter.find((m) => m.to === 'watch')!.would).toEqual([
      'Never spend money for Acme.', 'Take back the allowance of $25.00.',
    ]);
  });
});

describe('every sentence the dial offers', () => {
  it('reads back through the door to the subject and mode it names', async () => {
    const a = (await authorityOf(OWNER, P))!;
    const offered = [...a.heavier.filter((h) => !h.editable).map((h) => h.said),
      ...a.lighter.flatMap((m) => m.would).filter((w) => /^(Never|Ask me first)/.test(w))];
    expect(offered.length).toBeGreaterThan(0);
    for (const said of offered) {
      const read = interpret(said);
      expect(read.kind, said).toBe('boundary');
      const door = a.doors.find((d) => read.kind === 'boundary' && d.subject === read.subject);
      expect(door, said).toBeTruthy();
    }
  });
});

describe('the page', () => {
  it('shows the dial with the current mark, the doors, and the honest thirty days', async () => {
    const res = await app.request(`/foundry/companies/${P}/authority`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('class="mark on" aria-current="true">Some of each');
    expect(html).toContain('<strong>spend your money</strong>: ask me first');
    expect(html).toContain('<strong>contact anyone</strong>: never');
    expect(html).toContain('would have changed nothing');
    expect(html).toContain('id="heavier"');
    // Lighter marks are forms; heavier are links to the sentences.
    expect(html).toContain('name="to" value="watch"');
    expect(html).toContain('name="to" value="propose"');
  });

  it('does not exist for a company that is not his', async () => {
    expect((await stranger.request(`/foundry/companies/${P}/authority`)).status).toBe(404);
    expect([403, 404]).toContain((await post(stranger, `/foundry/companies/${P}/authority`, { to: 'watch' })).status);
  });
});

describe('lighter, in one confirmed tap', () => {
  it('shows exactly what it will write, refuses a stale confirmation, then writes it', async () => {
    const preview = await post(app, `/foundry/companies/${P}/authority`, { to: 'watch' });
    expect(preview.status).toBe(200);
    const html = await preview.text();
    expect(html).toContain('Never spend money for Acme.');
    expect(html).toContain('Take back the allowance of $25.00.');
    const fingerprint = /name="fingerprint" value="([^"]+)"/.exec(html)![1]!;

    // The rows move under him before he confirms: refused, nothing written.
    await setAllowance({ productId: P, statement: 'Spend up to $40 on what Acme needs.', amountCents: 4000, purpose: 'what Acme needs' });
    const stale = await post(app, `/foundry/companies/${P}/authority/confirm`, { to: 'watch', fingerprint });
    expect(stale.headers.get('location')).toBe(`/foundry/companies/${P}/authority?done=stale`);
    expect((await authorityOf(OWNER, P))!.setting).toBe('mixed');

    // Shown again, confirmed against what is now true.
    const again = await (await post(app, `/foundry/companies/${P}/authority`, { to: 'watch' })).text();
    const fp2 = /name="fingerprint" value="([^"]+)"/.exec(again)![1]!;
    const done = await post(app, `/foundry/companies/${P}/authority/confirm`, { to: 'watch', fingerprint: fp2 });
    expect(done.headers.get('location')).toBe(`/foundry/companies/${P}/authority?done=watch`);

    const a = (await authorityOf(OWNER, P))!;
    expect(a.setting).toBe('watch');
    expect(a.allowance).toBeNull();
    expect(a.doors.filter((d) => d.door !== null).every((d) => d.mode === 'never')).toBe(true);
    // Every line is a row with his reason on it.
    const boundaries = (await query('SELECT statement FROM owner_boundaries WHERE product_id = ? AND lifted_at IS NULL', [P])).rows as unknown as Array<Record<string, unknown>>;
    expect(boundaries.map((b) => String(b.statement)).sort()).toEqual(['Never contact people for Acme.', 'Never spend money for Acme.']);
    const withdrawn = (await query('SELECT withdraw_reason FROM owner_allowances WHERE product_id = ? AND withdrawn_at IS NOT NULL ORDER BY rowid DESC LIMIT 1', [P])).rows[0] as Record<string, unknown>;
    expect(String(withdrawn.withdraw_reason)).toMatch(/you set me to watch/);
    // And the thirty days stays honest: nothing was ever proposed.
    expect(a.projections[0]!.sentence).toMatch(/would have changed nothing/);
  });

  it('offers heavier only as sentences through the door, never as a tap', async () => {
    const html = await (await app.request(`/foundry/companies/${P}/authority`)).text();
    expect(html).not.toContain('name="to" value="carry"');
    expect(html).toContain('action="/foundry/companies/p_dial/said"');
    expect(html).toContain('value="Ask me first before you spend money for Acme."');
  });
});
