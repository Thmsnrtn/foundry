process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { forgeFor } from '../../src/services/venture/forge.js';

// =============================================================================
// THE FORGE READS RATHER THAN INVENTS.
//
// An experiment is the most expensive thing this institution does: it reaches
// strangers, spends money, and produces a claim the rest of the estate leans
// on. "What should we test next" is therefore the question where a fabricated
// answer costs the most — and the answer here is not produced at all. It is
// read from rows somebody wrote: questions marked unanswered, and what earlier
// tests said IN ADVANCE they could not establish.
//
// The second half is the one that matters. `cannot_prove` is recorded at design
// time, before the test runs, which is what makes it evidence rather than a
// rationalisation composed afterwards. A next design that forgets it is asking
// the same question again in different words.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
let OWNER = '';
let MANDATE = '';

/** An opportunity hangs off a mandate of the SAME world — a reference
 * opportunity under a real mandate is refused by the schema, and rightly. */
async function opportunity(headline: string, mode: 'real' | 'reference'): Promise<string> {
  const id = nanoid();
  let mandate = MANDATE;
  if (mode === 'reference') {
    // Written directly rather than through `openMandate`, which refuses a
    // second search while one is open — a real rule about the owner's
    // attention, and not the thing under test here.
    mandate = nanoid();
    await query(
      `INSERT INTO venture_mandates (id, founder_id, statement, shape, evidence_mode)
       VALUES (?,?,?,NULL,'reference')`, [mandate, OWNER, 'A rehearsal mandate']);
  }
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,?,'shops','scattered notices','somebody pays','nobody pays','[]',?)`,
    [id, mandate, OWNER, headline, mode]);
  return id;
}

async function unknown(oppId: string, question: string, opts: {
  blocking?: boolean; cheapest?: string | null;
} = {}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES (?,?,?,?,?,?)`,
    [id, OWNER, oppId, question, opts.blocking === false ? 0 : 1, opts.cheapest ?? null]);
  return id;
}

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  OWNER = `forge_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [OWNER, `clerk_${OWNER}`, `${OWNER}@example.com`]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Shops that build the thing', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  MANDATE = m.id;
});

describe('what is worth testing next', () => {
  it('says nothing is written down rather than inventing a question', async () => {
    const f = await forgeFor(OWNER);
    expect(f.open).toEqual([]);
    expect(f.lessons).toEqual([]);
    expect(f.sentence).toMatch(/nothing is written down as unanswered/i);
  });

  it('puts what blocks a decision before what is merely untidy', async () => {
    const o = await opportunity('a brief worth paying for', 'real');
    await unknown(o, 'is it tidy', { blocking: false, cheapest: 'look' });
    await unknown(o, 'will anyone pay', { blocking: true, cheapest: 'ask one shop' });
    const f = await forgeFor(OWNER);
    expect(f.open[0].question).toBe('will anyone pay');
    expect(f.open[0].blocking).toBe(true);
    expect(f.sentence).toMatch(/blocking a decision/i);
  });

  it('names a question nobody knows how to settle as the first thing to work out', async () => {
    const o = await opportunity('a brief worth paying for', 'real');
    await unknown(o, 'would they renew', { cheapest: null });
    const f = await forgeFor(OWNER);
    expect(f.open[0].cheapestTest).toBeNull();
    expect(f.sentence).toMatch(/no cheapest test/i);
  });

  it('says when a question already has a test against it', async () => {
    const o = await opportunity('a brief worth paying for', 'real');
    const u = await unknown(o, 'will anyone pay', { cheapest: 'ask one shop' });
    const { designExperiment } = await import('../../src/services/venture/validation.js');
    const x = await designExperiment({
      founderId: OWNER, opportunityId: o, unknownId: u, evidenceMode: 'real',
      whatWeDo: 'write once', whatWeExpect: 'one pays', wouldDisprove: 'none pays', costCents: 0,
    });
    const f = await forgeFor(OWNER);
    expect(f.open[0].alreadyTesting?.experimentId).toBe(x);
    expect(f.open[0].alreadyTesting?.state).toBe('proposed');
  });

  it('leaves a rehearsal out of both halves', async () => {
    // Its own institution, because one open search per founder is a real rule
    // about his attention: a founder's single mandate decides the world of
    // everything under it, so a rehearsal needs a founder who is rehearsing.
    const rehearser = `forge_ref_${nanoid(8)}`;
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
      [rehearser, `clerk_${rehearser}`, `${rehearser}@example.com`]);
    const mandate = nanoid();
    await query(
      `INSERT INTO venture_mandates (id, founder_id, statement, shape, evidence_mode)
       VALUES (?,?,?,NULL,'reference')`, [mandate, rehearser, 'A rehearsal mandate']);
    const opp = nanoid();
    await query(
      `INSERT INTO venture_opportunities
         (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
       VALUES (?,?,?,'an invented opportunity','shops','x','y','z','[]','reference')`,
      [opp, mandate, rehearser]);
    await query(
      `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
       VALUES (?,?,?,'would an invented shop pay',1,'pretend')`, [nanoid(), rehearser, opp]);

    const f = await forgeFor(rehearser);
    expect(f.open).toEqual([]);
    expect(f.lessons).toEqual([]);
    expect(f.sentence).toMatch(/nothing is written down/i);
  });
});

describe('a note about a source is not a question about the world', () => {
  it('keeps discovery\'s readings of a source out of what to test next', async () => {
    // `market_unknowns` held two kinds of thing under one column. Two of the
    // three rows discovery writes per candidate are readings of a SOURCE —
    // what the text might have meant, how it might have been misread — and no
    // amount of contacting strangers settles either. Migration 314 gave them
    // their own kind.
    const o = await opportunity('a brief worth paying for', 'real');
    await query(
      `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, kind, blocking, cheapest_test)
       VALUES (?,?,?,?,'source_ambiguity',1,NULL)`,
      [nanoid(), OWNER, o, 'unclear from the source: it is unclear whether anyone would pay']);
    await query(
      `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, kind, blocking, cheapest_test)
       VALUES (?,?,?,?,'alternative_reading',1,NULL)`,
      [nanoid(), OWNER, o, 'it could instead mean: this could just be a passing question']);
    await unknown(o, 'will anyone pay', { blocking: true, cheapest: 'ask one shop' });

    const f = await forgeFor(OWNER);
    expect(f.open).toHaveLength(1);
    expect(f.open[0].question).toBe('will anyone pay');
  });

  it('is what the writer itself now records, rather than a prefix somebody greps', async () => {
    const discovery = readFileSync(resolve(ROOT, 'src/services/venture/discovery.ts'), 'utf8');
    expect(discovery).toMatch(/kind: 'source_ambiguity'/);
    expect(discovery).toMatch(/kind: 'alternative_reading'/);
    expect(discovery).toMatch(/kind: 'question'/);
  });
});

describe('what the last test could not establish', () => {
  it('carries the limit written before the run, not a verdict written after', async () => {
    const o = await opportunity('a brief worth paying for', 'real');
    const u = await unknown(o, 'will anyone pay', { cheapest: 'ask one shop' });
    const { designExperiment } = await import('../../src/services/venture/validation.js');
    const { recordDesign } = await import('../../src/services/venture/probe-design.js');
    const x = await designExperiment({
      founderId: OWNER, opportunityId: o, unknownId: u, evidenceMode: 'real',
      whatWeDo: 'write once', whatWeExpect: 'one pays', wouldDisprove: 'none pays', costCents: 0,
    });
    await recordDesign({
      founderId: OWNER, experimentId: x,
      decides: 'whether a shop pays for the brief', decidesBecause: 'nothing cheaper answers it',
      exchange: 'upfront_price', exchangeBecause: 'money is the only answer that costs the sayer something',
      canProve: 'that some shop paid', cannotProve: 'that many would, or that they would pay again',
      ratherThanWaiting: 'a stranger answers in a week', distribution: 'one message each',
      ifItSucceeds: 'write the brief and send it, then ask whether it was worth it',
      recommendation: 'run', recommendationBecause: 'it is the cheapest thing that answers the question',
      designedBy: 'institution',
      interpretations: [{ observation: 'nobody pays', reading: 'the offer is wrong or the list is', distinguishedBy: 'whether anyone opened it' }],
      alternatives: [{ exchange: 'value_first', notChosenBecause: 'it confounds interest with willingness to pay' }],
      costs: [{ dimension: 'owner_attention', level: 'low', grounds: 'one message each' }],
      stopConditions: [{ kind: 'complaints', threshold: 1, because: 'one complaint is one too many' }],
    });
    await query(`UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'), decided_by = 'owner' WHERE id = ?`, [x]);

    const f = await forgeFor(OWNER);
    expect(f.lessons).toHaveLength(1);
    expect(f.lessons[0].couldNotEstablish).toMatch(/that many would/);
    expect(f.lessons[0].decided).toMatch(/whether a shop pays/);
    // The world has not answered; the page must not imply it has.
    expect(f.lessons[0].verdict).toBeNull();
  });

  it('does not count a test the owner declined as something that taught anything', async () => {
    const o = await opportunity('a brief worth paying for', 'real');
    const u = await unknown(o, 'will anyone pay', { cheapest: 'ask one shop' });
    const { designExperiment } = await import('../../src/services/venture/validation.js');
    const x = await designExperiment({
      founderId: OWNER, opportunityId: o, unknownId: u, evidenceMode: 'real',
      whatWeDo: 'write once', whatWeExpect: 'one pays', wouldDisprove: 'none pays', costCents: 0,
    });
    await query(`UPDATE venture_experiments SET decision = 'declined', decided_at = datetime('now'), decided_by = 'owner' WHERE id = ?`, [x]);
    const f = await forgeFor(OWNER);
    expect(f.lessons).toEqual([]);
  });
});

describe('the forge has no hands', () => {
  const SOURCE = readFileSync(resolve(ROOT, 'src/services/venture/forge.ts'), 'utf8');
  const PAGE = readFileSync(resolve(ROOT, 'src/routes/dashboard/experiments-place.ts'), 'utf8');

  it('writes nothing at all', () => {
    expect(SOURCE).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
  });

  it('offers no button that composes a design', () => {
    // Designing a test means saying what it decides, what it would prove, what
    // it would not, and what would stop it. Those sentences are the owner's or
    // they are nobody's: a design composed here would be the institution
    // marking its own homework.
    const forgeSection = PAGE.slice(PAGE.indexOf("'/foundry/experiments/next'"), PAGE.indexOf('// ─── The test ─'));
    expect(forgeSection).not.toMatch(/<form/);
    expect(forgeSection).not.toMatch(/recordDesign|designExperiment/);
  });

  it('is mounted before the id route, or `next` would be read as an experiment', () => {
    expect(PAGE.indexOf("'/foundry/experiments/next'"))
      .toBeLessThan(PAGE.indexOf("'/foundry/experiments/:id'"));
  });
});
