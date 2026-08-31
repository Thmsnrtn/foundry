process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { sweepEntitlements, entitledToAct } from '../../src/services/billing/entitlement.js';
import { getInstancePosture, isPrivateOwnerInstance } from '../../src/lib/instance-posture.js';

// =============================================================================
// NOBODY BUYS ACCESS TO THEIR OWN INSTITUTION.
//
// `entitlement_sweep` runs hourly and pauses any product whose owner has no
// tier, no live `paid_through` and no running trial. `operatingProduct()` then
// excludes paused products, and the scheduler's company loop reads exactly that
// predicate — so on a private deployment the owner's own company would be
// paused within an hour of being created, and Foundry would stop observing the
// company it exists to operate. Not by failing: by correctly answering a
// commercial question that has no subject here.
//
// The posture is a deployment fact, decided at its edge, and the default is
// commercial — the restrictive answer. What it touches is exactly one axis:
// whether ACCESS to Foundry is metered. Stripe, subscriptions, prices, MRR and
// failed-payment handling stay, because a private institution still operates
// businesses that bill their own customers.
// =============================================================================

const OWNER = 'f_priv', P = 'p_priv';
const original = process.env.FOUNDRY_INSTANCE_POSTURE;

beforeAll(async () => {
  await runMigrations();
  // An owner with no tier, no trial and nothing paid through: exactly the state
  // a founder is in the moment they create their first company.
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier,trial_ends_at,paid_through)
               VALUES (?,?,?,NULL,NULL,NULL)`, [OWNER, 'c_priv', 'owner@example.com']);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')`,
    [P, 'Foundry', OWNER]);
});

afterEach(async () => {
  if (original === undefined) delete process.env.FOUNDRY_INSTANCE_POSTURE;
  else process.env.FOUNDRY_INSTANCE_POSTURE = original;
  await query('UPDATE products SET entitlement_paused_at = NULL WHERE id = ?', [P]);
});

const pausedAt = async (): Promise<unknown> =>
  ((await query('SELECT entitlement_paused_at AS p FROM products WHERE id = ?', [P]))
    .rows[0] as Record<string, unknown>).p;

describe('a private owner institution does not meter access to itself', () => {
  it('commercial posture pauses an unentitled company — the rule still works', async () => {
    process.env.FOUNDRY_INSTANCE_POSTURE = 'commercial';
    const r = await sweepEntitlements();
    expect(r.paused, 'the commercial rule must be intact for real customers').toContain(P);
    expect(await pausedAt()).not.toBeNull();
  });

  it('private posture never pauses the owner for not paying himself', async () => {
    process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
    const r = await sweepEntitlements();
    expect(r.paused).not.toContain(P);
    expect(await pausedAt(),
      'a paused company is invisible to operatingProduct(), so the institution '
      + 'would stop observing its own company').toBeNull();
  });

  it('private posture resumes a company a previous sweep paused', async () => {
    process.env.FOUNDRY_INSTANCE_POSTURE = 'commercial';
    await sweepEntitlements();
    expect(await pausedAt()).not.toBeNull();

    process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
    const r = await sweepEntitlements();
    expect(r.resumed, 'the pause was the wrong answer to a question with no subject')
      .toContain(P);
    expect(await pausedAt()).toBeNull();
  });
});

describe('the posture is a deployment fact with a safe default', () => {
  it('defaults to commercial when unset', () => {
    expect(getInstancePosture({})).toBe('commercial');
    expect(isPrivateOwnerInstance({})).toBe(false);
  });

  it('is not turned on by anything except the exact value', () => {
    for (const v of ['', 'private', 'true', '1', 'owner', 'PRIVATE-OWNER']) {
      expect(isPrivateOwnerInstance({ FOUNDRY_INSTANCE_POSTURE: v }), v).toBe(false);
    }
    expect(isPrivateOwnerInstance({ FOUNDRY_INSTANCE_POSTURE: 'PRIVATE_OWNER' })).toBe(true);
  });

  it('leaves the commercial entitlement rule itself untouched', () => {
    // Posture decides whether the question is asked, never what the answer is.
    // A commercial deployment must still be able to tell a paying customer from
    // a lapsed one.
    expect(entitledToAct({ tier: 'solo', trialEndsAt: null, paidThrough: null })).toBe(true);
    expect(entitledToAct({ tier: null, trialEndsAt: null, paidThrough: null })).toBe(false);
  });
});
