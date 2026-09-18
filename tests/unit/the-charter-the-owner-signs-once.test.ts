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
  founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 30,
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
    expect(live!.daysLeft).toBeGreaterThanOrEqual(29);
    expect(live).toMatchObject({ testsTotalCents: 10_000, days: 30 });
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
    // Carved is every carve under this charter, and remaining is exactly what
    // the row would still admit — the reading and the guard say one thing.
    expect(r).toMatchObject({ carvedCents: 6000, inFlight: 3, roomForAnother: false, remainingCents: 4000 });
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

  it('refuses the carve over the charter, at the row, whatever the calendar', async () => {
    // One probe settles: it has an answer now, so its place is free.
    await query("UPDATE venture_experiments SET ran_at = datetime('now'), what_happened = 'nobody paid', verdict = 'as_predicted' WHERE id = ?", [X[0]]);
    expect((await envelopeReading(OWNER))!.roomForAnother).toBe(true);
    const c = await chartered({ founderId: OWNER, experimentId: X[3], costCents: 7000, rungs: ['public'] });
    expect(c.inside).toBe(false);
    if (!c.inside) expect(c.because[0]).toContain("$70.00 and $40.00 is left of the charter's $100.00 for tests");
    const live = (await liveCharter(OWNER))!;
    await expect(carve({ charterId: live.id, experimentId: X[3], productId: P[3], cents: 7000 })).rejects.toThrow(/over_the_charter/);
    // AND THE CALENDAR CANNOT REFILL IT. A carve dated in a previous month is
    // invisible to the month's sum and still counts against the total, which
    // is the whole point of the total: waiting for a month to turn buys
    // nothing. The row is written dated, because a carve is immutable.
    await query("UPDATE venture_experiments SET ran_at = datetime('now'), what_happened = 'nobody paid', verdict = 'as_predicted' WHERE id = ?", [X[1]]);
    await query(
      `INSERT INTO portfolio_envelope_carves (id, envelope_id, experiment_id, product_id, cents, carved_at)
       VALUES ('carve_last_month', ?, ?, ?, 4000, datetime('now','-45 days'))`, [live.id, X[3], P[3]]);
    const thisMonth = Number((await query(
      `SELECT coalesce(SUM(cents),0) AS n FROM portfolio_envelope_carves
        WHERE envelope_id = ? AND strftime('%Y-%m', carved_at) = strftime('%Y-%m','now')`, [live.id])).rows[0]!.n);
    expect(thisMonth).toBe(6000);
    const whole = (await envelopeReading(OWNER))!;
    expect(whole).toMatchObject({ carvedCents: 10_000, remainingCents: 0 });
    // Nothing more fits, though this calendar month has $40 of room in it.
    await expect(carve({ charterId: live.id, experimentId: X[4], productId: P[0], cents: 1 })).rejects.toThrow(/over_the_charter|not_this_tests_asset/);
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
  it('Controls points at the charter place; the place offers the signature when none stands; Home says nothing acts without him', async () => {
    const controls = await (await app.request('/foundry/controls')).text();
    expect(controls).toContain('</i>The charter</h2>');
    expect(controls).toContain('href="/foundry/charter"');
    expect(controls).not.toContain('Sign for 30 days');
    const place = await (await app.request('/foundry/charter')).text();
    // Earlier tests in this file signed and withdrew one, so the word is Withdrawn here; a fresh institution says Unsigned.
    expect(place).toMatch(/The charter <span class="state quiet none">(Unsigned|Withdrawn)<\/span>/);
    // A PROVING WINDOW LEADS. The longest term the row admits is not the default.
    expect(place).toContain('Sign for 30 days');
    expect(place).toContain('Recalculate the ceiling');
    expect(place).toContain('One message per person or business, ever');
    // AND IT SAYS WHAT IT DOES MEANWHILE, so an unsigned charter does not read
    // as a dead institution.
    expect(place).toContain('Before you sign');
    expect(place).toContain('It stops at one line');
    // The most it can cost: the tests total, plus the day's thinking across the
    // term. One figure, and no calendar in it.
    const { charterExposure } = await import('../../src/services/institution/charter.js');
    const ex = charterExposure({ testsTotalCents: 10_000, cognitionCentsPerDay: 300, days: 30 });
    expect(ex.periodMaxCents).toBe(19_000);
    expect(place).toContain('Total exposure');
    expect(place).toContain(`= <b>$${(ex.periodMaxCents / 100).toFixed(0)}</b>`);
    expect(place).toContain('<dt class="k">Tests</dt><dd class="v">$100</dd>');
    // Recalculated through a GET: the server's own arithmetic, no script, and
    // the term is his to choose among the three the page offers.
    const again = await (await app.request('/foundry/charter?tests_dollars=250&probes=4&thinking_dollars=5&days=90&statement=x')).text();
    const ex2 = charterExposure({ testsTotalCents: 25_000, cognitionCentsPerDay: 500, days: 90 });
    expect(ex2.periodMaxCents).toBe(70_000);
    expect(again).toContain(`= <b>$${(ex2.periodMaxCents / 100).toFixed(0)}</b>`);
    expect(again).toContain('value="250"');
    expect(again).toContain('value="4"');
    expect(again).toContain('Sign for 90 days');
    expect(again).toContain('value="90" checked');
    const home = await (await app.request('/foundry')).text();
    expect(home).not.toContain('Chartered');
  });

  it('the total exposure is the tests total plus the day\'s thinking across the term, and the calendar cannot move it', async () => {
    const { charterExposure } = await import('../../src/services/institution/charter.js');
    // The same numbers, signed on any day of any month, give the same total.
    for (const days of [30, 60, 90]) {
      const ex = charterExposure({ testsTotalCents: 10_000, cognitionCentsPerDay: 300, days });
      expect(ex).toMatchObject({ thinkingOverPeriodCents: 300 * days, periodMaxCents: 10_000 + 300 * days });
    }
    expect(charterExposure({ testsTotalCents: 25_000, cognitionCentsPerDay: 500, days: 90 }).periodMaxCents).toBe(70_000);
  });

  it('signed from Controls, the tile says Chartered and the card says what is left', async () => {
    const r = await app.request('/foundry/controls/charter', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'tests_dollars=100&probes=3&thinking_dollars=3&days=30&statement=A+river+of+nickels%2C+none+needing+me.',
    });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('charter=signed');
    const live = (await liveCharter(OWNER))!;
    expect(live).toMatchObject({ testsTotalCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, publicVoice: 'Apex Micro', days: 30 });
    const home = await (await app.request('/foundry')).text();
    expect(home).toContain('Chartered');
    expect(home).toContain('$100 of $100 left');
    expect(home).toContain('href="/foundry/charter" aria-label="The charter"');
    const controls = await (await app.request('/foundry/controls')).text();
    expect(controls).toContain('Active</span>');
    expect(controls).toContain('$100 of $100 left for tests · 0 of 3 in flight');
    const place = await (await app.request('/foundry/charter')).text();
    expect(place).toContain('The charter <span class="state watch">Active</span>');
    expect(place).toContain('Apex Micro, never you');
    expect(place).toContain('Renew as it stands, 30 days');
    expect(place).toContain('Withdraw it');
    expect(place).not.toContain('Sign for 30 days');
    expect(place).toContain(`signed founder:${OWNER}`);
    // Numbers are refused with the reason, and nothing changes.
    const bad = await app.request('/foundry/controls/charter', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'tests_dollars=5000&probes=3&thinking_dollars=3&days=30&statement=too+much',
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
    // Renewing AS IT STANDS keeps the term he chose, not the longest one going.
    expect(item!.yes).toMatchObject({ label: 'Renew for 5 days', action: '/foundry/controls/charter' });
    expect(item!.yes.fields).toMatchObject({ days: '5', tests_dollars: '100' });
    expect(item!.no).toMatchObject({ label: 'Let it lapse', action: '/foundry/controls/charter/withdraw' });
    const withdrawn = await app.request('/foundry/controls/charter/withdraw', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'reason=done+testing',
    });
    expect(withdrawn.status).toBe(302);
    expect(await liveCharter(OWNER)).toBeNull();
    expect((await pastCharters(OWNER)).map((x) => x.because)).toContain('done testing');
  });
});
