process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { canIDisappear, whileYouWereAway } from '../../src/services/founder/a-week-away.js';
import { setAllowance, setBoundary, proposeAct } from '../../src/services/institution/standing-intent.js';
import { setPosture } from '../../src/services/founder/burden.js';
import { establishReferenceCompany } from '../../src/services/reference/world.js';

// =============================================================================
// "CAN I DISAPPEAR FOR A WEEK?"
//
// The owner's acceptance test for safe leverage. The answer is what Foundry
// carries, what it cannot, what authority it holds, what might need him and
// what will wait - and the return letter is what happened, handled, changed,
// spent, reached the world, came back, was learned, and needs him. Nothing is
// inferred from silence, and a company Foundry cannot see is named as one.
// =============================================================================

const OWNER = 'wk_owner';
const A = 'wk_a';
const B = 'wk_b';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_wk', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id, status, ingest_token) VALUES (?, 'Alpha', ?, 'active', 'tok_a')`, [A, OWNER]);
  await query(`INSERT INTO products (id, name, owner_id, status, ingest_token) VALUES (?, 'Beta', ?, 'active', 'tok_b')`, [B, OWNER]);
  await establishReferenceCompany({ scenarioKey: 'an_anchor_that_needs_him', ownerId: OWNER });
});

describe('before he goes', () => {
  it('says yes plainly when nothing could need him, and names what it cannot see', async () => {
    const v = await canIDisappear(OWNER);
    expect(v.verdict).toMatch(/^Yes/);
    expect(v.blind.sort()).toEqual(['Alpha', 'Beta']);
    // Authority is stated per company, and the default is that it may spend nothing.
    expect(v.authority.join(' ')).toContain('Alpha: I cannot spend anything');
  });

  it('lists what it may do, what it will not, and what will wait', async () => {
    await setAllowance({ productId: A, statement: 'Spend up to $30 keeping Alpha running',
      amountCents: 3_000, purpose: 'ops' });
    await setBoundary({ productId: B, subject: 'contact_people', mode: 'never',
      statement: 'Never contact anyone at Beta' });
    await setBoundary({ productId: A, subject: 'contact_people', mode: 'ask_first',
      statement: 'Ask me before contacting anyone' });
    await proposeAct({ productId: A, subject: 'contact_people', actionType: 'send_email',
      params: { to: 'x@example.com' }, summary: 'email a lapsed customer', why: 'card failed',
      expectedEffect: 'they update it', risk: 'low', consequence: 'low', proposedBy: 'foundry' });
    const v = await canIDisappear(OWNER);
    expect(v.authority.join(' ')).toContain('Alpha: I may spend up to $30 more');
    expect(v.authority.join(' ')).toContain('Beta: I will not contact people');
    expect(v.authority.join(' ')).toContain('Alpha: I will ask before I contact people');
    expect(v.willWait.join(' ')).toContain('Alpha: 1 proposal I will not act on until you decide');
    // The reference company never appears, however much it needs him.
    expect(JSON.stringify(v)).not.toContain('Tallow');
  });
});

describe('when he comes back', () => {
  it('says what changed, what needs him, and says "nothing" where nothing happened', async () => {
    await setPosture({ productId: B, founderId: OWNER, to: 'harvest', said: 'Just harvest Beta' });
    const l = await whileYouWereAway(OWNER);
    expect(l.changed.join(' ')).toContain('Beta: now harvest - "Just harvest Beta"');
    expect(l.changed.join(' ')).toContain('you said "Never contact anyone at Beta"');
    expect(l.needsYou.join(' ')).toContain('Alpha: email a lapsed customer');
    expect(l.effects).toEqual([]);
    expect(l.outcomes).toEqual([]);
    expect(l.money).toEqual([]);
  });
});

describe('asked in his own words, on the first screen', () => {
  const asOwner = async (path: string): Promise<string> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    return (await app.request(path)).text();
  };

  it('answers "Can I disappear for a week?" with the verdict and what will wait', async () => {
    const page = await asOwner('/foundry?q=' + encodeURIComponent('Can I disappear for a week?'));
    expect(page).toContain('What I may and may not do');
    expect(page).toContain('Alpha: I may spend up to $30 more');
    expect(page).toContain('What will wait for you');
  });

  it('answers "What happened while I was away?" section by section, saying nothing where nothing happened', async () => {
    const page = await asOwner('/foundry?q=' + encodeURIComponent('What happened while I was away?'));
    expect(page).toContain('What I handled');
    expect(page).toContain('nothing left the building');
    expect(page).toContain('Beta: now harvest');
  });
});
