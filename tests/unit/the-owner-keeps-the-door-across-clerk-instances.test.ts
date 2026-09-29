process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { bindOwnerIdentity, signInMoves } from '../../src/services/founder/owner-identity.js';
import { clerkFrontendHost, clerkInstanceOf } from '../../src/lib/clerk-instance.js';

// =============================================================================
// THE OWNER KEEPS THE DOOR ACROSS CLERK INSTANCES (Private S8, 29 September 2026).
//
// Moving from Clerk's development instance to a production instance gives the
// same person a NEW Clerk user id. `founders.clerk_user_id` is how a session
// finds its founder row, and `founders.email` is UNIQUE. So the first sign-in
// on the production instance found no row by id, tried to INSERT one with the
// owner's email, hit the unique constraint, and was sent back to sign in —
// the owner locked out of their own institution by the act of making sign-in
// durable.
//
// The fix is one rule, in one place, used by both doors that can create a
// founder (the middleware and the signed webhook): the owner's existing row is
// rebound to the new id — only for a VERIFIED primary email that IS the
// owner's, and every rebind is recorded. Nobody else is ever rebound, and no
// caller can declare the email verified on someone else's behalf: the
// function asks the admission rule itself.
// =============================================================================

const OWNER_ID = 'f_owner';
const DEV_ID = 'user_dev_1';
const PROD_ID = 'user_live_1';

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  await query('DELETE FROM owner_identity_rebinds');
  await query("DELETE FROM products WHERE id = 'p_owned'");
  await query('DELETE FROM founders WHERE id LIKE ? OR lower(email) = ?', ['f_%', 'owner@example.com']);
  await query(`INSERT INTO founders (id, clerk_user_id, email, name) VALUES (?,?,?,?)`,
    [OWNER_ID, DEV_ID, 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id) VALUES ('p_owned', 'Owned Co', ?)`, [OWNER_ID]);
});

const rebinds = async (): Promise<Array<Record<string, unknown>>> =>
  (await query('SELECT * FROM owner_identity_rebinds')).rows as unknown as Array<Record<string, unknown>>;

describe('the owner signing in on a new Clerk instance', () => {
  it('is rebound to their existing founder row, with their companies, once', async () => {
    const r = await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: 'owner@example.com', name: 'Owner' });
    expect(r).toEqual({ founderId: OWNER_ID, action: 'rebound' });
    const row = (await query('SELECT clerk_user_id FROM founders WHERE id = ?', [OWNER_ID])).rows[0] as Record<string, unknown>;
    expect(row.clerk_user_id).toBe(PROD_ID);
    const owned = await query('SELECT id FROM products WHERE owner_id = ?', [OWNER_ID]);
    expect(owned.rows.length, 'the institution is still theirs').toBe(1);
    expect(await rebinds()).toMatchObject([{ founder_id: OWNER_ID, from_clerk_user_id: DEV_ID, to_clerk_user_id: PROD_ID }]);

    // The second sign-in finds the row by id and rebinds nothing.
    expect(await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: 'owner@example.com', name: 'Owner' }))
      .toEqual({ founderId: OWNER_ID, action: 'found' });
    expect(await rebinds()).toHaveLength(1);
  });

  it('shows the owner when and between which identities their sign-in moved', async () => {
    expect(await signInMoves(OWNER_ID)).toEqual([]);
    await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: 'owner@example.com', name: null });
    expect(await signInMoves(OWNER_ID)).toMatchObject([{ from: DEV_ID, to: PROD_ID }]);
    const settings = readFileSync('src/routes/dashboard/settings.ts', 'utf8');
    expect(settings, 'the Settings page reads it').toMatch(/signInMoves\(/);
  });

  it('matches the owner address without regard to case', async () => {
    const r = await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: 'Owner@Example.COM', name: null });
    expect(r.action).toBe('rebound');
  });

  it('creates the row when the owner has none yet', async () => {
    await query('DELETE FROM products WHERE owner_id = ?', [OWNER_ID]);
    await query('DELETE FROM founders WHERE id = ?', [OWNER_ID]);
    const r = await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: 'owner@example.com', name: 'Owner' });
    expect(r.action).toBe('created');
    expect(await rebinds()).toEqual([]);
  });
});

describe('nobody else is ever rebound', () => {
  it('refuses a different verified address, and touches nothing', async () => {
    const r = await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: 'someone@else.example', name: 'X' });
    expect(r).toEqual({ founderId: null, action: 'refused' });
    const row = (await query('SELECT clerk_user_id FROM founders WHERE id = ?', [OWNER_ID])).rows[0] as Record<string, unknown>;
    expect(row.clerk_user_id).toBe(DEV_ID);
    expect(await rebinds()).toEqual([]);
  });

  it('refuses the owner address when it is not verified', async () => {
    const r = await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: null, name: 'Owner' });
    expect(r).toEqual({ founderId: null, action: 'refused' });
    expect(await rebinds()).toEqual([]);
  });

  it('refuses when no owner address is configured at all', async () => {
    const saved = process.env.FOUNDRY_OWNER_EMAIL;
    process.env.FOUNDRY_OWNER_EMAIL = '';
    try {
      const r = await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: '', name: null });
      expect(r.action).toBe('refused');
    } finally { process.env.FOUNDRY_OWNER_EMAIL = saved; }
  });

  it('keeps each rebind as it was', async () => {
    await bindOwnerIdentity({ clerkUserId: PROD_ID, verifiedPrimaryEmail: 'owner@example.com', name: null });
    await expect(query("UPDATE owner_identity_rebinds SET to_clerk_user_id = 'user_forged'"))
      .rejects.toThrow(/kept as it was/);
  });
});

describe('both doors that can create a founder use the one rule', () => {
  it('is what the middleware and the signed webhook call, and neither inserts a founder itself', () => {
    for (const f of ['src/middleware/auth.ts', 'src/routes/auth/clerk.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/bindOwnerIdentity\(/);
      expect(src, `${f} must not insert a founder row of its own`).not.toMatch(/INSERT INTO founders/);
    }
  });
});

describe('which Clerk instance production is on', () => {
  it('reads development and production from the key prefixes, and says when they disagree', () => {
    expect(clerkInstanceOf({ CLERK_SECRET_KEY: 'sk_test_x', CLERK_PUBLISHABLE_KEY: 'pk_test_y' })).toBe('development');
    expect(clerkInstanceOf({ CLERK_SECRET_KEY: 'sk_live_x', CLERK_PUBLISHABLE_KEY: 'pk_live_y' })).toBe('production');
    expect(clerkInstanceOf({ CLERK_SECRET_KEY: 'sk_live_x', CLERK_PUBLISHABLE_KEY: 'pk_test_y' })).toBe('mismatched');
    expect(clerkInstanceOf({})).toBe('not_configured');
  });

  it('finds the production Frontend API host inside the publishable key', () => {
    const pk = `pk_live_${Buffer.from('clerk.owner-domain.example$').toString('base64')}`;
    expect(clerkFrontendHost(pk)).toBe('clerk.owner-domain.example');
  });

  it('refuses anything that is not a bare hostname, because it lands in a security policy', () => {
    for (const hostile of ['clerk.x.example; script-src *', 'https://clerk.x.example', '*.example', 'a b.example', '']) {
      const pk = `pk_live_${Buffer.from(`${hostile}$`).toString('base64')}`;
      expect(clerkFrontendHost(pk), hostile).toBeNull();
    }
    expect(clerkFrontendHost('pk_live_!!!not-base64')).toBeNull();
    expect(clerkFrontendHost(undefined)).toBeNull();
  });
});

describe('the pages that load Clerk allow the production host', () => {
  it('names the host from the publishable key in the sign-in policy', async () => {
    const { Hono } = await import('hono');
    const { securityHeaders } = await import('../../src/middleware/security-headers.js');
    const saved = process.env.CLERK_PUBLISHABLE_KEY;
    process.env.CLERK_PUBLISHABLE_KEY = `pk_live_${Buffer.from('clerk.owner-domain.example$').toString('base64')}`;
    try {
      const app = new Hono();
      app.use('*', securityHeaders);
      app.get('/auth/login', (c) => c.text('ok'));
      const csp = (await app.request('/auth/login')).headers.get('Content-Security-Policy') ?? '';
      for (const directive of ['script-src', 'connect-src', 'frame-src']) {
        const d = csp.split(';').find((x) => x.trim().startsWith(directive)) ?? '';
        expect(d, directive).toContain('https://clerk.owner-domain.example');
      }
    } finally { process.env.CLERK_PUBLISHABLE_KEY = saved; }
  });
});
