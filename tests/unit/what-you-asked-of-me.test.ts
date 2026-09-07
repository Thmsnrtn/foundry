// =============================================================================
// WHAT YOU ASKED OF ME
//
// The owner speaks in verbs. Before this, "investigate why customers aren't
// converting", "fix it", "spend less here" and "handle it" fell to "I did not
// follow that", or were quietly filed as what the company is for. Now a verb
// the institution can take on becomes an UNDERTAKING: his words verbatim, what
// it was understood as shown before it bound, and every step since a sentence
// resting on a row. Taking it on grants nothing.
//
// This asks, sentence by sentence, what happens — and that nothing binds from
// any door without him seeing what he said.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'asked_owner';
const STRANGER = 'asked_stranger';
let app: Hono;
let tidewater = '';
let invented = '';

const post = (path: string, fields: Record<string, string>) => app.request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});
const get = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, html: await res.text(), location: res.headers.get('location') };
};
const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number(((await query(sql, params)).rows[0] as Record<string, unknown>)?.n ?? 0);
const said = (text: string) => post(`/foundry/companies/${tidewater}/said`, { said: text });
/** Confirm as the page would: with what was shown travelling alongside his words. */
const confirm = async (text: string, as: string) => {
  const { readUndertaking } = await import('../../src/services/institution/undertaking.js');
  const understood = as === 'undertaking' ? readUndertaking(text)?.understoodAs ?? '' : '';
  return post(`/foundry/companies/${tidewater}/said/confirm`, { said: text, as, understood });
};

beforeAll(async () => {
  await runMigrations();
  for (const [id, clerk] of [[OWNER, 'clerk_asked'], [STRANGER, 'clerk_asked_2']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [id, clerk, `${id}@example.com`, 'Thomas Norton']);
  }
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  const { placeRoutes } = await import('../../src/routes/dashboard/places.js');
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
  app.route('/', placeRoutes);
  app.route('/', letterRoutes);
  await post('/foundry/companies', { name: 'Tidewater' });
  tidewater = String((await query(`SELECT id FROM products WHERE owner_id = ? AND name = 'Tidewater'`, [OWNER])).rows[0]?.id);
  await post('/foundry/reference', { scenario: 'revenue_quietly_falling' });
  invented = String((await query(`SELECT id FROM products WHERE owner_id = ? AND reality = 'reference' ORDER BY rowid LIMIT 1`, [OWNER])).rows[0]?.id);
});

describe('the reader, sentence by sentence', () => {
  it('hears the verbs the owner actually uses, and refuses what it does not know', async () => {
    const { readUndertaking } = await import('../../src/services/institution/undertaking.js');
    const heard = (s: string) => readUndertaking(s)?.kind ?? null;
    expect(heard('Investigate why customers aren\'t converting')).toBe('investigate');
    expect(readUndertaking('Investigate why customers aren\'t converting')?.understoodAs).toBe('find out why customers aren\'t converting');
    expect(heard('Why aren\'t customers converting?')).toBe('investigate');
    expect(readUndertaking('Why aren\'t customers converting?')?.understoodAs).toBe('answer “Why aren\'t customers converting?”');
    expect(heard('Investigate it.')).toBe('investigate');
    expect(heard('Grow this.')).toBe('grow');
    expect(heard('Fix it.')).toBe('fix');
    expect(heard('Test that.')).toBe('test');
    expect(heard('Use the cheaper approach.')).toBe('economise');
    expect(heard('Spend less here.')).toBe('economise');
    expect(heard('Handle it.')).toBe('handle');
    expect(heard('Adopt AcreOS.')).toBe('understand');
    // Questions about Foundry, and sentences with no verb, are not work.
    expect(heard('Why?')).toBeNull();
    expect(heard('Why do you say that?')).toBeNull();
    expect(heard('What makes you say that')).toBeNull();
    expect(heard('Show me what you\'re doing.')).toBeNull();
    expect(heard('Create something.')).toBeNull();
    expect(heard('Stop that.')).toBeNull();
    expect(heard('the weather is nice')).toBeNull();
  });
});

describe('a verb said on a company page', () => {
  it('is shown back as what would be undertaken, and nothing binds until he says yes', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM undertakings');
    const res = await said('Investigate why customers aren\'t converting');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Take this on?');
    expect(html).toContain('find out why customers aren&#39;t converting');
    expect(html).toContain('name="as" value="undertaking"');
    expect(await count('SELECT COUNT(*) AS n FROM undertakings')).toBe(before);
    expect(await count('SELECT COUNT(*) AS n FROM owner_objectives WHERE product_id = ?', [tidewater])).toBe(0);
  });

  it('once confirmed, it is a thread: his words, the first look from rows, and what it needs', async () => {
    const res = await confirm('Investigate why customers aren\'t converting', 'undertaking');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/foundry/companies/${tidewater}/work?done=undertaken#underway`);
    const u = await import('../../src/services/institution/undertaking.js');
    const open = await u.openUndertakings(tidewater);
    expect(open).toHaveLength(1);
    expect(open[0]?.kind).toBe('investigate');
    expect(open[0]?.asked).toBe('Investigate why customers aren\'t converting');
    expect(open[0]?.evidenceMode).toBe('real');
    const thread = await u.threadOf(String(open[0]?.id));
    const kinds = thread.steps.map((s) => s.kind);
    expect(kinds[0]).toBe('you_said');
    expect(kinds).toContain('looked');
    expect(kinds).toContain('needs');
    const needs = thread.steps.filter((s) => s.kind === 'needs');
    // With nothing connected, what it needs is named as a sense it could be let see.
    expect(needs.some((s) => s.ref?.kind === 'sense')).toBe(true);
    // The thread holds no money of its own; spend stays in the ledger.
    expect(thread.costCents).toBe(0);
    expect((await query(`PRAGMA table_info(undertaking_steps)`)).rows.map((r) => String((r as Record<string, unknown>).name)))
      .not.toContain('cost_cents');
  });

  it('the Work place shows the thread, the chip counts it, and the why page reads it', async () => {
    const work = await get(`/foundry/companies/${tidewater}/work?done=undertaken`);
    expect(work.status).toBe(200);
    expect(work.html).toContain('Taken on.');
    expect(work.html).toContain('<h2>Under way</h2>');
    expect(work.html).toContain('find out why customers aren&#39;t converting');
    expect(work.html).toContain('You said: &ldquo;Investigate why customers aren&#39;t converting&rdquo;');
    expect(work.html).toMatch(/<span class="k">you said<\/span>/);
    expect(work.html).toMatch(/<span class="k">need<\/span>/);
    expect(work.html).toContain('1 thing is under way because you asked or agreed');
    const overview = await get(`/foundry/companies/${tidewater}`);
    expect(overview.html).toContain('<span class="chip">1 under way</span>');
    const id = String((await query('SELECT id FROM undertakings WHERE product_id = ?', [tidewater])).rows[0]?.id);
    const why = await get(`/foundry/why/undertaking/${id}`);
    expect(why.status).toBe(200);
    expect(why.html).toContain('Why I am working to find out why customers aren&#39;t converting');
    expect(why.html).toContain('You said: “Investigate why customers aren&#39;t converting”');
    expect(why.html).toContain('undertakings');
    expect(why.html).toContain('Open.');
  });

  it('is what "what are you doing" answers with, on the first screen', async () => {
    const { html } = await get(`/foundry?q=${encodeURIComponent('what are you working on?')}`);
    expect(html).toContain('Under way, because you asked or agreed');
    expect(html).toContain('Tidewater');
    expect(html).toContain('find out why customers aren&#39;t converting');
  });

  it('a why-question typed into the composer is offered as work, not sent to the work behind a claim', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM undertakings');
    const res = await get(`/foundry/companies/${tidewater}?q=${encodeURIComponent('Why aren\'t customers converting?')}`);
    expect(res.status).toBe(200);
    expect(res.html).toContain('That sounds like something for me to do');
    expect(res.html).toContain('Nothing has started');
    expect(res.html).toContain('name="as" value="undertaking"');
    expect(await count('SELECT COUNT(*) AS n FROM undertakings')).toBe(before);
    const foundry = await get(`/foundry/companies/${tidewater}?q=${encodeURIComponent('why do you say that?')}`);
    expect(foundry.status).toBe(302);
    expect(foundry.location).toBe(`/foundry/why/company/${tidewater}`);
  });

  it('every other verb reads to the right undertaking, and none binds before the confirm', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM undertakings');
    for (const [sentence, kind] of [
      ['Grow this.', 'grow'], ['Fix it.', 'fix'], ['Test that.', 'test'],
      ['Use the cheaper approach.', 'economise'], ['Spend less here.', 'economise'],
      ['Handle it.', 'handle'], ['Adopt this business I bought.', 'understand'],
    ] as const) {
      const html = await (await said(sentence)).text();
      expect(html, sentence).toContain('Take this on?');
      const { readUndertaking } = await import('../../src/services/institution/undertaking.js');
      expect(readUndertaking(sentence)?.kind, sentence).toBe(kind);
    }
    expect(await count('SELECT COUNT(*) AS n FROM undertakings')).toBe(before);
    expect(await count('SELECT COUNT(*) AS n FROM owner_objectives WHERE product_id = ?', [tidewater])).toBe(0);
    // "Kill this" is still a change of posture, not work.
    const kill = await (await said('Kill this.')).text();
    expect(kill).toContain('Change what I am doing with Tidewater?');
    expect(kill).not.toContain('Take this on?');
  });

  it('"spend less here" and "handle it" open with what they found, from rows', async () => {
    await confirm('Spend less here.', 'undertaking');
    await confirm('Handle it.', 'undertaking');
    const u = await import('../../src/services/institution/undertaking.js');
    const open = await u.openUndertakings(tidewater);
    const economise = open.find((x) => x.kind === 'economise');
    const handle = open.find((x) => x.kind === 'handle');
    expect(economise && handle).toBeTruthy();
    const e = await u.threadOf(String(economise?.id));
    expect(e.steps.some((s) => s.kind === 'found' && /No money left this company in thirty days/.test(s.said))).toBe(true);
    const h = await u.threadOf(String(handle?.id));
    expect(h.steps.some((s) => s.kind === 'needs' && /Nothing is in my hands here yet/.test(s.said))).toBe(true);
  });

  it('a replayed confirmation opens nothing twice', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater]);
    const again = await confirm('Spend less here.', 'undertaking');
    expect(again.status).toBe(302);
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater])).toBe(before);
    // And the schema holds the same line if two arrive at once.
    const open = (await query(`SELECT id, asked, understood_as FROM undertakings WHERE product_id = ? AND asked = 'Spend less here.' AND closed_at IS NULL`, [tidewater])).rows[0] as Record<string, unknown>;
    await expect(query(
      `INSERT INTO undertakings (id, founder_id, product_id, kind, asked, understood_as, opened_by, opened_from_kind, evidence_mode)
       VALUES ('u_dup', ?, ?, 'economise', 'Spend less here.', ?, ?, 'owner', 'real')`, [OWNER, tidewater, String(open.understood_as), `founder:${OWNER}`]))
      .rejects.toThrow(/UNIQUE|unique/);
  });

  it('a confirmation binds exactly what was shown: a stale reading is shown again and binds nothing', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM undertakings');
    const res = await post(`/foundry/companies/${tidewater}/said/confirm`,
      { said: 'Test that.', as: 'undertaking', understood: 'something the reader no longer says' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Let me say that again');
    expect(html).toContain('nothing has started');
    const hidden = /name="understood" value="([^"]*)"/.exec(html)?.[1];
    const { readUndertaking } = await import('../../src/services/institution/undertaking.js');
    expect(hidden).toBe(readUndertaking('Test that.')?.understoodAs);
    expect(hidden).toMatch(/^turn .* into one sealed prediction/);
    expect(await count('SELECT COUNT(*) AS n FROM undertakings')).toBe(before);
  });

  it('"stop that" with several things under way asks which, and drops nothing', async () => {
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater])).toBe(3);
    const page = await (await said('Stop that.')).text();
    expect(page).toContain('Which one?');
    expect(page).toContain('Stop this one');
    expect(page).toContain('Stop all 3');
    const res = await confirm('Stop that.', '');
    expect(res.headers.get('location')).toBe(`/foundry/companies/${tidewater}/work?done=which#underway`);
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater])).toBe(3);
    const work = await get(`/foundry/companies/${tidewater}/work?done=which`);
    expect(work.html).toContain('Nothing stopped.');
  });

  it('stopping one thread stops that one only', async () => {
    const one = String((await query(`SELECT id FROM undertakings WHERE product_id = ? AND kind = 'handle' AND closed_at IS NULL`, [tidewater])).rows[0]?.id);
    const res = await post(`/foundry/undertakings/${one}/stop`, {});
    expect(res.headers.get('location')).toBe(`/foundry/companies/${tidewater}/work?done=dropped`);
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater])).toBe(2);
    expect(await count(`SELECT COUNT(*) AS n FROM undertakings WHERE id = ? AND closed_as = 'dropped'`, [one])).toBe(1);
  });

  it('"stop that" with exactly one thread open stops that thread, and leaves what the company is for', async () => {
    await query(`INSERT INTO owner_objectives (id, product_id, statement, focus_json) VALUES ('obj_asked', ?, 'make it steady', '[]')`, [tidewater]);
    const one = String((await query(`SELECT id FROM undertakings WHERE product_id = ? AND kind = 'economise' AND closed_at IS NULL`, [tidewater])).rows[0]?.id);
    await post(`/foundry/undertakings/${one}/stop`, {});
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater])).toBe(1);
    const page = await (await said('Stop that.')).text();
    expect(page).toContain('Stop this?');
    expect(page).toContain('find out why customers aren&#39;t converting');
    expect(page).toContain('What you told me this company is for stays as it is');
    const res = await confirm('Stop that.', '');
    expect(res.headers.get('location')).toBe(`/foundry/companies/${tidewater}?done=stopped`);
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater])).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM owner_objectives WHERE id = 'obj_asked' AND retired_at IS NULL`)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_as = 'dropped'`, [tidewater])).toBe(3);
    const work = await get(`/foundry/companies/${tidewater}/work`);
    expect(work.html).not.toContain('<h2>Under way</h2>');
    expect(work.html).toContain('<h2>Lately closed</h2>');
  });

  it('"stop everything on this" is the only way to stop all of them at once', async () => {
    await confirm('Fix it.', 'undertaking');
    await confirm('Grow this.', 'undertaking');
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater])).toBe(2);
    const page = await (await said('Stop everything on this company.')).text();
    expect(page).toContain('Stop this?');
    expect(page).toContain('find what is broken');
    expect(page).toContain('find where growth is being lost');
    const res = await confirm('Stop everything on this company.', '');
    expect(res.headers.get('location')).toBe(`/foundry/companies/${tidewater}?done=stopped`);
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ? AND closed_at IS NULL', [tidewater])).toBe(0);
    // The thread is final: no step after the close, and no second close.
    const id = String((await query('SELECT id FROM undertakings WHERE product_id = ? LIMIT 1', [tidewater])).rows[0]?.id);
    await expect(query(`INSERT INTO undertaking_steps (id, undertaking_id, founder_id, kind, said, actor) VALUES ('us_late', ?, ?, 'looked', 'too late', 'test')`, [id, OWNER]))
      .rejects.toThrow(/undertaking_is_closed/);
    await expect(query(`UPDATE undertakings SET closed_at = CURRENT_TIMESTAMP, closed_as = 'done', closed_by = 'test' WHERE id = ?`, [id]))
      .rejects.toThrow(/already_closed/);
  });
});

describe('the institution opens threads of its own', () => {
  it('agreeing to advice opens an undertaking from the recommendation, grants nothing, and only an act proposed inside it steps it', async () => {
    const u0 = await import('../../src/services/institution/undertaking.js');
    await u0.dropEverythingUnderWay({ founderId: OWNER, productId: tidewater, because: 'clearing the table', by: `founder:${OWNER}` });
    const authority = async () => ({
      allowances: await count('SELECT COUNT(*) AS n FROM owner_allowances'),
      boundaries: await count('SELECT COUNT(*) AS n FROM owner_boundaries'),
      consents: await count('SELECT COUNT(*) AS n FROM autonomy_consents'),
      acquisitions: await count('SELECT COUNT(*) AS n FROM capability_acquisitions'),
      acts: await count('SELECT COUNT(*) AS n FROM proposed_acts'),
      delegations: await count('SELECT COUNT(*) AS n FROM delegations').catch(() => -1),
      outbound: await count('SELECT COUNT(*) AS n FROM outbound_actions'),
    });
    const authorityBefore = await authority();
    for (const [days, cents] of [[40, 300000], [30, 290000], [20, 270000], [10, 250000], [0, 220000]]) {
      await query(`INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents) VALUES (?,?,date('now', ?),?)`,
        [`ms_asked_${String(days)}`, tidewater, `-${String(days)} day`, cents]);
    }
    await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
      VALUES ('cs_asked_rev', ?, 'revenue', 'stripe', 'real', 'revenue numbers, read only')`, [tidewater]);
    const { recordSituation, recommendFor } = await import('../../src/services/founder/situation-chain.js');
    await recordSituation(tidewater);
    const advice = await recommendFor(tidewater);
    expect(advice.length).toBeGreaterThan(0);
    const first = advice[0];
    const res = await post(`/foundry/advice/${String(first?.id)}/accept`, {});
    expect(res.status).toBe(302);
    const u = await import('../../src/services/institution/undertaking.js');
    const open = await u.openUndertakings(tidewater);
    expect(open).toHaveLength(1);
    expect(open[0]?.asked).toBeNull();
    expect(open[0]?.openedFrom).toEqual({ kind: 'recommendation', id: first?.id });
    expect(open[0]?.understoodAs).toBe(first?.summary);
    let thread = await u.threadOf(String(open[0]?.id));
    expect(thread.steps.some((s) => s.kind === 'you_said' && s.ref?.kind === 'recommendation')).toBe(true);
    // ACCEPTING ADVICE GRANTS NOTHING: no allowance, boundary, consent,
    // acquisition, act, delegation or outbound row exists that did not before.
    expect(await authority()).toEqual(authorityBefore);

    // Two threads open at once. An act proposed inside one steps that one only;
    // an act proposed outside any thread steps neither.
    await confirm('Fix it.', 'undertaking');
    const threads = await u.openUndertakings(tidewater);
    expect(threads).toHaveLength(2);
    const fromAdvice = threads.find((t) => t.openedFrom.kind === 'recommendation');
    const fix = threads.find((t) => t.kind === 'fix');
    await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
      VALUES ('wb_asked', ?, 'change_software', 'ask me before changing software', 'ask_first')`, [tidewater]);
    const { proposeAct } = await import('../../src/services/institution/standing-intent.js');
    const inside = await proposeAct({ productId: tidewater, subject: 'change_software', actionType: 'workshop_change',
      params: { a: 1 }, summary: 'wire the checkout', why: 'so people can pay', expectedEffect: 'a working checkout',
      risk: 'an hour of downtime', consequence: 'low', proposedBy: 'hand:test', undertakingId: String(fix?.id) });
    const outside = await proposeAct({ productId: tidewater, subject: 'change_software', actionType: 'workshop_change',
      params: { b: 2 }, summary: 'rename a button', why: 'clarity', expectedEffect: 'a clearer button',
      risk: 'none', consequence: 'low', proposedBy: 'hand:test' });
    await post(`/foundry/proposals/${outside}/approve`, {});
    await post(`/foundry/proposals/${inside}/approve`, {});
    thread = await u.threadOf(String(fix?.id));
    const approved = thread.steps.filter((s) => s.kind === 'approved');
    expect(approved).toHaveLength(1);
    expect(approved[0]?.ref).toEqual({ kind: 'proposed_act', id: inside });
    expect(approved[0]?.said).toBe('You approved: wire the checkout.');
    const other = await u.threadOf(String(fromAdvice?.id));
    expect(other.steps.some((s) => s.kind === 'approved' || s.kind === 'refused')).toBe(false);
    // A replayed decision is one step, not two.
    expect(await u.stepOn(String(fix?.id), { kind: 'approved', said: 'again', ref: { kind: 'proposed_act', id: inside }, actor: `founder:${OWNER}` })).toBeNull();
    await expect(query(`INSERT INTO undertaking_steps (id, undertaking_id, founder_id, kind, said, ref_kind, ref_id, actor)
      VALUES ('us_dup', ?, ?, 'approved', 'again', 'proposed_act', ?, ?)`, [String(fix?.id), OWNER, inside, `founder:${OWNER}`]))
      .rejects.toThrow(/UNIQUE|unique/);
    const work = await get(`/foundry/companies/${tidewater}/work`);
    expect(work.html).toContain('Opened by me, from advice you agreed to.');
    expect(work.html).toContain(`href="/foundry/why/proposal/${inside}"`);
    expect(work.html).not.toContain(`href="/foundry/why/proposal/${outside}"`);
  });

  it('an act cannot be attached to another company\'s thread, or to a closed one', async () => {
    const u = await import('../../src/services/institution/undertaking.js');
    const mine = (await u.openUndertakings(tidewater))[0];
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('p_asked_second', 'Second', ?)`, [OWNER]);
    const { proposeAct } = await import('../../src/services/institution/standing-intent.js');
    await expect(proposeAct({ productId: 'p_asked_second', subject: 'change_software', actionType: null, params: {},
      summary: 'x', why: 'y', expectedEffect: 'z', risk: 'r', consequence: 'low', proposedBy: 'hand:test',
      undertakingId: String(mine?.id) })).rejects.toThrow(/same_company_and_open/);
    await u.closeUndertaking({ founderId: OWNER, id: String(mine?.id), as: 'done', because: 'finished', by: `founder:${OWNER}` });
    await expect(proposeAct({ productId: tidewater, subject: 'change_software', actionType: null, params: { c: 3 },
      summary: 'x', why: 'y', expectedEffect: 'z', risk: 'r', consequence: 'low', proposedBy: 'hand:test',
      undertakingId: String(mine?.id) })).rejects.toThrow(/same_company_and_open/);
    // And the act's thread, once set, never moves.
    const stuck = (await query(`SELECT id FROM proposed_acts WHERE undertaking_id IS NOT NULL LIMIT 1`)).rows[0] as Record<string, unknown>;
    await expect(query(`UPDATE proposed_acts SET undertaking_id = NULL WHERE id = ?`, [String(stuck.id)])).rejects.toThrow(/undertaking_is_fixed/);
  });
});

describe('the doors agree', () => {
  it('a mandate said at the single door is shown back before it binds, as it is on the venture screen', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM venture_mandates');
    const res = await post('/foundry/ask', { said: 'Find me another small income stream.' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Go and look?');
    expect(html).toContain('action="/foundry/venture/confirm"');
    expect(await count('SELECT COUNT(*) AS n FROM venture_mandates')).toBe(before);
    const confirmed = await post('/foundry/venture/confirm', { said: 'Find me another small income stream.' });
    expect(confirmed.status).toBe(302);
    expect(await count('SELECT COUNT(*) AS n FROM venture_mandates')).toBe(before + 1);
  });

  it('a verb said at the single door needs a company, and says so without writing anything', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM undertakings');
    const html = await (await post('/foundry/ask', { said: 'Adopt AcreOS.' })).text();
    expect(html).toContain('I did not follow that');
    expect(html).toContain('you want me to learn what acreos is');
    expect(html).toContain('which company you mean');
    expect(await count('SELECT COUNT(*) AS n FROM undertakings')).toBe(before);
    const { whichDoor } = await import('../../src/services/institution/the-door.js');
    expect(whichDoor('Investigate it.').destination).toBe('undertaking');
    expect(whichDoor('Handle it.').destination).toBe('undertaking');
    expect(whichDoor('Kill this.').destination).toBe('posture');
    expect(whichDoor('Create something.').destination).toBe('unplaceable');
  });
});

describe('boundaries of the thread', () => {
  it('an invented company\'s undertaking is invented, and a mismatch is refused by the schema', async () => {
    const u = await import('../../src/services/institution/undertaking.js');
    const opened = await u.openUndertaking({ founderId: OWNER, productId: invented, kind: 'understand',
      asked: 'Adopt it', understoodAs: 'learn what this is', openedBy: `founder:${OWNER}`, from: { kind: 'owner', id: null } });
    expect(opened?.evidenceMode).toBe('reference');
    await expect(query(
      `INSERT INTO undertakings (id, founder_id, product_id, kind, understood_as, opened_by, opened_from_kind, evidence_mode)
       VALUES ('u_wrong', ?, ?, 'fix', 'x', 'test', 'owner', 'real')`, [OWNER, invented]))
      .rejects.toThrow(/evidence_mode_must_match_reality/);
    // And it is not in the answer to what the institution is doing for him.
    const { html } = await get(`/foundry?q=${encodeURIComponent('what are you working on?')}`);
    expect(html).not.toContain('learn what this is');
  });

  it('identity is immutable, a successor must be the same company, and the owner must own the company', async () => {
    const id = String((await query('SELECT id FROM undertakings WHERE product_id = ? LIMIT 1', [tidewater])).rows[0]?.id);
    await expect(query(`UPDATE undertakings SET asked = 'something else' WHERE id = ?`, [id])).rejects.toThrow(/identity_is_immutable/);
    await expect(query(`UPDATE undertakings SET understood_as = 'something else' WHERE id = ?`, [id])).rejects.toThrow(/identity_is_immutable/);
    await expect(query(
      `INSERT INTO undertakings (id, founder_id, product_id, kind, understood_as, opened_by, opened_from_kind, evidence_mode)
       VALUES ('u_not_owner', ?, ?, 'fix', 'x', 'test', 'owner', 'real')`, [STRANGER, tidewater])).rejects.toThrow(/founder_must_own_company/);
    const u = await import('../../src/services/institution/undertaking.js');
    const first = await u.openUndertaking({ founderId: OWNER, productId: tidewater, kind: 'grow', asked: null,
      understoodAs: 'first attempt', openedBy: 'institution:test', from: { kind: 'owner', id: null } });
    const second = await u.openUndertaking({ founderId: OWNER, productId: tidewater, kind: 'grow', asked: null,
      understoodAs: 'second attempt', openedBy: 'institution:test', from: { kind: 'owner', id: null } });
    await expect(query(`UPDATE undertakings SET closed_at = CURRENT_TIMESTAMP, closed_as = 'superseded', closed_by = 'test', superseded_by = ? WHERE id = ?`,
      [String(first?.id), String(first?.id)])).rejects.toThrow(/successor_must_be_same_company/);
    expect(await u.closeUndertaking({ founderId: OWNER, id: String(first?.id), as: 'superseded', because: 'a better framing',
      by: `founder:${OWNER}`, supersededBy: String(second?.id) })).toBe(true);
    const closed = await u.undertakingById(OWNER, String(first?.id));
    expect(closed?.closedAs).toBe('superseded');
    expect(closed?.supersededBy).toBe(second?.id);
    const why = await get(`/foundry/why/undertaking/${String(first?.id)}`);
    expect(why.html).toContain(`Superseded by undertaking ${String(second?.id)}`);
    await u.closeUndertaking({ founderId: OWNER, id: String(second?.id), as: 'done', because: 'done', by: `founder:${OWNER}` });
  });

  it('a step cannot be written under another name, and steps are append-only', async () => {
    const u = await import('../../src/services/institution/undertaking.js');
    const opened = await u.openUndertaking({ founderId: OWNER, productId: tidewater, kind: 'handle', asked: null,
      understoodAs: 'a thread for the actor test', openedBy: 'institution:test', from: { kind: 'owner', id: null } });
    const id = String(opened?.id);
    await expect(query(`INSERT INTO undertaking_steps (id, undertaking_id, founder_id, kind, said, actor) VALUES ('us_forged', ?, ?, 'looked', 'forged', ?)`, [id, OWNER, `founder:${STRANGER}`]))
      .rejects.toThrow(/actor_must_be_owner_or_institution/);
    await expect(query(`INSERT INTO undertaking_steps (id, undertaking_id, founder_id, kind, said, actor) VALUES ('us_forged2', ?, ?, 'looked', 'forged', 'hand:test')`, [id, OWNER]))
      .rejects.toThrow(/actor_must_be_owner_or_institution/);
    const step = (await query(`SELECT id FROM undertaking_steps WHERE undertaking_id = ? LIMIT 1`, [id])).rows[0] as Record<string, unknown>;
    await expect(query(`UPDATE undertaking_steps SET said = 'rewritten' WHERE id = ?`, [String(step.id)])).rejects.toThrow(/append_only/);
    await u.closeUndertaking({ founderId: OWNER, id, as: 'nothing_to_do', because: 'test over', by: `founder:${OWNER}` });
  });

  it('a step cannot be written under another founder\'s name on the row', async () => {
    const id = String((await query('SELECT id FROM undertakings WHERE product_id = ? AND closed_at IS NULL LIMIT 1', [tidewater])).rows[0]?.id);
    await expect(query(`INSERT INTO undertaking_steps (id, undertaking_id, founder_id, kind, said, actor) VALUES ('us_other', ?, ?, 'looked', 'not mine', ?)`, [id, STRANGER, `founder:${STRANGER}`]))
      .rejects.toThrow(/founder_must_match_undertaking/);
  });

  it('erasing the owner takes his undertakings and their steps with him', async () => {
    const other = 'asked_erased';
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [other, 'clerk_asked_3', 'gone@example.com', 'Gone']);
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('p_asked_gone', 'Gone Co', ?)`, [other]);
    const u = await import('../../src/services/institution/undertaking.js');
    const opened = await u.openUndertaking({ founderId: other, productId: 'p_asked_gone', kind: 'fix', asked: 'Fix it.',
      understoodAs: 'find what is broken', openedBy: `founder:${other}`, from: { kind: 'owner', id: null } });
    expect(opened).not.toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM undertaking_steps WHERE founder_id = ?', [other])).toBeGreaterThan(0);
    const { eraseFounderAccount } = await import('../../src/services/privacy/consent.js');
    await eraseFounderAccount(other);
    expect(await count('SELECT COUNT(*) AS n FROM undertakings WHERE founder_id = ?', [other])).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM undertaking_steps WHERE founder_id = ?', [other])).toBe(0);
  });

  it('a stranger\'s undertaking answers as one that does not exist', async () => {
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('p_asked_theirs', 'Theirs', ?)`, [STRANGER]);
    await query(
      `INSERT INTO undertakings (id, founder_id, product_id, kind, understood_as, opened_by, opened_from_kind, evidence_mode)
       VALUES ('u_theirs', ?, 'p_asked_theirs', 'fix', 'fix theirs', 'test', 'owner', 'real')`, [STRANGER]);
    expect((await get('/foundry/why/undertaking/u_theirs')).status).toBe(404);
    expect((await post('/foundry/undertakings/u_theirs/stop', {})).status).toBe(404);
    const u = await import('../../src/services/institution/undertaking.js');
    expect(await u.openUndertaking({ founderId: OWNER, productId: 'p_asked_theirs', kind: 'fix', asked: null,
      understoodAs: 'x', openedBy: 'test', from: { kind: 'owner', id: null } })).toBeNull();
  });
});
