process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whichDoor } from '../../src/services/institution/the-door.js';
import { matchQuestion } from '../../src/routes/dashboard/foundry-shell.js';
import {
  absorbParagraph, currentMandate, readVentureParagraph, readVentureSentence, stopMandate,
} from '../../src/services/venture/mandate.js';
import { briefFor } from '../../src/services/venture/discovery.js';

// =============================================================================
// THE OWNER CAN START SOMETHING, AND WHAT HE SAYS NEXT CHANGES WHAT HAPPENS.
//
// "Explore API opportunities" is a direction: it names where to look and
// leaves the mechanics to the institution, which is exactly the division of
// labour autonomy is supposed to buy. It landed in "I did not follow that",
// because every phrase the reader knew named a new company to add and none of
// them meant go and look.
//
// And steering, once heard, did nothing. Of the eight kinds of guidance the
// institution records, only `avoid` and `prefer` were read anywhere. `favour`,
// `deeper` and `industry` were written down, shown back to him, and reached no
// search; `harder` had a function that computed the raised bar and no caller.
// A nudge that changes the record and not the work is a note.
// =============================================================================

const OWNER = 'ss_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_ss', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES ('ss_f','Foundry',?,'active',50)`, [OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry','ss_f','test')`, []);
});

describe('a direction is an instruction', () => {
  it('reads an exploration as a mandate, with the form he named on the record', () => {
    expect(readVentureSentence('Explore API opportunities')).toMatchObject({ kind: 'mandate', shape: 'api' });
    expect(readVentureSentence('Look for something calculator-shaped')).toMatchObject({ kind: 'mandate', shape: 'calculator' });
    expect(readVentureSentence('See if there is anything in monitoring')).toMatchObject({ kind: 'mandate', shape: 'monitoring' });
    expect(readVentureSentence('Explore acquisition instead of building')).toMatchObject({ kind: 'mandate', shape: 'acquisition' });
  });

  it('and a form named is a preference on the record, never the space it may search', () => {
    // The same sentence with no form still opens a search. An institution whose
    // search space were this list would only rediscover what somebody typed here.
    expect(readVentureSentence('Explore opportunities')).toMatchObject({ kind: 'mandate', shape: null });
  });

  it('does not hear an exploration of something that does not earn', () => {
    expect(readVentureSentence('Explore the inbox').kind).toBe('not_venture');
    expect(readVentureSentence('How are things?').kind).toBe('not_venture');
  });

  it('a word that only contains a form is not that form', () => {
    // 'api' is inside 'capital' and 'rapid'. Recognition by substring has to
    // survive the words he actually uses about money.
    expect(readVentureSentence('Explore opportunities for the capital rapidly'))
      .toMatchObject({ kind: 'mandate', shape: null });
  });

  it('both doors send it to the search rather than answering it', () => {
    expect(whichDoor('Explore API opportunities').destination).toBe('venture');
    expect(whichDoor('Explore API opportunities').understoodAs)
      .toBe('you want me to look for another way to make money');
    expect(matchQuestion('Explore API opportunities')).toBe('venture');
    // And an ordinary question is still a question.
    expect(matchQuestion('what do I own')).toBe('portfolio');
  });

  it('steering still outranks starting: a sentence that steers is not a new search', () => {
    expect(readVentureSentence('Look into it more').kind).toBe('guidance');
    expect(readVentureSentence('Keep legal risk low')).toMatchObject({ kind: 'guidance', guidance: 'prefer' });
  });
});

describe('a direction given while a search runs steers it', () => {
  it('is absorbed as a preference on the running search, not refused', async () => {
    await absorbParagraph({ founderId: OWNER, readings: readVentureParagraph('Find me another small income stream') });
    const open = await currentMandate(OWNER);
    expect(open).not.toBeNull();

    const again = await absorbParagraph({ founderId: OWNER, readings: readVentureParagraph('Explore API opportunities') });
    expect(again.refused).toEqual([]);
    expect(again.opened).toBe(false);
    expect(again.pointed).toBe(true);

    const after = await currentMandate(OWNER);
    // One search, and his words are on it — his sentence, not a paraphrase.
    expect(after?.id).toBe(open?.id);
    const favoured = after?.guidance.filter((g) => g.kind === 'favour') ?? [];
    expect(favoured.map((g) => g.statement)).toContain('Explore API opportunities');
    expect(favoured[0]?.subject).toBe('api');
  });
});

describe('steering reaches the search itself', () => {
  it('what he favoured, dug into and named as an industry becomes a word to look for', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('no search');
    await query(`INSERT INTO venture_guidance (id, mandate_id, founder_id, statement, kind, subject, dimension)
      VALUES ('ss_g1',?,?,'Target veterinary practices instead','industry','veterinary practices','industry')`, [open.id, OWNER]);
    await query(`INSERT INTO venture_guidance (id, mandate_id, founder_id, statement, kind, subject, dimension)
      VALUES ('ss_g2',?,?,'Dig deeper into invoice chasing','deeper','invoice chasing',NULL)`, [open.id, OWNER]);

    const brief = await briefFor({ founderId: OWNER, mandateId: open.id, world: 'real' });
    expect(brief).not.toBeNull();
    expect(brief?.terms).toContain('veterinary practices');
    expect(brief?.terms).toContain('invoice chasing');
    expect(brief?.terms).toContain('api');
    // In his own words, said back as the reason the search is looking there.
    expect(brief?.termsFrom.join(' | ')).toContain('he said: Target veterinary practices instead');
    // And the portfolio's own terms are still there: a direction is beside
    // them, never instead of them.
    expect(brief?.terms).toContain('doing this manually every');
  });
});

describe('being harder to convince is harder to convince', () => {
  it('each "be more sceptical" raises the ways of knowing a candidate must survive', async () => {
    await stopMandate(OWNER, 'test');
    await absorbParagraph({
      founderId: OWNER,
      readings: readVentureParagraph('Find me another small income stream. Be more sceptical.'),
    });
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('no search');
    expect(open.guidance.some((g) => g.kind === 'harder')).toBe(true);

    // A seed that two independent ways of knowing support. That is enough for
    // an ordinary search, and this one is not an ordinary search.
    await query(`INSERT INTO opportunity_seeds (id, founder_id, mandate_id, seed, origin, origin_said, evidence_mode)
      VALUES ('ss_seed',?,?,'bookkeepers rebuild an invoice by hand','reasoned','I rebuild this invoice by hand every week','real')`, [OWNER, open.id]);
    await query(`INSERT INTO market_claims (id, founder_id, seed_id, claim, evidence_mode)
      VALUES ('ss_c1',?,'ss_seed','people do this by hand','real')`, [OWNER]);
    const { whatItWouldTakeToBelieve, promote } = await import('../../src/services/venture/seeds.js');
    const stances = (await query(`SELECT source_type FROM market_source_types WHERE epistemic_stance <> 'rehearsal' GROUP BY epistemic_stance ORDER BY source_type LIMIT 2`, []))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(stances.length).toBe(2);
    let n = 0;
    for (const st of stances) {
      n += 1;
      await query(`INSERT INTO market_observations
          (id, founder_id, claim_id, source_type, source, saw, bearing, directness, observed_at, evidence_mode)
         VALUES (?,?,'ss_c1',?,?,'somebody wrote about doing this by hand','supports','direct',datetime('now'),'real')`,
      [`ss_o${String(n)}`, OWNER, String(st.source_type), `https://example.com/${String(n)}`]);
    }

    // Two ways of knowing: enough at the ordinary bar.
    expect((await whatItWouldTakeToBelieve('ss_seed')).enough).toBe(true);
    // And not enough at the bar he set.
    expect((await whatItWouldTakeToBelieve('ss_seed', 3)).enough).toBe(false);

    const refused = await promote({
      seedId: 'ss_seed', headline: 'a brief worth paying for', whoHasIt: 'bookkeepers',
      theProblem: 'they rebuild it by hand', whyItMight: 'somebody pays',
      killThesis: 'nobody pays', unknowns: ['will anyone pay'], sources: ['https://example.com/a'],
    });
    expect('refused' in refused).toBe(true);
    if ('refused' in refused) {
      expect(refused.refused).toContain('you asked for 3');
      expect(refused.refused).toContain('3 genuinely different ways of knowing');
    }
  });
});
