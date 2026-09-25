// =============================================================================
// A MINUTE OF READING IS NOT A SIGN-OUT.
//
// The owner placed his Etsy keystring and shared secret, pressed save, and
// "it just reloads back to the Home Screen and it doesn't say Etsy is
// connected". The save never ran. Clerk's `__session` token lives sixty
// seconds and nothing on the owner's surface renews it, so a form that took
// longer than a minute to fill — two values copied from another app — reached
// the server with a lapsed token, was sent to sign-in, and sign-in, finding him
// signed in, sent him Home. Nothing was said, and nothing was saved.
//
// These tests hold the repair to its security terms as well as its purpose:
// a lapsed session is honoured only on Clerk's live word, only from the
// HttpOnly copy, never past twelve hours, never for an ended session or a
// different person — and where it cannot be honoured, he is returned to where
// he was, told plainly that nothing was saved.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.CLERK_SECRET_KEY = 'sk_test_lapse';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Clerk's part, played by a double. A token here is `tok:<user>:<session>:<exp
 * as epoch seconds>`; the double checks expiry exactly as Clerk does, honouring
 * `clockSkewInMs`, so "lapsed" and "lapsed too long" are real distinctions.
 */
const SESSIONS: Record<string, { status: string; userId: string }> = {};
let liveCalls = 0;

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async (token: string, opts: { clockSkewInMs?: number }) => {
    const [kind, sub, sid, exp] = token.split(':');
    if (kind !== 'tok') throw new Error('bad signature');
    if (Number(exp) * 1000 + (opts.clockSkewInMs ?? 5000) < Date.now()) throw new Error('token-expired');
    return { sub, sid, exp: Number(exp) };
  }),
  Clerk: () => ({
    sessions: {
      getSession: async (sid: string) => {
        liveCalls += 1;
        const s = SESSIONS[sid];
        if (!s) throw new Error('not found');
        return s;
      },
    },
    users: { getUser: async () => { throw new Error('not used'); } },
  }),
}));

import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { authMiddleware } from '../../src/middleware/auth.js';
import {
  forgetLiveSessions, loginPathFor, safeNext, LAPSE_GRACE_MS, OWNER_SESSION_COOKIE,
} from '../../src/middleware/session-lapse.js';

const USER = 'user_owner';
const SID = 'sess_owner';
const now = (): number => Math.floor(Date.now() / 1000);
const token = (expOffsetSec: number, sub = USER, sid = SID): string => `tok:${sub}:${sid}:${String(now() + expOffsetSec)}`;

function app(): Hono {
  const a = new Hono();
  a.use('/settings/*', authMiddleware as never);
  a.post('/settings/app-credential/etsy', (c) => c.text('SAVED'));
  a.get('/settings/page', (c) => c.text('PAGE'));
  return a;
}

async function post(cookies: string, referer = 'https://foundry.test/foundry/controls/connectors/etsy'): Promise<Response> {
  return app().request('https://foundry.test/settings/app-credential/etsy', {
    method: 'POST',
    headers: {
      Cookie: cookies, Accept: 'text/html,application/xhtml+xml', Referer: referer,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'keystring=k&shared_secret=s&back=%2Ffoundry%2Fcontrols%2Fconnectors%2Fetsy',
  });
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id, clerk_user_id, email, name) VALUES (?,?,?,?)',
    ['f_owner', USER, 'owner@example.com', 'Owner']);
});

beforeEach(() => {
  forgetLiveSessions();
  liveCalls = 0;
  for (const k of Object.keys(SESSIONS)) delete SESSIONS[k];
  SESSIONS[SID] = { status: 'active', userId: USER };
});

describe('the owner pastes his key slowly, and it is saved', () => {
  it('reaches the save when __session lapsed but Clerk says the session is his and live', async () => {
    // THE DEFECT, EXACTLY. Two minutes on the page: both copies expired.
    const lapsed = token(-120);
    const res = await post(`__session=${lapsed}; ${OWNER_SESSION_COOKIE}=${lapsed}`);
    expect(res.status, 'the post reached its handler rather than a redirect Home').toBe(200);
    expect(await res.text()).toBe('SAVED');
    expect(liveCalls, 'Clerk was asked, not assumed').toBe(1);
  });

  it('keeps an HttpOnly copy of a freshly verified token', async () => {
    const res = await post(`__session=${token(50)}`);
    expect(res.status).toBe(200);
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain(`${OWNER_SESSION_COOKIE}=`);
    expect(set).toContain('HttpOnly');
    expect(liveCalls, 'a fresh token needs nobody else\'s word').toBe(0);
  });

  it('asks Clerk once, not on every request, while the answer is recent', async () => {
    const lapsed = token(-120);
    await post(`${OWNER_SESSION_COOKIE}=${lapsed}`);
    await post(`${OWNER_SESSION_COOKIE}=${lapsed}`);
    expect(liveCalls).toBe(1);
  });
});

describe('what a lapsed session is never honoured for', () => {
  it('not once he has signed out', async () => {
    SESSIONS[SID] = { status: 'ended', userId: USER };
    const res = await post(`${OWNER_SESSION_COOKIE}=${token(-120)}`);
    expect(res.status).toBe(302);
  });

  it('not for a revoked session', async () => {
    SESSIONS[SID] = { status: 'revoked', userId: USER };
    expect((await post(`${OWNER_SESSION_COOKIE}=${token(-120)}`)).status).toBe(302);
  });

  it('not when the live session belongs to somebody else', async () => {
    SESSIONS[SID] = { status: 'active', userId: 'user_stranger' };
    expect((await post(`${OWNER_SESSION_COOKIE}=${token(-120)}`)).status).toBe(302);
  });

  it('not when Clerk cannot be asked', async () => {
    delete SESSIONS[SID];
    expect((await post(`${OWNER_SESSION_COOKIE}=${token(-120)}`)).status).toBe(302);
  });

  it('not past twelve hours, whatever Clerk says', async () => {
    const tooOld = token(-(LAPSE_GRACE_MS / 1000) - 60);
    expect((await post(`${OWNER_SESSION_COOKIE}=${tooOld}`)).status).toBe(302);
    expect(liveCalls, 'a token that old is refused before Clerk is asked').toBe(0);
  });

  it('not from the script-readable __session: only the HttpOnly copy is exchanged', async () => {
    // `__session` is written by Clerk's browser SDK, so any script on the
    // origin can read it. It gets Clerk's sixty seconds and not a second more.
    expect((await post(`__session=${token(-120)}`)).status).toBe(302);
    expect(liveCalls).toBe(0);
  });

  it('not for an API client: a Bearer token keeps Clerk\'s sixty seconds', async () => {
    const res = await app().request('https://foundry.test/settings/app-credential/etsy', {
      method: 'POST', headers: { Authorization: `Bearer ${token(-120)}`, Accept: 'application/json' },
    });
    expect(res.status).toBe(401);
    expect(liveCalls).toBe(0);
  });
});

describe('when it cannot be honoured, he goes back to where he was', () => {
  it('a lost post returns to the page it came from, marked so the page says nothing was saved', async () => {
    const res = await post('');
    expect(res.status).toBe(302);
    const to = res.headers.get('location') ?? '';
    expect(to, 'not a bare sign-in that ends at Home').not.toBe('/auth/login');
    const u = new URL(to, 'https://foundry.test');
    expect(u.pathname).toBe('/auth/login');
    expect(u.searchParams.get('next')).toBe('/foundry/controls/connectors/etsy');
    expect(u.searchParams.get('lapsed')).toBe('1');
  });

  it('a navigation returns to the page it was for', async () => {
    const res = await app().request('https://foundry.test/settings/page?tab=keys', {
      headers: { Accept: 'text/html' },
    });
    const u = new URL(res.headers.get('location') ?? '', 'https://foundry.test');
    expect(u.searchParams.get('next')).toBe('/settings/page?tab=keys');
    expect(u.searchParams.get('lapsed')).toBeNull();
  });

  it('never to another host, never back into sign-in', () => {
    expect(safeNext('//evil.test/x')).toBe('/foundry');
    expect(safeNext('/\\evil.test')).toBe('/foundry');
    expect(safeNext('https://evil.test')).toBe('/foundry');
    expect(safeNext('/auth/login')).toBe('/foundry');
    expect(safeNext('/foundry/controls/connectors/etsy')).toBe('/foundry/controls/connectors/etsy');
    const foreign = new URL(loginPathFor('POST', 'https://foundry.test/settings/x', 'https://evil.test/foundry/x'),
      'https://foundry.test');
    expect(foreign.searchParams.get('next'), 'a foreign referer is not followed').toBe('/foundry');
  });
});
