process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { shelfCandidates } from '../../src/services/venture/shelves.js';

// =============================================================================
// THE SHELVES ARE A WAY OF LOOKING AT WHAT WAS FOUND, NEVER A MENU TO FILL.
//
// An owner who can see economic forms on a screen will reasonably read them as
// things he can order, and a system that obliged would manufacture API ideas
// because somebody opened the API shelf. That is the exact failure the whole
// evidence apparatus exists to prevent, and it would arrive wearing real URLs.
//
// So a shelf sorts; it never creates. A candidate reaches one only through a
// sentence somebody actually wrote — its own headline, the problem it names,
// why it might work, or the words that started the seed — and the card says
// which sentence and which word put it there. An empty shelf says it is empty
// and offers to point the SEARCH that way, which goes through the mandate like
// every other instruction from him.
// =============================================================================

const OWNER = 'sh_owner';
let app: Hono;
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text() }; };

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_sh', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES ('sh_f','Foundry',?,'active',50)`, [OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry','sh_f','test')`, []);
  const { experimentRoutes } = await import('../../src/routes/dashboard/experiments-place.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', experimentRoutes);
});

describe('with nothing found', () => {
  it('every shelf is empty, and says so rather than filling itself', async () => {
    const shelves = await shelfCandidates(OWNER);
    expect(shelves.length).toBeGreaterThan(5);
    expect(shelves.every((s) => s.candidates.length === 0)).toBe(true);

    const t = (await page('/foundry/experiments/explore')).text;
    expect(t).toContain('Nothing has survived enough evidence to stand as a candidate yet');
    expect(t).toContain('Nothing found so far looks like this.');
    // And the only thing an empty shelf offers is to point the search there.
    expect(t).toContain('Look for something like this');
    expect(t).toContain('value="Explore something other software calls"');
  });

  it('the page is alive without inventing anything to be busy about', async () => {
    const t = (await page('/foundry/experiments/explore')).text;
    expect(t).toContain('Nothing is being looked into. Point me somewhere and I will start.');
  });
});

describe('with something found and believed', () => {
  beforeAll(async () => {
    const { openMandate } = await import('../../src/services/venture/mandate.js');
    const m = await openMandate({ founderId: OWNER, statement: 'Small things for shops', shape: null, evidenceMode: 'real' });
    if ('refused' in m) throw new Error(m.refused);
    await query(`INSERT INTO opportunity_seeds (id, founder_id, mandate_id, seed, origin, origin_said, evidence_mode)
      VALUES ('sh_seed',?,?,'bookkeepers rebuild an invoice by hand','reasoned','I wrote a script to call their endpoint every morning','real')`, [OWNER, m.id]);
    await query(
      `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
       VALUES ('sh_opp',?,?,'a morning figure worth paying for','bookkeepers','they rebuild it by hand every week','somebody pays for the saved hour','nobody pays','[]','real')`, [m.id, OWNER]);
    await query(`UPDATE opportunity_seeds SET promoted_to = 'sh_opp' WHERE id = 'sh_seed'`, []);
    await query(`INSERT INTO market_claims (id, founder_id, seed_id, claim, evidence_mode)
      VALUES ('sh_c1',?,'sh_seed','people rebuild this by hand','real')`, [OWNER]);
    const stances = (await query(`SELECT source_type FROM market_source_types WHERE epistemic_stance <> 'rehearsal' GROUP BY epistemic_stance ORDER BY source_type LIMIT 2`, []))
      .rows as unknown as Array<Record<string, unknown>>;
    let n = 0;
    for (const st of stances) {
      n += 1;
      await query(`INSERT INTO market_observations
          (id, founder_id, claim_id, source_type, source, saw, bearing, directness, observed_at, evidence_mode)
        VALUES (?,?,'sh_c1',?,?,'somebody wrote about doing this by hand','supports','direct',datetime('now'),'real')`,
      [`sh_o${String(n)}`, OWNER, String(st.source_type), `https://example.com/${String(n)}`]);
    }
    await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
      VALUES ('sh_unk',?,'sh_opp','will anyone pay for it',1,'ask for the money')`, [OWNER]);
  });

  it('a candidate reaches a shelf only through a sentence somebody wrote, and the card says which', async () => {
    const shelves = await shelfCandidates(OWNER);
    const api = shelves.find((s) => s.key === 'api');
    expect(api?.candidates.map((k) => k.id)).toEqual(['sh_opp']);
    const k = api?.candidates[0];
    // The seed's own words put it there — not a category Foundry chose for it.
    expect(k?.because).toBe('endpoint');
    expect(k?.where).toBe('the sentence that started it');
  });

  it('evidence is said in words, and never as a score', async () => {
    const k = (await shelfCandidates(OWNER)).find((s) => s.key === 'api')?.candidates[0];
    expect(k?.evidence).toBe('2 independent ways of knowing');
    const t = (await page('/foundry/experiments/explore')).text;
    expect(t).toContain('2 independent ways of knowing');
    // NO SCORE, NO RATING, NO RANK. The one number on a candidate is how many
    // genuinely different ways of knowing said something, which is a count of
    // rows rather than a judgement dressed as one.
    expect(t).not.toMatch(/\b(score|rating|ranked|confidence:|\d+\s*\/\s*10|\d+%\s*confident)\b/i);
  });

  it('what still stands in the way is on the card, not in a footnote', async () => {
    const t = (await page('/foundry/experiments/explore')).text;
    expect(t).toContain('will anyone pay for it');
    expect(t).toContain('a morning figure worth paying for');
    expect(t).toContain('/foundry/why/candidate/sh_opp');
  });

  it('and the studio says what is alive from row counts alone', async () => {
    const t = (await page('/foundry/experiments/explore')).text;
    expect(t).toContain('1 candidate standing');
    expect(t).toContain('nothing yet deserves a test');
  });

});

describe('one tap can steer, and it writes what he would have typed', () => {
  it('a card offers four ways to point and not ten', async () => {
    const t = (await page('/foundry/experiments/explore')).text;
    const card = t.slice(t.indexOf('shelf-card'), t.indexOf('</article>'));
    expect(card).toContain('Steer the search');
    // Four, chosen for this candidate: a money question stands in its way, so
    // the fourth is the cheaper test rather than a standing preference.
    expect(card.match(/name="nudge"/g)?.length).toBe(4);
    expect(card).toContain('value="more_like"');
    expect(card).toContain('value="less_like"');
    expect(card).toContain('value="deeper"');
    expect(card).toContain('value="cheaper_test"');
    expect(card).not.toContain('value="low_support"');
    // And each says what it will do before he presses it.
    expect(card).toContain('I will keep working on this one rather than moving on.');
  });

  it('each nudge writes the guidance row the sentence-reader would have written', async () => {
    const { steer } = await import('../../src/services/venture/nudges.js');
    const said = await steer({ founderId: OWNER, opportunityId: 'sh_opp', nudge: 'more_like' });
    expect(said).toEqual({ said: 'More like this: something other software calls' });
    const rows = (await query(`SELECT kind, subject, statement, dimension FROM venture_guidance
      WHERE founder_id = ? ORDER BY rowid`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;
    const last = rows[rows.length - 1];
    expect(String(last?.kind)).toBe('favour');
    // The subject is the candidate's own form, from its own recorded words.
    expect(String(last?.subject)).toBe('something other software calls');

    const support = await steer({ founderId: OWNER, opportunityId: 'sh_opp', nudge: 'low_support' });
    expect('said' in support).toBe(true);
    const after = (await query(`SELECT kind, subject, dimension FROM venture_guidance
      WHERE founder_id = ? ORDER BY rowid`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;
    const prefer = after[after.length - 1];
    expect(String(prefer?.kind)).toBe('prefer');
    expect(String(prefer?.dimension)).toBe('support_burden');
  });

  it('and a nudge with no search running steers nothing rather than starting one', async () => {
    const { stopMandate } = await import('../../src/services/venture/mandate.js');
    const { steer } = await import('../../src/services/venture/nudges.js');
    await stopMandate(OWNER, 'test');
    // A closed search takes its candidates with it, so the nudge lands on a
    // buried candidate of a finished search: refused either way, and nothing
    // opens because a button was pressed under an old candidate.
    const out = await steer({ founderId: OWNER, opportunityId: 'sh_opp', nudge: 'more_like' });
    expect('refused' in out).toBe(true);
    const open = (await query(`SELECT id FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).rows;
    expect(open.length).toBe(0);
  });
});

describe('Now and Explore are two questions', () => {
  it('each page offers the other', async () => {
    const now = (await page('/foundry/experiments')).text;
    expect(now).toContain('/foundry/experiments/explore');
    const explore = (await page('/foundry/experiments/explore')).text;
    expect(explore).toContain('href="/foundry/experiments"');
  });

  it('and Explore takes a direction in his own words', async () => {
    const t = (await page('/foundry/experiments/explore')).text;
    expect(t).toContain('action="/foundry/ask"');
    expect(t).toContain('placeholder="Explore something new"');
    expect(t).toContain('You name the direction. Working out what would test it is mine.');
  });
});

describe('a card is a glance, not the argument', () => {
  it('evidence filed on the candidate rather than a seed still counts', async () => {
    // Found on the real page: the first real candidate was promoted before
    // seeds existed, so its claims hang off the opportunity. A count that saw
    // only seeds reported "nothing observed yet" about a thing that had
    // survived the whole evidence apparatus.
    await query(
      `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
       SELECT 'sh_old', mandate_id, founder_id, 'a register of notices', 'shops', 'scattered across a register',
              'somebody pays', 'nobody pays', '[]', 'real' FROM venture_opportunities WHERE id = 'sh_opp'`, []);
    await query(`INSERT INTO market_claims (id, founder_id, opportunity_id, claim, evidence_mode)
      VALUES ('sh_c2',?,'sh_old','notices are scattered','real')`, [OWNER]);
    const stances = (await query(`SELECT source_type FROM market_source_types WHERE epistemic_stance <> 'rehearsal' GROUP BY epistemic_stance ORDER BY source_type LIMIT 2`, []))
      .rows as unknown as Array<Record<string, unknown>>;
    let n = 0;
    for (const st of stances) {
      n += 1;
      await query(`INSERT INTO market_observations
          (id, founder_id, claim_id, source_type, source, saw, bearing, directness, observed_at, evidence_mode)
        VALUES (?,?,'sh_c2',?,?,'somebody wrote about the register','supports','direct',datetime('now'),'real')`,
      [`sh_p${String(n)}`, OWNER, String(st.source_type), `https://example.com/p${String(n)}`]);
    }
    const old = (await shelfCandidates(OWNER)).flatMap((sh) => sh.candidates).find((k) => k.id === 'sh_old');
    expect(old?.stances).toBe(2);
    expect(old?.evidence).toBe('2 independent ways of knowing');
  });

  it('a long problem sentence is cut, because the whole argument is one tap away', async () => {
    await query(`UPDATE venture_opportunities SET the_problem = ? WHERE id = 'sh_old'`,
      ['x'.repeat(400)]);
    const k = (await shelfCandidates(OWNER)).flatMap((sh) => sh.candidates).find((c) => c.id === 'sh_old');
    expect(k?.theProblem.length).toBeLessThan(130);
    expect(k?.theProblem.endsWith('…')).toBe(true);
  });
});

describe('a rehearsal is never a finding', () => {
  it('a rehearsal candidate is never counted among things found about the world', async () => {
    // The rehearsal search exists so he can watch the machinery work before a
    // real market has ever answered. What it invents may never be counted as
    // something found, which is the whole difference between a rehearsal and
    // a shortcut. A reference candidate needs a reference search, so this
    // closes the real one, opens that, and asks the shelves again.
    const { openMandate, stopMandate } = await import('../../src/services/venture/mandate.js');
    await stopMandate(OWNER, 'test');
    const rehearsal = await openMandate({ founderId: OWNER, statement: 'A rehearsal', shape: null, evidenceMode: 'reference' });
    if ('refused' in rehearsal) throw new Error(rehearsal.refused);
    await query(
      `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
       VALUES ('sh_fake',?,?,'an invented api thing','nobody','invented','invented','invented','[]','reference')`,
      [rehearsal.id, OWNER]);

    const found = (await shelfCandidates(OWNER)).flatMap((s) => s.candidates).map((k) => k.id);
    expect(found).not.toContain('sh_fake');
    // The real candidates went with their search: buried with the reason, not counted and not lost.
    const buried = (await query(`SELECT id, verdict, verdict_why FROM venture_opportunities WHERE id IN ('sh_opp','sh_old')`, [])).rows as unknown as Array<Record<string, unknown>>;
    expect(buried.every((b) => String(b.verdict) === 'rejected' && String(b.verdict_why).includes('the search was closed'))).toBe(true);
  });
});
