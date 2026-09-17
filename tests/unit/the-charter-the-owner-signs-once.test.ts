process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  carve, chartered, charterPrincipal, envelopeReading, liveCharter, pastCharters, signCharter, withdrawCharter,
} from '../../src/services/institution/charter.js';
import { decideProposedAct, proposeAct, setBoundary, spendApprovalFor } from '../../src/services/institution/standing-intent.js';

// =============================================================================
// THE CHARTER THE OWNER SIGNS ONCE.
//
// A studio that asks him before each small thing makes him the job. The
// charter is his standing word: so much a month, so many probes in flight, so
// much thinking a day, the sealed rules for writing to people, the Workshop as
// the only public voice, and an end date. Inside it a probe is let in and its
// acts are decided as `charter:<id>`; outside it, nothing changes.
//
// What is proved here is that the authority is the database's: the signature
// must be his, the envelope refuses the fourth probe and the carve over the
// month, and the act-decision guard admits the charter's principal only while
// the envelope is live — withdrawn or expired, it is refused like a stranger.
// =============================================================================

const OWNER = 'ch_owner';
const OTHER = 'ch_other';
const WORKSHOP = 'ch_ws';
const X = ['ch_x1', 'ch_x2', 'ch_x3', 'ch_x4', 'ch_x5'] as const;
const P = ['ch_p1', 'ch_p2', 'ch_p3', 'ch_p4', 'ch_p5'] as const;
const THEIRS = 'ch_theirs';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?),(?,?,?,?)',
    [OWNER, 'clerk_ch', 'owner@example.com', 'Owner', OTHER, 'clerk_ch2', 'other@example.com', 'Other']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for shops', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  const mandateId = m.id;
  for (let i = 0; i < X.length; i++) {
    const opp = `ch_opp${String(i)}`; const unk = `ch_unk${String(i)}`;
    await query(
      `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
       VALUES (?,?,?,'a brief worth paying for','shops','scattered notices','somebody pays','nobody pays','[]','real')`, [opp, mandateId, OWNER]);
    await query(
      `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
       VALUES (?,?,?,'will anyone pay',1,'write once')`, [unk, OWNER, opp]);
    await query(
      `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,'real')`, [X[i], OWNER, opp, unk, 'sell a brief', 'someone pays', 'nobody pays', 2000]);
    // Four are approved and have their experimental asset, as a decided test
    // does; the fifth is undecided, so the hand can be asked about it.
    if (i < 4) {
      await query("UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'), decided_by = ? WHERE id = ?", [`founder:${OWNER}`, X[i]]);
      await query(
        `INSERT INTO products (id, name, owner_id, status, standing, from_experiment_id, reality)
         VALUES (?,?,?,'active','experimental',?,'real')`, [P[i], `Probe ${String(i + 1)}`, OWNER, X[i]]);
    }
  }
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Theirs',?,'active')", [THEIRS, OTHER]);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')", [WORKSHOP, OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [OWNER, WORKSHOP, 'Apex Micro', 'Owner', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '']);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

const signed = (overrides: Partial<Parameters<typeof signCharter>[0]> = {}) => signCharter({
  founderId: OWNER, monthlyCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300,
  publicVoice: 'Apex Micro', statement: 'A river of nickels, none of them needing me.', ...overrides,
});

describe('only he can sign it, and it ends', () => {
  it('refuses a signature that is not the owner\'s, at the row', async () => {
    for (const by of ['institution:foundry', 'hand:the-hand', `founder:${OTHER}`]) {
      await expect(query(
        `INSERT INTO portfolio_envelopes (id, founder_id, monthly_cents, probes_in_flight, cognition_cents_per_day, contact_rules, public_voice, statement, signed_by, expires_at)
         VALUES ('ch_forged', ?, 10000, 3, 300, 'rules', 'Apex Micro', 'why', ?, datetime('now', '+30 days'))`, [OWNER, by]))
        .rejects.toThrow(/only_the_owner_signs/);
    }
  });

  it('refuses an envelope that would outlast a quarter, or never end', async () => {
    await expect(query(
      `INSERT INTO portfolio_envelopes (id, founder_id, monthly_cents, probes_in_flight, cognition_cents_per_day, contact_rules, public_voice, statement, signed_by, expires_at)
       VALUES ('ch_long', ?, 10000, 3, 300, 'rules', 'Apex Micro', 'why', ?, datetime('now', '+120 days'))`, [OWNER, `founder:${OWNER}`]))
      .rejects.toThrow(/must_end_within_a_quarter/);
  });

  it('stands once signed, one at a time, and a new signature ends the old one with the reason on record', async () => {
    expect(await liveCharter(OWNER)).toBeNull();
    const first = await signed();
    const live = await liveCharter(OWNER);
    expect(live).toMatchObject({ id: first, monthlyCents: 10_000, probesInFlight: 3, publicVoice: 'Apex Micro', signedBy: `founder:${OWNER}` });
    expect(live!.daysLeft).toBeGreaterThanOrEqual(89);
    expect(live!.contactRules).toContain('One message per person or business, ever');
    await expect(query(
      `INSERT INTO portfolio_envelopes (id, founder_id, monthly_cents, probes_in_flight, cognition_cents_per_day, contact_rules, public_voice, statement, signed_by, expires_at)
       VALUES ('ch_second', ?, 10000, 3, 300, 'rules', 'Apex Micro', 'why', ?, datetime('now', '+30 days'))`, [OWNER, `founder:${OWNER}`]))
      .rejects.toThrow(/already_one/);
    const second = await signed({ monthlyCents: 12_000 });
    expect((await liveCharter(OWNER))!.id).toBe(second);
    expect(await pastCharters(OWNER)).toMatchObject([{ id: first, because: 'replaced by a new signature' }]);
    // What he signed is what he signed.
    await expect(query('UPDATE portfolio_envelopes SET monthly_cents = 99999 WHERE id = ?', [second])).rejects.toThrow(/immutable/);
    await expect(query('DELETE FROM portfolio_envelopes WHERE id = ?', [second])).rejects.toThrow(/immutable/);
  });
});

describe('the envelope is arithmetic over rows, and the rows refuse', () => {
  it('lets three probes in, refuses the fourth, and reads the remainder', async () => {
    const live = (await liveCharter(OWNER))!;
    for (let i = 0; i < 3; i++) {
      const c = await chartered({ founderId: OWNER, experimentId: X[i], costCents: 2000, rungs: ['public', 'financial'] });
      expect(c.inside, JSON.stringify(c)).toBe(true);
      await carve({ charterId: live.id, experimentId: X[i], productId: P[i], cents: 2000 });
    }
    const r = (await envelopeReading(OWNER))!;
    expect(r).toMatchObject({ carvedCents: 6000, inFlight: 3, roomForAnother: false, remainingCents: 6000 });
    const fourth = await chartered({ founderId: OWNER, experimentId: X[3], costCents: 2000, rungs: ['public'] });
    expect(fourth.inside).toBe(false);
    if (!fourth.inside) expect(fourth.because.join(' ')).toContain('3 of 3 probes are already in flight');
    await expect(carve({ charterId: live.id, experimentId: X[3], productId: P[3], cents: 2000 })).rejects.toThrow(/no_room_in_flight/);
    // A carve for another test's asset, or a second carve for the same test, is refused where it is written.
    await expect(carve({ charterId: live.id, experimentId: X[3], productId: P[0], cents: 1 })).rejects.toThrow(/not_this_tests_asset|already_carved|no_room/);
    await expect(carve({ charterId: live.id, experimentId: X[0], productId: P[0], cents: 1 })).rejects.toThrow(/already_carved/);
  });

  it('never covers the legal or destructive rung, whatever is left', async () => {
    const c = await chartered({ founderId: OWNER, experimentId: X[4], costCents: 0, rungs: ['legal'] });
    expect(c.inside).toBe(false);
    if (!c.inside) expect(c.because[0]).toContain('legal rung is yours to decide each time');
  });

  it('refuses the carve over the month, at the row', async () => {
    // One probe settles: it has an answer now, so its place is free.
    await query("UPDATE venture_experiments SET ran_at = datetime('now'), what_happened = 'nobody paid', verdict = 'as_predicted' WHERE id = ?", [X[0]]);
    expect((await envelopeReading(OWNER))!.roomForAnother).toBe(true);
    const c = await chartered({ founderId: OWNER, experimentId: X[3], costCents: 7000, rungs: ['public'] });
    expect(c.inside).toBe(false);
    if (!c.inside) expect(c.because[0]).toContain('$70.00 and $60.00 is left');
    const live = (await liveCharter(OWNER))!;
    await expect(carve({ charterId: live.id, experimentId: X[3], productId: P[3], cents: 7000 })).rejects.toThrow(/over_the_month/);
  });
});

describe('the charter decides an act only while it stands', () => {
  it('is admitted by the act-decision guard as charter:<id>, and refused once withdrawn', async () => {
    await setBoundary({ productId: P[1], subject: 'contact_people', mode: 'ask_first', statement: 'Ask me before writing to anyone for this test' });
    const live = (await liveCharter(OWNER))!;
    const actId = await proposeAct({
      productId: P[1], subject: 'contact_people', actionType: 'send_email', params: { to: 'shop@example.com' },
      summary: 'Write once to the shop', why: 'the test', expectedEffect: 'one email', risk: 'one email',
      consequence: 'low', rung: 'public', costCents: 0, proposedBy: 'hand:the-hand', validForHours: 48,
    });
    await decideProposedAct({ id: actId, decision: 'approved', decidedBy: charterPrincipal(live.id) });
    expect(await spendApprovalFor({ productId: P[1], actionType: 'send_email', paramsFingerprint: null })).not.toBeNull();
    // Not at somebody else's company.
    await setBoundary({ productId: THEIRS, subject: 'contact_people', mode: 'ask_first', statement: 'Ask me' });
    const theirs = await proposeAct({
      productId: THEIRS, subject: 'contact_people', actionType: 'send_email', params: { to: 'x@example.com' },
      summary: 'Write', why: 'w', expectedEffect: 'e', risk: 'r', consequence: 'low', rung: 'public', costCents: 0, proposedBy: 'hand:the-hand', validForHours: 48,
    });
    await expect(decideProposedAct({ id: theirs, decision: 'approved', decidedBy: charterPrincipal(live.id) })).rejects.toThrow(/not_the_owner/);
    // Withdrawn: the same principal is a stranger.
    expect(await withdrawCharter({ founderId: OWNER, reason: 'testing the withdrawal' })).toBe(true);
    expect(await liveCharter(OWNER)).toBeNull();
    const after = await proposeAct({
      productId: P[1], subject: 'contact_people', actionType: 'send_email', params: { to: 'second@example.com' },
      summary: 'Write once more', why: 'the test', expectedEffect: 'one email', risk: 'one email',
      consequence: 'low', rung: 'public', costCents: 0, proposedBy: 'hand:the-hand', validForHours: 48,
    });
    await expect(decideProposedAct({ id: after, decision: 'approved', decidedBy: charterPrincipal(live.id) })).rejects.toThrow(/not_the_owner/);
    // Nothing is let in under a charter that has ended.
    await expect(carve({ charterId: live.id, experimentId: X[4], productId: P[4], cents: 1 })).rejects.toThrow(/no_live_charter/);
  });

  it('the hand refuses to allow a test under the charter when none stands, before anything is decided', async () => {
    const { allowExperiment, HandRefused } = await import('../../src/services/venture/hand.js');
    await expect(allowExperiment({ founderId: OWNER, experimentId: X[4], under: 'the charter' })).rejects.toThrow(HandRefused);
    await expect(allowExperiment({ founderId: OWNER, experimentId: X[4], under: 'the charter' })).rejects.toThrow(/outside_the_charter: no charter is standing/);
    expect((await query('SELECT decision FROM venture_experiments WHERE id = ?', [X[4]])).rows[0]!.decision).toBeNull();
  });
});

describe('what he sees', () => {
  it('Controls offers the signature when none stands, and Home says nothing acts without him', async () => {
    const controls = await (await app.request('/foundry/controls')).text();
    expect(controls).toContain('</i>The charter</h2>');
    expect(controls).toContain('Sign for 90 days');
    expect(controls).toContain('One message per person or business, ever');
    const home = await (await app.request('/foundry')).text();
    expect(home).not.toContain('Chartered');
  });

  it('signed from Controls, the tile says Chartered and the card says what is left', async () => {
    const r = await app.request('/foundry/controls/charter', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'monthly_dollars=100&probes=3&thinking_dollars=3&statement=A+river+of+nickels%2C+none+needing+me.',
    });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('charter=signed');
    const live = (await liveCharter(OWNER))!;
    expect(live).toMatchObject({ monthlyCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, publicVoice: 'Apex Micro' });
    const home = await (await app.request('/foundry')).text();
    expect(home).toContain('Chartered');
    expect(home).toContain('$100 of $100 left this month · 0 of 3 in flight');
    const controls = await (await app.request('/foundry/controls')).text();
    expect(controls).toContain('Signed</span>');
    expect(controls).toContain('by you on');
    expect(controls).toContain('Apex Micro, never you');
    expect(controls).toContain('Renew as it stands, 90 days');
    // Numbers are refused with the reason, and nothing changes.
    const bad = await app.request('/foundry/controls/charter', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'monthly_dollars=5000&probes=3&thinking_dollars=3&statement=too+much',
    });
    expect(bad.headers.get('location')).toContain('charter=error');
    expect((await liveCharter(OWNER))!.id).toBe(live.id);
  });

  it('asks once, from the front page, when the charter is a week from ending', async () => {
    const { waitingOn } = await import('../../src/services/founder/attention.js');
    expect((await waitingOn(OWNER)).filter((i) => i.kind === 'charter')).toEqual([]);
    await signed({ days: 5 });
    const item = (await waitingOn(OWNER)).find((i) => i.kind === 'charter');
    expect(item).toBeDefined();
    expect(item!.summary).toMatch(/The charter ends in [45] days/);
    expect(item!.yes).toMatchObject({ label: 'Renew for 90 days', action: '/foundry/controls/charter' });
    expect(item!.no).toMatchObject({ label: 'Let it lapse', action: '/foundry/controls/charter/withdraw' });
    const withdrawn = await app.request('/foundry/controls/charter/withdraw', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'reason=done+testing',
    });
    expect(withdrawn.status).toBe(302);
    expect(await liveCharter(OWNER)).toBeNull();
    expect((await pastCharters(OWNER)).map((x) => x.because)).toContain('done testing');
  });
});
