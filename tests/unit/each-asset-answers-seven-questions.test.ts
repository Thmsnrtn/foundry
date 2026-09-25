// =============================================================================
// EACH LIVE ASSET ANSWERS SEVEN QUESTIONS, AND SAYS WHICH IT CANNOT.
//
// The integrated plan (§5): for each live asset the institution must be able
// to answer who the customer is and what was promised; where buyers can
// actually meet it; which provider operations have been demonstrated for this
// account; what money was charged, deducted, refunded, paid out and seen in a
// bank; what duty is owed, by whom and by when; what may be done and recovered;
// and what the owner must decide versus what Foundry carries.
//
// Before this, the answers existed in seven places keyed by experiment or by
// founder, and several were silently absent — buyer rights, a due date,
// per-asset fees, payouts, what the account has been shown to do. A silence on
// an owner's screen reads as "nothing to know". So each answer here carries
// how much of it is known, and an unknown is a sentence, never a gap.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'd'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'oc_owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveListing, recordListing, recordVenueOrder, seedProof2 } from '../../src/services/venture/proof-2.js';
import { operatingContractOf, QUESTIONS } from '../../src/services/venture/operating-contract.js';
import { sayWhetherFindable } from '../../src/services/venture/findability.js';

const OWNER = 'oc_owner';
const STRANGER = 'oc_stranger';
let X = '';
let PRODUCT = '';

const answer = async (n: number) => {
  const c = await operatingContractOf(PRODUCT, OWNER);
  if (!c) throw new Error('no contract');
  return c.answers[n - 1];
};

beforeAll(async () => {
  await runMigrations();
  for (const id of [OWNER, STRANGER]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [id, `clerk_${id}`, `${id}@example.com`, id]);
  }
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query(
    'SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
});

describe('the shape: seven answers, each saying how much of it is known', () => {
  it('answers all seven, in order, and never with an empty sentence', async () => {
    const c = await operatingContractOf(PRODUCT, OWNER);
    expect(c?.answers.map((a) => a.question)).toEqual([...QUESTIONS]);
    for (const a of c!.answers) {
      expect(['known', 'partly', 'unknown']).toContain(a.known);
      expect(a.answer.trim().length).toBeGreaterThan(20);
    }
  });

  it('is nobody else\'s to read', async () => {
    expect(await operatingContractOf(PRODUCT, STRANGER)).toBeNull();
    expect(await operatingContractOf('no-such-asset', OWNER)).toBeNull();
  });
});

describe('what was promised, and what is not on record', () => {
  it('names the deliverable by its digest, and says buyer rights are not recorded', async () => {
    const a = await answer(1);
    const d = (await query(
      `SELECT title, digest FROM experiment_materials WHERE experiment_id = ? AND kind = 'deliverable' AND superseded_at IS NULL`,
      [X])).rows[0] as Record<string, unknown>;
    expect(a.answer).toContain(String(d.title));
    expect(a.answer).toContain(String(d.digest));
    expect(a.answer).toMatch(/No terms of use or licence/);
    expect(a.known).toBe('partly');
  });
});

describe('where a buyer can meet it', () => {
  it('says it is not listed anywhere before it is', async () => {
    const a = await answer(2);
    expect(a.known).toBe('unknown');
    expect(a.answer).toMatch(/not listed/);
  });

  it('names the listing, and that nobody has said buyers can find the shop', async () => {
    await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/5555555555/workbook' });
    const a = await answer(2);
    expect(a.answer).toContain('https://www.etsy.com/listing/5555555555/workbook');
    expect(a.answer).toMatch(/not said whether buyers can find/);
    expect(a.known).toBe('partly');
  });

  it('carries a hidden shop as the thing a buyer cannot get past', async () => {
    await sayWhetherFindable({ productId: PRODUCT, provider: 'etsy', findable: false, saidBy: `founder:${OWNER}` });
    const a = await answer(2);
    expect(a.answer).toMatch(/cannot find/);
    expect(a.known).toBe('partly');
    await sayWhetherFindable({ productId: PRODUCT, provider: 'etsy', findable: true, saidBy: `founder:${OWNER}` });
    expect((await answer(2)).known).toBe('known');
  });
});

describe('what the account has been shown to do', () => {
  it('claims nothing for an account nobody has connected, and names what is never granted', async () => {
    const a = await answer(3);
    expect(a.known).toBe('unknown');
    expect(a.answer).toMatch(/not connected|has not been read/);
    expect(a.answer).toMatch(/Publishing a listing/);
  });
});

describe('money, in the words its evidence supports', () => {
  it('does not call an unread venue an empty till', async () => {
    const a = await answer(4);
    expect(a.answer).toMatch(/No sale has been recorded/);
    expect(a.answer).toMatch(/not evidence that nobody bought/);
    expect(a.known).toBe('unknown');
  });

  it('counts a recorded sale and its fee, and says the bank is not seen', async () => {
    await recordVenueOrder({ founderId: OWNER, experimentId: X,
      order: { orderRef: '6677889900', paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 178 } });
    const a = await answer(4);
    expect(a.answer).toContain('$14.00');
    expect(a.answer).toContain('$1.78');
    expect(a.answer).toMatch(/no payout|not read/i);
    expect(a.answer).toMatch(/bank/);
    expect(a.known).toBe('partly');
  });

  it('says a fee that was never read is unknown, not zero', async () => {
    await recordVenueOrder({ founderId: OWNER, experimentId: X,
      order: { orderRef: '6677889901', paidAt: new Date().toISOString(), grossCents: 1400, feeCents: null } });
    const a = await answer(4);
    expect(a.answer).toContain('$28.00');
    expect(a.answer).toMatch(/fee on 1 of them has not been read/);
  });

  it('never counts a rehearsal as money — it cannot even be written against a real sale', async () => {
    const before = (await answer(4)).answer;
    await expect(query(
      `INSERT INTO economic_events (id, founder_id, kind, amount_cents, occurred_at, provider, provider_ref,
         source_event_id, fulfilment_id, claim_quality, evidence_mode, because)
       SELECT 'rehearsal-charge', ?, 'charge', 99999, datetime('now'), 'etsy', 'rehearsal-1',
              f.payment_event_id, f.id, 'measured', 'reference', 'a rehearsal'
         FROM experiment_fulfilments f WHERE f.experiment_id = ? LIMIT 1`, [OWNER, X]))
      .rejects.toThrow(/evidence_mode_mismatch/);
    expect((await answer(4)).answer).toBe(before);
  });
});

describe('what is owed, by whom, and by when', () => {
  it('says who carries each duty and that no deadline is on record', async () => {
    const a = await answer(5);
    expect(a.answer).toMatch(/Etsy messages/);
    expect(a.known).toBe('partly');
  });
});

describe('what may be done, and what is his', () => {
  it('names the boundaries that stand for it', async () => {
    const a = await answer(6);
    expect(a.answer).toMatch(/\d+ standing boundar/);
    expect(a.answer).toMatch(/cannot change anything at Etsy/);
  });

  it('puts what only he can do apart from what Foundry carries', async () => {
    const a = await answer(7);
    expect(a.answer).toMatch(/Yours:/);
    expect(a.answer).toMatch(/Foundry carries:/);
  });
});

describe('on the company page, folded, with how much is known', () => {
  it('shows all seven answers with their standing, and nobody else sees them', async () => {
    const { Hono } = await import('hono');
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const as = (who: string) => {
      const app = new Hono();
      app.use('*', async (c, next) => { c.set('founder' as never, { id: who, email: `${who}@example.com` } as never); await next(); });
      app.route('/', foundryShellRoutes);
      return app;
    };
    const res = await as(OWNER).request(`https://foundry.test/foundry/companies/${PRODUCT}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('What it owes and holds');
    for (const q of QUESTIONS) expect(html).toContain(q.replace(/'/g, '&#39;'));
    expect(html).toMatch(/Partly known/);
    expect(html).toMatch(/\d of 7 known/);
    const other = await as(STRANGER).request(`https://foundry.test/foundry/companies/${PRODUCT}`);
    expect(other.status).not.toBe(200);
    expect(await other.text()).not.toContain('What it owes and holds');
  });
});
