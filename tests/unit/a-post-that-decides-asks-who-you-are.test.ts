process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A POST THAT DECIDES ASKS WHO YOU ARE (Roadmap 2027 R2, 30 September 2026).
//
// Seventeen mutating routes asked no question beyond "are you signed in". On a
// private instance only the owner can sign in, so this was one lock where two
// belong: authentication is not authorization. Ten of them DECIDE something —
// dispose of a judgment, answer the institution's question, promote a
// responsibility, delete every company — and now ask the second question.
//
// Eight stay open, each for a reason written above it, and none of the eight
// can widen what Foundry may do: Stop, two revocations, a disconnect and a
// quieter ceiling only take something away; a buyer's refund link, a
// subscriber's cancel link (R19) and the Workshop's mail intake are
// authenticated by their own token or secret, not by a session. A stop that asks for more than a signed-in owner is a stop that
// can fail to happen.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const baseline = readFileSync(resolve(ROOT, 'docs/db/unguarded-route-baseline.txt'), 'utf8').split('\n').filter(Boolean);

const DECIDING = [
  '/letter/attention/d1',
  '/letter/evidence/r1/answer',
  '/letter/evidence/r1/defer',
  '/letter/judgments/j1/disposition',
  '/letter/responsibilities/r1/disposition',
  '/letter/responsibility-candidates/c1/promote',
  '/letter/responsibility-candidates/c1/reconsider',
  '/letter/responsibility-candidates/c1/reject',
];

let app: Hono;
let signedInAs = 'someone@example.com';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['f_other', 'clk_other', 'someone@example.com', 'Other']);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  const { privacySettings } = await import('../../src/routes/dashboard/privacy.js');
  const { settingsRoutes } = await import('../../src/routes/dashboard/settings.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: 'f_other', email: signedInAs, name: 'Other' } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes);
  app.route('/', privacySettings);
  app.route('/', settingsRoutes);
});

const post = (path: string) => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x=1' });

describe('the ten routes that decide', () => {
  for (const path of [...DECIDING, '/settings/delete-all-products', '/settings/fluency']) {
    it(`${path} refuses a session that is not the owner's`, async () => {
      signedInAs = 'someone@example.com';
      expect((await post(path)).status).toBe(403);
    });
  }

  it('deletes nothing for a session that is not the owner\'s', async () => {
    signedInAs = 'someone@example.com';
    await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_keep','Keep','f_other','active','active','real')`);
    await post('/settings/delete-all-products');
    expect((await query(`SELECT COUNT(*) AS n FROM products WHERE id = 'p_keep' AND deleted_at IS NULL`)).rows[0]).toMatchObject({ n: 1 });
  });

  it('are none of them on the list of routes left open', () => {
    for (const path of ['/letter/attention/:decisionId', '/settings/delete-all-products', '/settings/fluency']) {
      expect(baseline).not.toContain(`POST ${path}`);
    }
  });
});

describe('the eight left open', () => {
  const REASONS: Record<string, [string, RegExp]> = {
    'POST /autopilot/panic': ['src/routes/dashboard/letter.ts', /only ever lowers/],
    'POST /connections/:name/disconnect': ['src/routes/dashboard/connections.ts', /only take a hand away/],
    'POST /connections/grants/:id/revoke': ['src/routes/dashboard/connections.ts', /only take a hand away/],
    'POST /letter/channels/:channelId/revoke': ['src/routes/dashboard/letter.ts', /Withdrawing a channel/],
    'POST /settings/interruption-ceiling': ['src/routes/dashboard/settings.ts', /NO COMPANY CAPABILITY/],
    'POST /share/cancel/:fulfilmentId/:token': ['src/routes/share/index.ts', /NO CAPABILITY IS ASKED HERE ON PURPOSE, for the refund's reason/],
    'POST /share/refund/:fulfilmentId/:token': ['src/routes/share/index.ts', /NO CAPABILITY IS ASKED HERE ON PURPOSE\. The buyer/],
    'POST /workshop/mail': ['src/routes/workshop-mail.ts', /NO CAPABILITY GUARD, DELIBERATELY/],
  };

  it('are exactly these, and no more', () => {
    expect([...baseline].sort()).toEqual(Object.keys(REASONS).sort());
  });

  for (const [route, [file, reason]] of Object.entries(REASONS)) {
    it(`${route} says why, above it`, () => {
      expect(readFileSync(resolve(ROOT, file), 'utf8')).toMatch(reason);
    });
  }
});
