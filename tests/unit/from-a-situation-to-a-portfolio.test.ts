process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  currentSpell, decideRecommendation, openRecommendations, recommendFor,
  recordSituation, spellHistory, whatFollowed,
} from '../../src/services/founder/situation-chain.js';
import { portfolioFor, whereTheNextDollarGoes } from '../../src/services/founder/portfolio.js';
import {
  advanceReferenceWorld, establishReferenceCompany,
} from '../../src/services/reference/world.js';

// =============================================================================
// FROM A SITUATION TO A PORTFOLIO.
//
// The chain the owner named — situation, diagnosis, responsibility discovery,
// recommendation, bounded operation, outcome, learning, comparison — existed
// only as isolated links, because the first one forgot. `whatSituation()` was
// recomputed on every page load and stored nowhere, so nothing could ask how
// long, what changed, or whether anything followed.
//
// Every assertion here runs against the reference world through the production
// path. That is the point of having one: the whole machine can be built and
// falsified before an external business is asked to teach it anything.
// =============================================================================

const OWNER = 'sp_owner';

async function reference(scenarioKey: string): Promise<string> {
  const made = await establishReferenceCompany({ scenarioKey, ownerId: OWNER });
  if (!made) throw new Error(`no scenario ${scenarioKey}`);
  await advanceReferenceWorld(made.productId);
  return made.productId;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_sp', 'owner@example.com', 'Owner']);
});

describe('a diagnosis that persists', () => {
  it('records a spell, and recording again changes nothing', async () => {
    const id = await reference('revenue_quietly_falling');
    const first = await recordSituation(id);
    expect(first.situation).toBe('revenue_falling');

    // Idempotent by construction: an unchanged answer writes nothing, so the
    // page can be opened a hundred times and leave one row.
    const again = await recordSituation(id);
    expect(again.id).toBe(first.id);
    const rows = (await query(
      'SELECT COUNT(*) AS n FROM company_situations WHERE product_id = ?', [id]))
      .rows[0] as Record<string, unknown>;
    expect(Number(rows.n)).toBe(1);
  });

  it('closes one spell and opens the next when the answer changes', async () => {
    const id = await reference('steady_and_unremarkable');
    const steady = await recordSituation(id);
    expect(steady.situation).toBe('steady');

    // The senses break. That outranks anything a reading could say.
    const { noteSenseObserved } = await import('../../src/services/senses/index.js');
    await noteSenseObserved(id, 'reference_world', 'the provider stopped answering');
    const blind = await recordSituation(id);
    expect(blind.situation).toBe('blind');
    expect(blind.id).not.toBe(steady.id);

    // And the record says what it became, which is the question the whole
    // table exists to answer.
    const past = await spellHistory(id);
    expect(past[0]).toMatchObject({ situation: 'steady', becameWhat: 'blind' });
  });

  it('refuses a spell that ends without saying what followed', async () => {
    const id = await reference('customers_leaving_faster');
    const spell = await recordSituation(id);
    await expect(query(
      "UPDATE company_situations SET ended_at = datetime('now') WHERE id = ?", [spell.id]))
      .rejects.toThrow(/end_needs_successor/);
    await expect(query('DELETE FROM company_situations WHERE id = ?', [spell.id]))
      .rejects.toThrow(/immutable/);
  });

  it('carries the provenance of the evidence under it', async () => {
    // A situation is only ever as real as the readings it came from, and the
    // guard refuses a caller that says otherwise.
    const id = await reference('payments_quietly_failing');
    const spell = await recordSituation(id);
    expect(spell.evidenceMode).toBe('reference');
    await expect(query(
      `INSERT INTO company_situations (id,product_id,situation,headline,evidence_mode)
       VALUES ('sp_lie',?,'steady','x','real')`, [id]))
      .rejects.toThrow(/evidence_mode_mismatch/);
  });
});

describe('what Foundry would do about it', () => {
  it('says what it would do, and what it would need', async () => {
    const id = await reference('growth_that_is_not_converting');
    await recordSituation(id);
    const advice = await recommendFor(id);
    expect(advice.length).toBeGreaterThan(0);
    expect(advice.map((a) => a.kind)).toContain('find_where_they_stop');
    // THE HONEST HALF. Most of these need something Foundry does not have, and
    // saying so turns "here is what I would do" into a request.
    expect(advice.find((a) => a.kind === 'find_where_they_stop')?.wouldNeed)
      .toContain('I cannot yet');
  });

  it('says nothing about a company that is fine', async () => {
    // An institution that produces advice anyway is one the owner learns to
    // skim, and then to ignore.
    const id = await reference('steady_and_unremarkable');
    await query("UPDATE company_senses SET last_error = NULL WHERE product_id = ?", [id]);
    await query(
      `UPDATE company_situations SET ended_at = datetime('now'), ended_as = 'steady'
        WHERE product_id = ? AND ended_at IS NULL`, [id]);
    await recordSituation(id);
    expect(await recommendFor(id)).toEqual([]);
  });

  it('raises each thing once per spell, however often it runs', async () => {
    const id = await reference('customers_leaving_faster');
    await recordSituation(id);
    const first = await recommendFor(id);
    await recommendFor(id);
    await recommendFor(id);
    expect((await openRecommendations(id)).length).toBe(first.length);
  });

  it('will not advise about a situation that has already ended', async () => {
    const id = await reference('revenue_quietly_falling');
    const spell = await recordSituation(id);
    await query(
      `UPDATE company_situations SET ended_at = datetime('now'), ended_as = 'steady'
        WHERE id = ?`, [spell.id]);
    await expect(query(
      `INSERT INTO situation_recommendations
         (id,situation_id,product_id,kind,summary,why,would_need)
       VALUES ('sp_late',?,?,'k','s','w','n')`, [spell.id, id]))
      .rejects.toThrow(/situation_closed/);
  });
});

describe('what followed', () => {
  it('reports what happened after, and refuses to call it cause', async () => {
    const id = await reference('payments_quietly_failing');
    await recordSituation(id);
    const advice = await recommendFor(id);
    const one = advice[0];
    if (!one) throw new Error('expected advice');
    await decideRecommendation({
      id: one.id, decision: 'accepted', decidedBy: `founder:${OWNER}` });

    const learned = await whatFollowed(one.kind);
    // Counted across REAL companies only: what followed in the reference world
    // is a fact about a company that does not exist, and letting it into this
    // number would make the institution's own track record synthetic.
    expect(learned.raised).toBe(0);
    expect(learned.caveat).toContain('I do not know that it was the cause');
  });

  it('will not let anyone but the owner decide', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
      ['sp_other', 'c_o', 'o@e.com']);
    const id = await reference('customers_leaving_faster');
    const advice = await openRecommendations(id);
    const one = advice[0];
    if (!one) throw new Error('expected advice');
    await expect(decideRecommendation({
      id: one.id, decision: 'accepted', decidedBy: 'founder:sp_other' }))
      .rejects.toThrow(/not_the_owner/);
  });
});

describe('the portfolio', () => {
  it('puts the worst first, and never mixes the worlds', async () => {
    const REAL_A = 'sp_real_a';
    const REAL_B = 'sp_real_b';
    for (const [id, name] of [[REAL_A, 'AcreOS'], [REAL_B, 'Quiet Co']] as const) {
      await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')",
        [id, name, OWNER]);
    }
    // A real company in trouble, and one nothing reports on.
    for (const [rid, back, mrr] of [
      ['sp_t1', '-40 day', 500000], ['sp_t2', '0 day', 200000]] as const) {
      await query(
        `INSERT INTO metric_snapshots (id,product_id,snapshot_date,new_mrr_cents)
         VALUES (?,?,date('now',?),?)`, [rid, REAL_A, back, mrr]);
    }
    await recordSituation(REAL_A);
    await recordSituation(REAL_B);

    const portfolio = await portfolioFor(OWNER);
    expect(portfolio.companies.map((c) => c.name)).toEqual(['AcreOS', 'Quiet Co']);
    expect(portfolio.companies[0]?.situation).toBe('revenue_falling');
    // INVENTED COMPANIES ARE COUNTED SEPARATELY OR NOT AT ALL. A portfolio
    // total including a company that does not exist is the exact corruption
    // the reality boundary exists to prevent.
    expect(portfolio.companies.every((c) => !c.reference)).toBe(true);
    expect(portfolio.reference.length).toBeGreaterThan(0);
    expect(portfolio.headline).not.toContain('Reference');
  });

  it('says what each company needs from him, in the order a person deals with them', async () => {
    const portfolio = await portfolioFor(OWNER);
    const quiet = portfolio.companies.find((c) => c.name === 'Quiet Co');
    expect(quiet?.needsHim).toBeNull();
    expect(portfolio.headline).toBeTruthy();
  });

  it('refuses to allocate capital, and says why', async () => {
    // The question where a confident wrong answer is most expensive. Foundry
    // cannot see what each company could do with the money, or what he is
    // trying to build, so it orders and names what it does not know.
    const view = await whereTheNextDollarGoes(OWNER);
    expect(view.whatIDoNotKnow.length).toBeGreaterThan(1);
    expect(view.recommendation).toBeTruthy();
    // REJECTION IS THE VALUABLE HALF: with a company in trouble, the answer is
    // to fix that first rather than to spend.
    expect(view.recommendation).toMatch(/Not yet|None of them/);
  });
});

describe('the owner surface', () => {
  const asOwner = async (path: string, body?: string): Promise<{
    status: number; text: string; location: string | null;
  }> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    const res = await app.request(path, body == null ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };

  it('makes the companies place the portfolio, without adding a door', async () => {
    const page = await asOwner('/foundry/companies');
    expect(page.status).toBe(200);
    expect(page.text).toContain('AcreOS');
    expect(page.text).toContain('Revenue is falling');
    // Still three places.
    expect(page.text).not.toContain('href="/foundry/portfolio"');
  });

  it('shows what it would do, and that agreeing starts nothing', async () => {
    const falling = (await portfolioFor(OWNER)).companies[0];
    if (!falling) throw new Error('expected a company');
    const page = await asOwner(`/foundry/companies/${falling.productId}`);
    expect(page.text).toContain('What I would do');
    expect(page.text).toContain('Agreeing does not start anything on its own');
  });

  it('records agreement without starting anything', async () => {
    const falling = (await portfolioFor(OWNER)).companies[0];
    if (!falling) throw new Error('expected a company');
    const advice = await openRecommendations(falling.productId);
    const one = advice[0];
    if (!one) throw new Error('expected advice');
    const done = await asOwner(`/foundry/advice/${one.id}/accept`, '');
    expect(done.location).toBe(`/foundry/companies/${falling.productId}?done=agreed`);

    const after = await asOwner(`/foundry/companies/${falling.productId}?done=agreed`);
    expect(after.text).toContain('Nothing has\n      started');
    // No act was created by agreeing. That path is separate, owner-bound and
    // act-bound, and collapsing them would make "good idea" mean "go ahead".
    const acts = (await query(
      'SELECT COUNT(*) AS n FROM proposed_acts WHERE product_id = ?',
      [falling.productId])).rows[0] as Record<string, unknown>;
    expect(Number(acts.n)).toBe(0);
  });

  it('answers what he owns and where the next dollar goes', async () => {
    const owned = await asOwner(`/foundry?q=${encodeURIComponent('What do I own?')}`);
    expect(owned.text).toContain('AcreOS');
    const capital = await asOwner(
      `/foundry?q=${encodeURIComponent('Where should the next dollar go?')}`);
    expect(capital.text).toContain('What I do not know');
    expect(capital.text).toContain('an ordering, not an allocation');
  });

  it('refuses advice about someone else\'s company', async () => {
    await query("INSERT INTO products (id,name,owner_id,status) VALUES ('sp_theirs','T','sp_other','active')");
    await query(
      `INSERT INTO company_situations (id,product_id,situation,headline,evidence_mode)
       VALUES ('sp_s','sp_theirs','revenue_falling','x','real')`);
    await query(
      `INSERT INTO situation_recommendations
         (id,situation_id,product_id,kind,summary,why,would_need)
       VALUES ('sp_foreign','sp_s','sp_theirs','k','s','w','n')`);
    expect((await asOwner('/foundry/advice/sp_foreign/accept', '')).status).toBe(404);
  });
});
