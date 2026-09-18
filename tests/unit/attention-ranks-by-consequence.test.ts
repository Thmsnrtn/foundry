process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordMaterial } from '../../src/services/venture/hand.js';
import { whatNeedsHim, type Attention, type OwnerState } from '../../src/routes/dashboard/foundry-shell.js';
import { whatIsBeingAskedOf, type AskedOfHim } from '../../src/services/institution/standing-intent.js';

// =============================================================================
// WHAT NEEDS HIM IS RANKED BY CONSEQUENCE, NOT BY WHICH TABLE IT LIVES IN.
//
// Home ranked by kind. A `proposed_act` came first whatever it was, so an act
// that reverses itself in a minute and costs nothing stood in front of the one
// signature that starts money moving — not because it mattered more, but
// because it was a row in `proposed_acts`. And among acts themselves, one that
// owes a buyer a refund ranked beside one that merely posts a page.
//
// Acts now carry a TIER, from columns that already exist: what the act commits
// him to (its rung), what it promises (its subject), and whether somebody is
// already owed something behind it. Three words, no score. The order on the
// first screen is the one OBJECTIVE.md §4 sets out: a bound or a promise, then
// a commitment already made, then an act that reaches the world, then money
// beginning to move, then everything reversible.
//
// And nothing ranked lower is hidden. Everything waiting is listed; ranking
// decides what is said first, never what is said at all.
// =============================================================================

const OWNER = 'ar_owner'; const FOUNDRY = 'ar_foundry'; const WORKSHOP = 'ar_workshop'; const X = 'ar_x';
let app: Hono;
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text() }; };
const oneThing = (t: string): string => t.includes('id="the-one-thing"')
  ? t.slice(t.indexOf('id="the-one-thing"'), t.indexOf('</section>', t.indexOf('id="the-one-thing"'))) : '';

/** An act as the first screen reads it, with only the fields the ranking uses. */
const act = (over: Partial<AskedOfHim>): AskedOfHim => ({
  id: 'a', productId: 'p', subject: 'publish', actionType: null,
  summary: 'do a thing', why: 'because', expectedEffect: 'an effect', risk: 'a risk',
  consequence: 'low' as AskedOfHim['consequence'], rung: 'reversible', rungMeans: null,
  puttingItBack: null, absorbable: true, costCents: 0,
  proposedAt: '2026-01-01 00:00:00', expiresAt: '2099-01-01 00:00:00', decision: null,
  companyName: 'A Company', owesCustomer: false, tier: 'internal', ...over,
});

/**
 * The smallest state this function reads. Cast because `OwnerState` carries
 * the whole first screen and the ranking reads eleven of its fields: writing
 * the other forty would obscure the four cases this file exists to prove.
 */
const state = (over: Partial<OwnerState>): OwnerState => ({
  acquisitions: [], asked: [], owed: [], routinesFailing: [], checks: [],
  grantable: [], permissions: [], pendingCandidates: [], responsibilities: [],
  elsewhere: [], record: 'not graded yet',
  charter: { live: false, workshop: null, readyTests: 0, sealedDesigns: 0 },
  ...over,
} as unknown as OwnerState);

/** A charter that would be the one thing if nothing above it spoke. */
const CHARTER_READY = { live: false, workshop: 'Apex Micro', readyTests: 1, sealedDesigns: 0 };

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_ar', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'test')`, [FOUNDRY]);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')", [WORKSHOP, OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [OWNER, WORKSHOP, 'Apex Micro', 'Owner', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '']);

  // A real test, ready to run, so the charter is genuinely the missing thing.
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for shops', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('ar_opp',?,?,'a brief worth paying for','shops','scattered notices','somebody pays','nobody pays','[]','real')`, [m.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('ar_unk',?,'ar_opp','will anyone pay',1,'write once')`, [OWNER]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'ar_opp','ar_unk','sell a brief','someone pays','nobody pays',2000,'real')`, [X, OWNER]);
  await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'deliverable', title: 'The brief', body: '# The brief\n\nA row.', by: 'test' });

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('an act carries what it would commit him to', () => {
  it('a promise or a bound is an obligation, whatever rung it sits on', async () => {
    // Read through the same function the first screen uses, so the tier is not
    // a test's own invention.
    await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
      VALUES ('ar_b1', ?, 'move_money', 'ask me before moving money', 'ask_first')`, [WORKSHOP]);
    await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
      VALUES ('ar_b2', ?, 'publish', 'ask me before publishing', 'ask_first')`, [WORKSHOP]);
    await query(
      `INSERT INTO proposed_acts (id, product_id, subject, action_type, params_fingerprint, summary, why,
        expected_effect, risk, consequence, rung, cost_cents, proposed_by, expires_at)
       VALUES ('ar_pub',?,'publish','publish_page','fp1','post the page','so it can be found',
               'a page','a wrong page','low','financial',50000,'hand:test',datetime('now','+1 day'))`, [WORKSHOP]);
    await query(
      `INSERT INTO proposed_acts (id, product_id, subject, action_type, params_fingerprint, summary, why,
        expected_effect, risk, consequence, rung, cost_cents, proposed_by, expires_at)
       VALUES ('ar_ref',?,'move_money','stripe_create_refund','fp2','refund a buyer','they asked',
               'money back','none','low','reversible',0,'hand:test',datetime('now','+1 day'))`, [WORKSHOP]);

    const asked = await whatIsBeingAskedOf(OWNER);
    // By rung and by money the published page outranks a $0 reversible refund.
    // By what it promises, it does not: somebody is waiting for their money.
    expect(asked.map((a) => a.id)).toEqual(['ar_ref', 'ar_pub']);
    expect(asked[0]?.tier).toBe('obligation');
    expect(asked[1]?.tier).toBe('external');
  });

  it('a reversible internal act is what it is', () => {
    expect(act({ rung: 'reversible' }).tier).toBe('internal');
  });
});

describe('what Home says first', () => {
  const kindOf = (a: Attention): string => (a === null ? 'nothing' : a.kind);

  it('an obligation outranks the charter', () => {
    const a = whatNeedsHim(state({
      charter: CHARTER_READY,
      asked: [act({ id: 'owed_one', subject: 'move_money', rung: 'reversible', costCents: 0, tier: 'obligation' })],
    }));
    expect(kindOf(a)).toBe('spend');
    expect(a !== null && a.kind === 'spend' ? a.actId : '').toBe('owed_one');
  });

  it('a commitment already made outranks an act that only reaches the world', () => {
    const a = whatNeedsHim(state({
      charter: CHARTER_READY,
      owed: [{ predictionId: 'ar_x', about: 'the brief', expected: 'someone pays',
        wouldDisprove: 'nobody pays', dueAt: '2026-01-01', overdue: true } as never],
      asked: [act({ id: 'outside', rung: 'financial', costCents: 40000, tier: 'external' })],
    }));
    expect(kindOf(a)).toBe('grade');
  });

  it('a financial act outranks the charter; the same act reversible and free does not', () => {
    const withMoney = whatNeedsHim(state({
      charter: CHARTER_READY,
      asked: [act({ id: 'outside', rung: 'financial', costCents: 40000, tier: 'external' })],
    }));
    expect(kindOf(withMoney)).toBe('spend');

    const housekeeping = whatNeedsHim(state({
      charter: CHARTER_READY,
      asked: [act({ id: 'tidy', rung: 'reversible', costCents: 0, tier: 'internal' })],
    }));
    expect(kindOf(housekeeping)).toBe('charter');
  });

  it('the charter outranks Foundry asking for wider authority over itself', () => {
    const a = whatNeedsHim(state({
      charter: CHARTER_READY,
      grantable: [{ responsibilityId: 'r1', title: 'Keep its own checks', check: 'c1',
        path: 'src/x.ts', verification: ['a check'], matched: 3, wrong: 0,
        layer: 'kernel', layerPlainly: 'the shared institution' } as never],
    }));
    expect(kindOf(a)).toBe('charter');
  });

  it('and a blocking acquisition waits behind money beginning to move', () => {
    const a = whatNeedsHim(state({
      charter: CHARTER_READY,
      acquisitions: [{ id: 'acq', blocking: true, capabilityKey: 'k', whatItDoes: 'a thing',
        rung: 'financial', provider: 'someone', costNote: 'a note', because: 'needed',
        route: 'buy', enables: [], doesNotAuthorize: [], economics: [] } as never],
    }));
    expect(kindOf(a)).toBe('charter');
  });
});

describe('nothing is hidden by being ranked lower', () => {
  it('with the charter first, a reversible act is still there, waiting on him', async () => {
    // Both acts from the first case are still open, so the rendered screen has
    // a charter to sign and acts beneath it.
    await query(`UPDATE proposed_acts SET decision = 'refused', decided_by = ?, decided_at = datetime('now') WHERE id IN ('ar_pub','ar_ref')`, [`founder:${OWNER}`]);
    await query(
      `INSERT INTO proposed_acts (id, product_id, subject, action_type, params_fingerprint, summary, why,
        expected_effect, risk, consequence, rung, cost_cents, proposed_by, expires_at)
       VALUES ('ar_tidy',?,'publish','publish_page','fp3','tidy the description','it is out of date',
               'a truer page','none','low','reversible',0,'hand:test',datetime('now','+1 day'))`, [WORKSHOP]);

    const t = (await page('/foundry')).text;
    expect(oneThing(t)).toContain('Needs your operating charter.');
    // And the act nobody read first is not the act nobody sees.
    expect(t).toContain('Also waiting on you');
    expect(t).toContain('tidy the description');
  });
});
