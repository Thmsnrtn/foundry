process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  absorbGuidance, candidatesFor, currentMandate, openMandate, readVentureSentence,
} from '../../src/services/venture/mandate.js';
import {
  concentrationsFor, portfolioFitOf, shouldAddAnother,
} from '../../src/services/founder/resilience.js';
import {
  cheapestWayForward, formClaim, observe, openUnknowns, raiseUnknown, standingOf,
} from '../../src/services/venture/market-evidence.js';
import { establishReferenceCompany } from '../../src/services/reference/world.js';
import { recordSituation } from '../../src/services/founder/situation-chain.js';

// =============================================================================
// SIX INCOME STREAMS, OR ONE.
//
// The owner's evolution of the venture mandate, made executable. The canonical
// request is no longer "add a micro-SaaS" but:
//
//   "Find another small digital income stream that would make my portfolio
//    more resilient."
//
// and the institution has to be capable of two answers that a machine built to
// produce companies would never give:
//
//   "Another conventional SaaS would deepen a concentration you already have."
//   "I do not recommend adding another venture right now."
//
// THE REHEARSAL PORTFOLIO IS CONCENTRATED ON PURPOSE. Four subscription
// businesses, all billed through the same rails, most reached the same way.
// That is the owner's own example of what is not four income streams, and an
// institution that could not see it here would not see it in his.
//
// AND MARKET KNOWLEDGE IS EVIDENCE, NOT A FEED. Claims stand on dated,
// attributed observations that may CONTRADICT them. Nothing here writes a
// confidence anywhere; how a claim stands is derived from what was seen, and
// changes when something new is seen.
// =============================================================================

const OWNER = 'res_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_res', 'owner@example.com', 'Owner']);
  for (const key of ['revenue_quietly_falling', 'steady_and_unremarkable',
    'growth_that_is_not_converting', 'payments_quietly_failing']) {
    const made = await establishReferenceCompany({ scenarioKey: key, ownerId: OWNER });
    // Diagnosed through the ordinary path, because "should I add another
    // venture" is answered partly by what the ones he has are doing — and a
    // portfolio of companies nobody has looked at would make that question
    // unanswerable rather than easy.
    if (made) await recordSituation(made.productId);
  }
});

describe('hearing the canonical request', () => {
  it('hears a request for an income stream as an entrepreneurial mandate', () => {
    const read = readVentureSentence(
      'Find another small digital income stream that would make my portfolio more resilient');
    expect(read.kind).toBe('mandate');
    // AND NAMES NO SHAPE. He did not ask for a SaaS, and an institution that
    // filled one in would have narrowed the search on his behalf.
    if (read.kind === 'mandate') expect(read.shape).toBeNull();
  });

  it('still hears the micro-SaaS sentence, which is now the special case', () => {
    const read = readVentureSentence(
      "I'd like you to add a new micro-SaaS venture to my portfolio");
    expect(read.kind).toBe('mandate');
    if (read.kind === 'mandate') expect(read.shape).toBe('micro_saas');
  });
});

describe('steering that names an axis', () => {
  const cases: Array<[string, string, string | null, string]> = [
    ["I don't want another subscription business", 'avoid', 'subscription', 'revenue_model'],
    ['Something less dependent on Google', 'avoid', 'google', 'platform_dependency'],
    ['Sell to businesses rather than consumers', 'prefer', 'businesses', 'customer_type'],
    ['Almost no support burden', 'prefer', 'almost no support burden', 'support_burden'],
    ['Higher price, fewer customers', 'prefer', 'higher ticket', 'pricing_model'],
  ];
  for (const [sentence, kind, subject, dimension] of cases) {
    it(`reads "${sentence}" as ${kind} on ${dimension}`, () => {
      const read = readVentureSentence(sentence);
      expect(read.kind).toBe('guidance');
      if (read.kind !== 'guidance') return;
      expect(read.guidance).toBe(kind);
      expect(read.subject).toBe(subject);
      expect(read.dimension).toBe(dimension);
    });
  }

  it('hears "none of these, keep looking" as asking for another', () => {
    const read = readVentureSentence('None of these, keep looking');
    expect(read.kind).toBe('guidance');
    if (read.kind === 'guidance') expect(read.guidance).toBe('another');
  });

  it('does not hear a mandate for a subscription business as its own refusal', () => {
    // The un-negated words are most of a mandate. Reading "add another
    // subscription business" as "I do not want one" would be the worst
    // available mishearing.
    const read = readVentureSentence('Add another subscription business to my portfolio');
    expect(read.kind).toBe('mandate');
  });
});

describe('two preferences that are not in conflict', () => {
  it('keeps both when they are about different axes, and replaces on the same one', async () => {
    const opened = await openMandate({
      founderId: OWNER, statement: 'Find another small digital income stream',
      shape: null, evidenceMode: 'reference' });
    if ('refused' in opened) throw new Error(opened.refused);

    await absorbGuidance({ mandateId: opened.id, statement: 'Higher price, fewer customers',
      kind: 'prefer', subject: 'higher ticket', dimension: 'pricing_model' });
    await absorbGuidance({ mandateId: opened.id, statement: 'Almost no support burden',
      kind: 'prefer', subject: 'almost no support burden', dimension: 'support_burden' });

    let now = await currentMandate(OWNER);
    // BOTH LIVE. Superseding by kind alone would have thrown one away, so the
    // second thing he asked for would quietly cancel the first.
    expect((now?.guidance ?? []).filter((g) => g.kind === 'prefer')).toHaveLength(2);

    // A SECOND OPINION ABOUT PRICING IS A CHANGE OF MIND.
    await absorbGuidance({ mandateId: opened.id, statement: 'Actually, lower ticket',
      kind: 'prefer', subject: 'lower ticket', dimension: 'pricing_model' });
    now = await currentMandate(OWNER);
    const pricing = (now?.guidance ?? []).filter((g) => g.dimension === 'pricing_model');
    expect(pricing).toHaveLength(1);
    expect(pricing[0]?.subject).toBe('lower ticket');
    expect((now?.guidance ?? []).filter((g) => g.kind === 'prefer')).toHaveLength(2);
  });
});

describe('what a single failure could take out', () => {
  it('names what more than one company carries, and what it would cost', async () => {
    const shared = await concentrationsFor(OWNER, 'reference');
    const rails = shared.find((c) => c.dimension === 'provider_dependency');
    expect(rails?.value).toBe('stripe');
    expect(rails?.carriedBy.length).toBeGreaterThanOrEqual(4);
    expect(rails?.ifItFails).toContain('affects all of them');

    // A DEPENDENCY NOTHING ELSE HAS IS A RISK, NOT A CONCENTRATION. Listing it
    // would bury the ones that matter under everything the portfolio touches.
    expect(shared.every((c) => c.carriedBy.length > 1)).toBe(true);

    // AND IT SAYS WHERE IT IS RESTING ON A GUESS. These were declared by the
    // scenarios as the companies' own account of themselves, so nothing here
    // is inferred — and the field exists so that when something is, the
    // sentence he reads says so rather than looking identical.
    expect(shared.every((c) => c.guessed === false)).toBe(true);
  });

  it('counts nothing invented toward a real concentration', async () => {
    // The whole reference portfolio is concentrated, and his real one is empty.
    // If a synthetic exposure could reach this answer, the institution would be
    // telling him to diversify away from something no business of his uses.
    expect(await concentrationsFor(OWNER, 'real')).toHaveLength(0);
  });

  it('refuses to file a reference company exposure as real', async () => {
    const company = (await query(
      "SELECT id FROM products WHERE owner_id = ? AND reality = 'reference' LIMIT 1",
      [OWNER])).rows[0] as Record<string, unknown>;
    await expect(query(
      `INSERT INTO portfolio_exposures
         (id, founder_id, subject_kind, subject_id, dimension, value, how_known, evidence_mode)
       VALUES ('pe_forged', ?, 'company', ?, 'provider_dependency', 'stripe', 'observed', 'real')`,
      [OWNER, String(company.id)])).rejects.toThrow(/evidence_mode_mismatch/);
  });
});

describe('what adding one would do', () => {
  it('says another conventional SaaS would deepen what he already has', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    const candidates = await candidatesFor(open.id);
    const conventional = candidates.find((c) => c.headline.includes('veterinary'));
    expect(conventional).toBeDefined();

    // ON ITS OWN MERITS IT SURVIVES. It is a reasonable business.
    expect(conventional?.survivesGuidance).toBe(true);
    // AND IT IS STILL THE WRONG ONE TO ADD.
    expect(conventional?.fit?.makesItWorse).toBe(true);
    expect(conventional?.fit?.newGround).toHaveLength(0);
    expect(conventional?.fit?.verdict).toContain('not another income stream');
    // And what it would deepen is grounded in what the companies themselves
    // said, not in something Foundry worked out about them — which is the
    // difference the sentence he reads has to carry.
    expect(conventional?.fit?.deepens.some((d) => d.guessed)).toBe(false);
  });

  it('says what is new about one that fails for different reasons', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    const candidates = await candidatesFor(open.id);
    const different = candidates.find((c) => c.headline.includes('dataset'));

    expect(different?.fit?.makesItWorse).toBe(false);
    const opened = (different?.fit?.newGround ?? []).map((n) => n.value);
    expect(opened).toContain('one-off purchase');
    expect(opened).toContain('almost none');
  });

  it('applies steering to what a candidate declared, not to its prose', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    await absorbGuidance({
      mandateId: open.id, statement: "I don't want paid acquisition",
      kind: 'avoid', subject: 'paid acquisition', dimension: 'acquisition_channel' });

    const candidates = await candidatesFor(open.id);
    const arbitrage = candidates.find((c) => c.headline.includes('arbitrage'));
    expect(arbitrage?.survivesGuidance).toBe(false);
    expect(arbitrage?.failsBecause).toContain('makes its money through paid acquisition');
  });

  it('reports a preference it does not meet without calling it disqualifying', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    await absorbGuidance({
      mandateId: open.id, statement: 'Sell to businesses rather than consumers',
      kind: 'prefer', subject: 'businesses', dimension: 'customer_type' });

    const candidates = await candidatesFor(open.id);
    const dataset = candidates.find((c) => c.headline.includes('dataset'));
    // A PREFERENCE IS NOT A PROHIBITION. It is something he should be told and
    // then decide about himself.
    expect(dataset?.survivesGuidance).toBe(true);
    expect(dataset?.against.join(' ')).toContain('you asked for businesses');
  });
});

describe('whether to add one at all', () => {
  it('declines while a company is in trouble', async () => {
    const view = await shouldAddAnother(OWNER, 'reference');
    // The falling company is severe, and the scarcest thing he has is not money.
    expect(view.recommend).toBe(false);
    expect(view.because).toMatch(/trouble|waiting on you/);
    // And it still shows him what is concentrated, because the reason he asked
    // does not stop being true while the answer is no.
    expect(view.concentrations.length).toBeGreaterThan(0);
  });
});

describe('a claim that stands on its evidence', () => {
  it('will not average a contradiction into a verdict', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    const candidates = await candidatesFor(open.id);
    const vet = candidates.find((c) => c.headline.includes('veterinary'));
    const how = vet?.standing[0];
    expect(how?.contradicts).toBe(1);
    expect(how?.howItStands).toContain('the question is open');
    expect(how?.howItStands).not.toMatch(/confident|likely true/i);
  });

  it('says when everything supporting a claim is a company talking about itself', async () => {
    const claimId = await formClaim({
      founderId: OWNER, claim: 'The market will bear forty-nine dollars a month',
      evidenceMode: 'reference' });
    for (const vendor of ['alpha', 'beta', 'gamma']) {
      await observe({
        founderId: OWNER, claimId, sourceType: 'pricing_page',
        source: `reference-world:${vendor}-pricing`,
        saw: 'listed at forty-nine dollars a month', bearing: 'supports',
        directness: 'direct', observedAt: new Date(), evidenceMode: 'reference' });
    }
    const how = await standingOf(claimId);
    expect(how?.supports).toBe(3);
    // THREE PRICING PAGES ARE NOT THREE INDEPENDENT CONFIRMATIONS.
    expect(how?.howItStands).toContain('companies talking about themselves');
    expect(how?.howItStands).toContain('no evidence at all about what anyone pays');
  });

  it('says when everything it knows is about last year', async () => {
    const claimId = await formClaim({
      founderId: OWNER, claim: 'Nobody has built this yet', evidenceMode: 'reference' });
    await observe({
      founderId: OWNER, claimId, sourceType: 'directory',
      source: 'reference-world:category-directory', saw: 'nothing listed in the category',
      bearing: 'supports', directness: 'direct',
      observedAt: new Date(Date.now() - 400 * 86_400_000), evidenceMode: 'reference' });
    const how = await standingOf(claimId);
    expect(how?.stale).toBe(1);
    expect(how?.howItStands).toContain('evidence about last year');
  });

  it('never lets an observation be edited away', async () => {
    const row = (await query(
      'SELECT id FROM market_observations ORDER BY rowid LIMIT 1', []))
      .rows[0] as Record<string, unknown>;
    // A contradiction somebody deleted is a contradiction that never happened.
    await expect(query(
      "UPDATE market_observations SET bearing = 'supports' WHERE id = ?",
      [String(row.id)])).rejects.toThrow(/immutable/);
  });

  it('refuses to let an invented source stand as real evidence', async () => {
    const claimId = await formClaim({
      founderId: OWNER, claim: 'A real claim', evidenceMode: 'real' });
    await expect(observe({
      founderId: OWNER, claimId, sourceType: 'reference_world',
      source: 'reference-world:anything', saw: 'something', bearing: 'supports',
      directness: 'direct', observedAt: new Date(), evidenceMode: 'real' }))
      .rejects.toThrow(/invented_source_in_real_evidence/);
  });
});

describe('what is still not known', () => {
  it('keeps the blocking question with the cheapest thing that would answer it', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    const candidates = await candidatesFor(open.id);
    const vet = candidates.find((c) => c.headline.includes('veterinary'));
    if (!vet) throw new Error('expected the candidate');

    const way = await cheapestWayForward(vet.id);
    expect(way.blocked).toBe(true);
    expect(way.tests.join(' ')).toContain('count who asks how to buy it');
    expect(way.without).toHaveLength(0);

    // AND IT IS ON THE CARD, not in a footnote.
    expect(vet.unanswered.some((u) => u.blocking)).toBe(true);
    expect(vet.blockedBy).toContain('would pay');
  });

  it('names a blocking unknown nobody has found a cheap test for', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    const candidates = await candidatesFor(open.id);
    const dataset = candidates.find((c) => c.headline.includes('dataset'));
    if (!dataset) throw new Error('expected the candidate');

    await raiseUnknown({
      founderId: OWNER, opportunityId: dataset.id, blocking: true,
      question: 'whether the registers permit redistribution at all',
      cheapestTest: null });
    const way = await cheapestWayForward(dataset.id);
    expect(way.blocked).toBe(true);
    // Saying there is no cheap test is the honest blocker, and it is said
    // rather than left implicit.
    expect(way.without).toContain('whether the registers permit redistribution at all');
  });

  it('never lets an unknown be answered with nothing', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    const candidates = await candidatesFor(open.id);
    const dataset = candidates.find((c) => c.headline.includes('dataset'));
    if (!dataset) throw new Error('expected the candidate');
    const unknowns = await openUnknowns(dataset.id);
    await expect(query(
      "UPDATE market_unknowns SET answered_at = datetime('now') WHERE id = ?",
      [String(unknowns[0]?.id)])).rejects.toThrow(/answer_required/);
  });
});

describe('where a concentration starts', () => {
  it('says so at the second business, not once the pattern is established', async () => {
    // The assembled-institution walk found this: against a portfolio of one
    // company, a candidate identical to it in every respect came back as no
    // cause for concern. The second business is where a concentration starts.
    const lone = 'res_lonely';
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [lone, 'clerk_lonely', 'lonely@example.com', 'Lonely']);
    const made = await establishReferenceCompany({
      scenarioKey: 'revenue_quietly_falling', ownerId: lone });
    if (!made) throw new Error('expected a reference company');

    // Nothing is shared yet, because only one thing carries it.
    expect(await concentrationsFor(lone, 'reference')).toHaveLength(0);

    const opened = await openMandate({ founderId: lone, statement: 'Find another',
      shape: null, evidenceMode: 'reference' });
    if ('refused' in opened) throw new Error(opened.refused);
    const twin = (await candidatesFor(opened.id))
      .find((c) => c.headline.includes('veterinary'));
    expect(twin?.fit?.makesItWorse).toBe(true);
    expect(twin?.fit?.verdict).toContain('you already carry');
  });
});

describe('the fit of a candidate nobody has described', () => {
  it('says it does not know, rather than saying nothing is wrong', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    await query(
      `INSERT INTO venture_opportunities
         (id, mandate_id, founder_id, headline, who_has_it, the_problem,
          why_it_might, kill_thesis, unknowns_json, sources_json, evidence_mode)
       VALUES ('opp_undescribed', ?, ?, 'Something nobody has described',
               'unknown', 'unknown', 'unknown', 'unknown', '[]',
               '["reference-world:declared-candidate"]', 'reference')`,
      [open.id, OWNER]);
    const fit = await portfolioFitOf({
      founderId: OWNER, opportunityId: 'opp_undescribed', world: 'reference' });
    expect(fit.makesItWorse).toBe(false);
    expect(fit.verdict).toContain('I do not know enough');
  });
});
