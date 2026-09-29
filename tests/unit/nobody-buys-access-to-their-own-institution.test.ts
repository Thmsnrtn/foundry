process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { existsSync } from 'node:fs';
import { JOB_REGISTRY } from '../../src/jobs/index.js';
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
//
// THE SWEEP IS GONE (Private S7b1, 29 September 2026). On this deployment it
// had already been answering "entitled" for every company and clearing any old
// pause every hour; with nobody left to bill, the rule, its job and the
// subscription machinery behind it were deleted. What is held now is that
// nothing meters access at all, and that an unpaid owner's company is not
// paused by anything.
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
  it('has no entitlement rule, no trial and no sweep left to ask', () => {
    for (const f of ['src/services/billing/entitlement.ts', 'src/services/billing/trial.ts',
      'src/services/billing/stripe.ts']) {
      expect(existsSync(f), f).toBe(false);
    }
    expect(Object.keys(JOB_REGISTRY)).not.toContain('entitlement_sweep');
  });

  it('leaves an unpaid owner company unpaused, in either posture', async () => {
    for (const posture of ['private_owner', 'commercial']) {
      process.env.FOUNDRY_INSTANCE_POSTURE = posture;
      expect(await pausedAt(), posture).toBeNull();
    }
  });
});

describe('the posture is a deployment fact with a safe default', () => {
  it('defaults to private when unset — the owner said nobody else uses it (29 September 2026)', () => {
    expect(getInstancePosture({})).toBe('private_owner');
    expect(isPrivateOwnerInstance({})).toBe(true);
  });

  it('becomes commercial only by saying exactly that, and nothing else turns private off', () => {
    for (const v of ['', 'private', 'true', '1', 'owner', 'PRIVATE-OWNER', 'commercial-ish', 'public']) {
      expect(isPrivateOwnerInstance({ FOUNDRY_INSTANCE_POSTURE: v }), v).toBe(true);
    }
    expect(isPrivateOwnerInstance({ FOUNDRY_INSTANCE_POSTURE: 'COMMERCIAL' })).toBe(false);
  });
});
