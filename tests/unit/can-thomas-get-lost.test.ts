// =============================================================================
// CAN THOMAS GET LOST?
//
// The owner arrives at every state a real day produces — a deep link into a
// company, into a test, into a decision; a refresh at depth; the app resumed;
// back; a question typed inside an object; the object left for the portfolio;
// one asset swapped for another; the object changing under him — and at every
// one of them the screen must answer, without him asking:
//
//   Where am I?  What object is this?  How do I go up?  What is Foundry doing
//   here?  What needs me?  What context will Ask use?  Where does "why" go?
//
// This suite asks those questions of the HTML, state by state. It is not a
// test of any particular company: the seeded companies are ordinary rows, and
// nothing here would read differently for a different economic form.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'lost_owner';
const STRANGER = 'lost_stranger';
let app: Hono;
let tidewater = '';
let invented = '';
let asset = '';
let actId = '';
let adviceId = '';
/** How many things wait on him at Tidewater: the act, and whatever advice the situation raised. */
let waiting = 0;
let experimentId = '';
let opportunityId = '';

const post = (path: string, fields: Record<string, string>) => app.request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});
const get = async (path: string): Promise<{ status: number; html: string; location: string | null }> => {
  const res = await app.request(path);
  return { status: res.status, html: await res.text(), location: res.headers.get('location') };
};

/** The seven questions, asked of one screen. Each answer is a fact found in the HTML or null. */
function orient(html: string) {
  const crumbs = [...html.matchAll(/<p class="crumbs"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1] ?? '')[0] ?? '';
  const crumbLinks = [...crumbs.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');
  const chips = [...html.matchAll(/<span class="chip">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');
  const local = [...(html.match(/<nav class="local[^"]*"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/<a href="([^"]+)"[^>]*>([^<]*)/g)]
    .map((m) => ({ href: m[1] ?? '', label: (m[2] ?? '').trim() }));
  const localOn = /<nav class="local[^"]*"[\s\S]*?<\/nav>/.exec(html)?.[0].match(/aria-current="page"[^>]*>([^<]*)/)?.[1]?.trim() ?? null;
  const placeholder = /placeholder="(Ask[^"]*)"/.exec(html)?.[1] ?? null;
  const scope = /name="scope" value="([^"]+)"/.exec(html)?.[1] ?? null;
  const askwhere = /<p class="askwhere">([\s\S]*?)<\/p>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '') ?? null;
  const why = [...html.matchAll(/href="(\/foundry\/why\/[^"]+)"/g)].map((m) => m[1] ?? '');
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
  return { crumbs, crumbLinks, chips, local, localOn, placeholder, scope, askwhere, why, h1 };
}

/** Everything he could press on a screen, so no new page can lead nowhere. */
function links(html: string): string[] {
  return [...new Set([...html.matchAll(/<a[^>]*href="(\/[^"#]*)"/g)].map((m) => m[1] ?? ''))];
}

beforeAll(async () => {
  await runMigrations();
  for (const [id, clerk] of [[OWNER, 'clerk_lost'], [STRANGER, 'clerk_lost_2']]) {
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

  // A real company he named, with numbers that fell, so it has a situation and
  // advice about it; a sense so it has customers; a responsibility so Foundry
  // is doing something; and an act it cannot take without him.
  await post('/foundry/companies', { name: 'Tidewater' });
  tidewater = String((await query(`SELECT id FROM products WHERE owner_id = ? AND name = 'Tidewater'`, [OWNER]))
    .rows[0]?.id);
  for (const [days, cents] of [[40, 300000], [30, 290000], [20, 270000], [10, 250000], [0, 220000]]) {
    await query(`INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents) VALUES (?,?,date('now', ?),?)`,
      [`ms_lost_${String(days)}`, tidewater, `-${String(days)} day`, cents]);
  }
  await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
    VALUES ('cs_lost_rev', ?, 'revenue', 'stripe', 'real', 'revenue numbers, read only'),
           ('cs_lost_cust', ?, 'customers', 'stripe', 'real', 'who pays, read only')`, [tidewater, tidewater]);
  await query(`INSERT INTO institutional_responsibilities (id, product_id, title, capability, state)
    VALUES ('ir_lost', ?, 'answer support', 'support', 'shadowing')`, [tidewater]);
  const { recordSituation, recommendFor } = await import('../../src/services/founder/situation-chain.js');
  await recordSituation(tidewater);
  const advice = await recommendFor(tidewater);
  adviceId = advice[0]?.id ?? '';
  waiting = 1 + advice.length;
  await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
    VALUES ('wb_lost', ?, 'change_software', 'ask me before changing software', 'ask_first')`, [tidewater]);
  actId = 'act_lost';
  await query(
    `INSERT INTO proposed_acts
       (id, product_id, subject, action_type, params_fingerprint, summary, why, expected_effect,
        risk, consequence, proposed_by, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','+1 day'))`,
    [actId, tidewater, 'change_software', 'workshop_change', 'fp_lost', 'wire the checkout',
      'so people can pay', 'a working checkout', 'a broken checkout for an hour', 'low', 'hand:test']);

  // A company he did not name: invented, so it can be told apart on sight.
  await post('/foundry/reference', { scenario: 'revenue_quietly_falling' });
  invented = String((await query(`SELECT id FROM products WHERE owner_id = ? AND reality = 'reference' ORDER BY rowid LIMIT 1`,
    [OWNER])).rows[0]?.id);

  // A search with one candidate and an approved test, which makes a test asset.
  await query(`INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode) VALUES (?,?,?,?)`,
    ['m_lost', OWNER, 'Find another small income stream', 'real']);
  opportunityId = 'o_lost';
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, 'm_lost', OWNER, 'a day-rate page', 'freelancers', 'they undercharge', 'people ask each other',
      'misread if nobody pays', '["https://forum.example/1"]', 'real']);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking) VALUES (?,?,?,?,1)`,
    ['u_lost', OWNER, opportunityId, 'whether anybody pays']);
  const { designExperiment, decideExperiment } = await import('../../src/services/venture/validation.js');
  experimentId = await designExperiment({ founderId: OWNER, opportunityId, unknownId: 'u_lost',
    whatWeDo: 'put up a page with a price', whatWeExpect: 'three people pay in a week',
    wouldDisprove: 'nobody pays', costCents: 500, evidenceMode: 'real' });
  await decideExperiment({ experimentId, decision: 'approved', by: `founder:${OWNER}` });
  asset = String((await query('SELECT id FROM products WHERE from_experiment_id = ?', [experimentId])).rows[0]?.id ?? '');
});

describe('deep-linked into a company page', () => {
  it('says where he is, what it is, how to go up, what Foundry is doing, what needs him, what Ask will use, and where why goes', async () => {
    const { status, html } = await get(`/foundry/companies/${tidewater}`);
    expect(status).toBe(200);
    const o = orient(html);
    expect(o.h1).toBe('Tidewater');
    expect(o.crumbLinks).toEqual(['/foundry', '/foundry/companies']);
    expect(o.crumbs).toContain('Tidewater');
    // What object: identity in chips, doing-line last.
    expect(o.chips.some((ch) => ch === `${String(waiting)} ${waiting === 1 ? 'thing needs' : 'things need'} you`)).toBe(true);
    // Stable geography: Overview first, Work second, and only what exists.
    expect(o.local.map((l) => l.label)).toEqual(['Overview', 'Work', 'Economics', 'Customers']);
    expect(o.localOn).toBe('Overview');
    expect(o.local.find((l) => l.label === 'Work')?.href).toBe(`/foundry/companies/${tidewater}/work`);
    // Ask is grounded here, and says so.
    expect(o.placeholder).toBe('Ask about Tidewater…');
    expect(o.scope).toBe(`company:${tidewater}`);
    expect(o.askwhere).toMatch(/Asking about Tidewater/);
    expect(o.askwhere).toMatch(/everything instead/);
    // Why goes somewhere: the situation, the advice and the act each descend.
    expect(o.why).toContain(`/foundry/why/company/${tidewater}`);
    if (adviceId) expect(o.why).toContain(`/foundry/why/advice/${adviceId}`);
    expect(o.why).toContain(`/foundry/why/proposal/${actId}`);
  });

  it('is a page and not a dead end for every address it offers', async () => {
    const { html } = await get(`/foundry/companies/${tidewater}`);
    const dead: string[] = [];
    for (const href of links(html)) {
      const res = await app.request(href);
      if (res.status === 404 || res.status >= 500) dead.push(`${href} (${String(res.status)})`);
    }
    expect(dead).toEqual([]);
  });
});

describe('deep-linked into an experiment', () => {
  it('a test is a claim with its work behind it, and the way up is the candidate', async () => {
    const { status, html } = await get(`/foundry/why/experiment/${experimentId}`);
    expect(status).toBe(200);
    expect(html).toContain('three people pay in a week');
    expect(html).toContain('What would disprove it: nobody pays');
    expect(html).toContain(`href="/foundry/why/candidate/${opportunityId}"`);
    const o = orient(html);
    expect(o.crumbLinks).toContain('/foundry/searching');
    // THE LEVELS ARE NAMED FOR WHAT THIS CAN ACTUALLY PROVE.
    //
    // Two of them used to be "Assumptions" and "Alternatives", which claim the
    // institution enumerated its premises and weighed other courses at the
    // moment it judged, and that the page is a record of that. It is not: the
    // page assembles both today from other rows, and one alternative was a
    // generic "not doing it" appended to every act. A page whose whole purpose
    // is showing its work may not manufacture a thought process after the fact.
    for (const level of ['Why', 'Evidence', 'What this rests on', 'Other recorded paths',
      'Uncertainty', 'Activity', 'Outcome', 'Cost', 'Authority', 'Technical']) {
      expect(html).toContain(`<h3>${level}</h3>`);
    }
  });

  it('the test asset it made is a place of its own, marked as a test, with Experiments in the same slot', async () => {
    expect(asset).not.toBe('');
    const { status, html } = await get(`/foundry/companies/${asset}`);
    expect(status).toBe(200);
    const o = orient(html);
    expect(o.chips[0]).toBe('a test, not a company');
    expect(o.local.map((l) => l.label)).toEqual(['Overview', 'Work', 'Economics', 'Experiments']);
    const exp = await get(`/foundry/companies/${asset}/experiments`);
    expect(exp.status).toBe(200);
    expect(exp.html).toContain('put up a page with a price');
    expect(exp.html).toContain(`/foundry/why/experiment/${experimentId}`);
    expect(orient(exp.html).localOn).toBe('Experiments');
  });
});

describe('deep-linked into a decision', () => {
  it('the act says why it is asked, on what authority, and what happens if he does nothing', async () => {
    const { status, html } = await get(`/foundry/why/proposal/${actId}`);
    expect(status).toBe(200);
    expect(html).toContain('wire the checkout');
    expect(html).toContain('ask me before changing software');
    expect(html).toContain('nothing happens');
    expect(orient(html).crumbLinks).toEqual(['/foundry', '/foundry/companies', `/foundry/companies/${tidewater}`]);
    expect(orient(html).scope).toBe(`company:${tidewater}`);
  });

  it('Decisions is an address, reached from context, that carries what waits and what was decided', async () => {
    const { status, html } = await get('/foundry/decisions');
    expect(status).toBe(200);
    expect(html).toContain('wire the checkout');
    expect(html).toContain(`href="/foundry/companies/${tidewater}#decide"`);
    const scoped = await get(`/foundry/decisions?company=${tidewater}`);
    expect(scoped.html).toContain('Decisions about Tidewater');
    expect(orient(scoped.html).crumbLinks).toContain(`/foundry/companies/${tidewater}`);
  });
});

describe('refresh at depth', () => {
  it('every dimension keeps the same head, the same order, and marks itself as the place underfoot', async () => {
    const overview = orient((await get(`/foundry/companies/${tidewater}`)).html);
    for (const dim of overview.local) {
      const { status, html } = await get(dim.href);
      expect(status, dim.href).toBe(200);
      const o = orient(html);
      expect(o.local.map((l) => l.label), dim.href).toEqual(overview.local.map((l) => l.label));
      expect(o.localOn, dim.href).toBe(dim.label);
      expect(o.chips, dim.href).toEqual(overview.chips);
      expect(o.scope, dim.href).toBe(`company:${tidewater}`);
      expect(o.crumbLinks.slice(0, 2), dim.href).toEqual(['/foundry', '/foundry/companies']);
    }
  });

  it('a dimension this company does not have is not a page: it goes back up rather than drawing an empty one', async () => {
    const { status, location } = await get(`/foundry/companies/${tidewater}/evidence`);
    expect(status).toBe(302);
    expect(location).toBe(`/foundry/companies/${tidewater}`);
  });
});

describe('the app resumed', () => {
  it('the first screen says where things are, with a count only where one is honest', async () => {
    const { status, html } = await get('/foundry');
    expect(status).toBe(200);
    const o = orient(html);
    expect(o.local.map((l) => l.label)).toEqual(['Portfolio', 'Decisions', 'Searching']);
    expect(html).toMatch(new RegExp(`href="/foundry/decisions"[^>]*>Decisions <b>${String(waiting)}</b>`));
    expect(o.placeholder).toBe('Ask Foundry anything…');
    expect(o.scope).toBeNull();
    expect(o.crumbs).toBe('');
  });
});

describe('browser back, by the trail', () => {
  it('every crumb on a deep page is a page, and the trail is the same shape on all of them', async () => {
    const { html } = await get(`/foundry/companies/${tidewater}/work`);
    const o = orient(html);
    expect(o.crumbLinks).toEqual(['/foundry', '/foundry/companies', `/foundry/companies/${tidewater}`]);
    for (const href of o.crumbLinks) expect((await get(href)).status, href).toBe(200);
    expect(html).toContain(`href="/foundry/companies/${tidewater}">← Tidewater</a>`);
  });
});

describe('chat to object', () => {
  it('a question typed inside a company is answered on that company, with the scope visible and a way to widen it', async () => {
    const asked = await get(`/foundry?q=${encodeURIComponent('how is it doing?')}&scope=company:${tidewater}`);
    expect(asked.status).toBe(302);
    expect(asked.location).toBe(`/foundry/companies/${tidewater}?q=${encodeURIComponent('how is it doing?')}#answer`);
    const { html } = await get(`/foundry/companies/${tidewater}?q=${encodeURIComponent('how is it doing?')}`);
    expect(html).toContain('You asked about Tidewater');
    expect(html).toContain('Ask about everything instead');
    expect(html).toContain(`href="/foundry?q=${encodeURIComponent('how is it doing?')}"`);
  });

  it('a question about the whole institution stays on the first screen even when typed inside a company', async () => {
    const asked = await get(`/foundry?q=${encodeURIComponent('where should the next dollar go?')}&scope=company:${tidewater}`);
    expect(asked.status).toBe(200);
  });

  it('a name he typed beats the scope he typed it in', async () => {
    const asked = await get(`/foundry?q=${encodeURIComponent('how is Tidewater doing?')}&scope=company:${invented}`);
    expect(asked.status).toBe(200);
    expect(asked.html).toContain('Tidewater');
  });

  it('"why" typed inside a company goes to the work behind what it says', async () => {
    const asked = await get(`/foundry/companies/${tidewater}?q=${encodeURIComponent('why do you say that?')}`);
    expect(asked.status).toBe(302);
    expect(asked.location).toBe(`/foundry/why/company/${tidewater}`);
  });

  it('an instruction typed as a question changes nothing until he crosses into saying so', async () => {
    const before = Number((await query('SELECT COUNT(*) AS n FROM owner_boundaries')).rows[0]?.n);
    const { html } = await get(`/foundry/companies/${tidewater}?q=${encodeURIComponent('stop emailing customers')}`);
    expect(html).toContain('That sounds like an instruction');
    expect(html).toContain('Nothing has changed');
    expect(html).toContain(`action="/foundry/companies/${tidewater}/said"`);
    expect(html).toContain('value="stop emailing customers"');
    const after = Number((await query('SELECT COUNT(*) AS n FROM owner_boundaries')).rows[0]?.n);
    expect(after).toBe(before);
  });

  it('a stranger\'s company answers the same as one that does not exist', async () => {
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('p_lost_theirs', 'Theirs', ?)`, [STRANGER]);
    for (const path of ['/foundry/companies/p_lost_theirs/work', '/foundry/why/company/p_lost_theirs',
      '/foundry/why/nonsense/x', '/foundry/companies/p_lost_nowhere/economics']) {
      expect((await get(path)).status, path).toBe(404);
    }
  });
});

describe('object to portfolio', () => {
  it('the Portfolio is a map first: what he owns, findable by name and by what it needs', async () => {
    const { status, html } = await get('/foundry/companies');
    expect(status).toBe(200);
    const o = orient(html);
    expect(o.h1).toBe('Portfolio');
    expect(o.local.map((l) => l.label)).toEqual(['Map', 'River']);
    expect(o.localOn).toBe('Map');
    expect(o.placeholder).toBe('Ask about your portfolio…');
    expect(html).toContain('name="find"');
    expect(html).toContain(`href="/foundry/companies/${tidewater}"`);
    // Invented companies are told apart and kept in their own section, not counted as his.
    expect(html).toContain('Companies I made up');
    const map = html.slice(html.indexOf('class="filters"'), html.indexOf('Companies I made up'));
    expect(map).toContain(`href="/foundry/companies/${tidewater}"`);
    expect(map).not.toContain(`href="/foundry/companies/${invented}"`);
    const found = await get('/foundry/companies?find=tide');
    expect(found.html).toContain(`href="/foundry/companies/${tidewater}"`);
    const nothing = await get('/foundry/companies?find=zzzz');
    expect(nothing.html).toContain('Nothing you own is called anything like');
    const needs = await get('/foundry/companies?show=needs');
    expect(needs.html).toContain(`href="/foundry/companies/${tidewater}"`);
    expect(needs.html).toMatch(/things? needs? you/);
  });

  it('the River is the same place with its other question answered, and the trail does not move', async () => {
    const { html } = await get('/foundry/companies?view=river');
    const o = orient(html);
    expect(o.localOn).toBe('River');
    expect(o.crumbLinks).toEqual(['/foundry']);
    expect(html).toContain('What you own');
  });
});

describe('switching assets', () => {
  it('an invented company says so in its first chip, and Ask follows him to it by name', async () => {
    const { html } = await get(`/foundry/companies/${invented}`);
    const o = orient(html);
    expect(o.chips[0]).toBe('invented');
    expect(o.placeholder).toMatch(/^Ask about .+…$/);
    expect(o.placeholder).not.toBe('Ask about Tidewater…');
    expect(o.scope).toBe(`company:${invented}`);
  });
});

describe('the object changes while he is looking at it', () => {
  it('deciding the act moves it out of "needs you" everywhere it was counted, and into what was decided', async () => {
    for (const id of (await query(`SELECT id FROM situation_recommendations WHERE product_id = ? AND decided_at IS NULL`, [tidewater])).rows) {
      await post(`/foundry/advice/${String((id as Record<string, unknown>).id)}/decline`, {});
    }
    const res = await post(`/foundry/proposals/${actId}/approve`, {});
    expect([200, 302]).toContain(res.status);
    const o = orient((await get(`/foundry/companies/${tidewater}`)).html);
    expect(o.chips.some((ch) => /needs you/.test(ch))).toBe(false);
    expect(o.chips.some((ch) => /looking after 1 thing/.test(ch))).toBe(true);
    const home = (await get('/foundry')).html;
    expect(home).not.toMatch(/Decisions <b>\d+<\/b>/);
    const decisions = (await get('/foundry/decisions')).html;
    expect(decisions).toContain('wire the checkout');
    expect(decisions).toMatch(/approved/);
    const work = (await get(`/foundry/companies/${tidewater}/work`)).html;
    expect(work).toContain('approved, not yet used');
  });
});

describe('the work behind a claim', () => {
  it('descends from the answer through why, evidence and the rest to the rows, and none of it is a model thinking', async () => {
    const { status, html } = await get(`/foundry/why/company/${tidewater}`);
    expect(status).toBe(200);
    expect(orient(html).h1).toBe('Why I say this about Tidewater');
    expect(html).toContain('<h3>Why</h3>');
    expect(html).toContain('<h3>Technical</h3>');
    expect(html).toContain('company_situations');
    expect(html).toContain('ask me before changing software');
    expect(html).toContain('from stripe');
    expect(html).toContain(`href="/foundry/companies/${tidewater}">← Tidewater</a>`);
  });

  it('every new page leads only to pages', async () => {
    const pages = [`/foundry/companies/${tidewater}/work`, `/foundry/companies/${tidewater}/economics`,
      `/foundry/companies/${tidewater}/customers`, `/foundry/companies/${asset}/experiments`,
      `/foundry/why/company/${tidewater}`, `/foundry/why/advice/${adviceId}`, `/foundry/why/proposal/${actId}`,
      `/foundry/why/candidate/${opportunityId}`, `/foundry/why/experiment/${experimentId}`,
      '/foundry/decisions', `/foundry/decisions?company=${tidewater}`, '/foundry/searching',
      '/foundry/companies', '/foundry/companies?view=river'];
    const dead: string[] = [];
    for (const path of pages) {
      const res = await app.request(path);
      if (res.status !== 200) { dead.push(`${path} (${String(res.status)})`); continue; }
      const html = await res.text();
      for (const bad of ['undefined', 'NaN', '[object Object]', 'Invalid Date']) {
        if (html.includes(bad)) dead.push(`${path} shows ${bad}`);
      }
      for (const href of links(html)) {
        const r = await app.request(href);
        if (r.status === 404 || r.status >= 500) dead.push(`${path} → ${href} (${String(r.status)})`);
      }
    }
    expect(dead).toEqual([]);
  });
});
