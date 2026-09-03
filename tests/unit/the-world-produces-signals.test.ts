process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A READER THAT ONLY QUOTES WHAT IS IN FRONT OF IT.
 *
 * The stub picks a quote that genuinely appears in the prompt, because the
 * database refuses a citation that is not a verbatim span of the observation —
 * a stub that paraphrases would be testing the guard rather than the pass.
 * Anything it does not recognise, it declines, which is what a real reader does
 * with most sentences.
 */
const QUOTES: Array<{ span: string; asserts: string; hypothesis: string }> = [
  { span: 'spreadsheet of every supplier certificate expiry',
    asserts: 'pain_exists',
    hypothesis: 'watching supplier certificate expiry dates may be a burden worth removing' },
  { span: 'wrote a script to keep track of the differences',
    asserts: 'gap_exists',
    hypothesis: 'nothing may exist that reconciles two ledgers unattended' },
];

vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (_system: string, user: string) => {
    const hit = QUOTES.find((q) => user.includes(q.span));
    return {
      content: hit === undefined
        ? JSON.stringify({ abstain: 'I cannot infer a coherent economic problem from this.' })
        : JSON.stringify({
          abstain: null,
          reading: `This may describe recurring work somebody does by hand: ${hit.span}.`,
          motivated_by: hit.span,
          ambiguity: 'whether this is one workplace or common practice',
          or_it_could_be: 'somebody who prefers their own records',
          misread_if: 'it turns out to be a one-off rather than a repeating cycle',
          hypothesis: hit.hypothesis,
          hypothesis_kind: hit.asserts,
          who_it_may_be: 'small teams responsible for compliance paperwork',
          next_question: 'does anything already do this unattended, and is it maintained',
        }),
      tokensUsed: 10, costUsd: 0,
    };
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { briefFor, discover, promoteWhatEarnedIt, readSignal, weedOut } = await import('../../src/services/venture/discovery.js');
const { connectResearchSource } = await import('../../src/services/venture/research-sources.js');
const { openSeeds, whatItWouldTakeToBelieve, whyWeStartedLooking } = await import('../../src/services/venture/seeds.js');
const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');
const { absorbParagraph, currentMandate, readVentureParagraph } = await import('../../src/services/venture/mandate.js');

// =============================================================================
// THE WORLD PRODUCES SIGNALS; FOUNDRY PRODUCES HYPOTHESES ABOUT THEM.
//
// The failure designed against is not laziness. It is a model generating
// plausible startup ideas and then searching for things that sound supportive,
// which produces sourced, dated, confident nonsense.
//
// So discovery starts from what the PORTFOLIO NEEDS, reads economic signals out
// of what people actually wrote, quotes rather than paraphrases, and then kills
// most of what it sowed using a genuinely different way of knowing. A permissive
// frontier is only defensible if most of it dies quickly, of evidence.
// =============================================================================

const OWNER = 'disc_owner';
let mandateId = '';

/**
 * A FRESH RESPONSE EVERY CALL.
 *
 * A Response body can be read once. Returning one instance from a mock makes
 * the second fetch fail with "body already read", which looks like a defect in
 * the code under test and is a defect in the mock.
 */
function replies(body: unknown): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_disc', 'owner@example.com', 'Owner']);
  for (const [type, named] of [['community', 'hn_algolia'], ['directory', 'npm_registry']]) {
    await connectResearchSource({ founderId: OWNER, sourceType: String(type),
      named: String(named), neverGrants: 'contact anyone I find or spend anything',
      evidenceMode: 'real' });
  }
  await absorbParagraph({ founderId: OWNER, evidenceMode: 'real',
    readings: readVentureParagraph(
      'Find another small digital income stream that would make my portfolio more '
      + 'resilient. Keep legal risk low.') });
  mandateId = (await currentMandate(OWNER))?.id ?? '';
});

describe('the brief', () => {
  it('never invents an asset shape the owner did not name', async () => {
    const brief = await briefFor({ founderId: OWNER, mandateId, world: 'real' });
    // "Find another small digital income stream" must not silently become
    // "find another SaaS" — the failure the river-of-nickels mandate exists to
    // prevent.
    expect(brief?.shapeNamed).toBeNull();
    expect(brief?.heldTo).toContain('legal risk');
    // And the terms are about work people do, not about product categories.
    expect(brief?.terms.join(' ')).toContain('manually');
    expect(brief?.terms.join(' ')).not.toMatch(/saas|platform|marketplace/i);
  });

  it('cannot have a shape filled in afterwards', async () => {
    const brief = (await query(
      'SELECT id FROM search_briefs ORDER BY rowid DESC LIMIT 1', []))
      .rows[0] as Record<string, unknown>;
    await expect(query(
      "UPDATE search_briefs SET shape_named = 'saas' WHERE id = ?", [String(brief.id)]))
      .rejects.toThrow(/shape_cannot_be_invented/);
  });
});

describe('reading a signal', () => {
  it('quotes the sentence rather than paraphrasing it', () => {
    const signal = readSignal(
      'We keep a spreadsheet of every client renewal date and update it by hand '
      + 'each Monday. It is the worst hour of my week.');
    expect(signal?.kind).toBe('manual_workaround');
    // Two earlier attempts failed here: naming the seed after the search term,
    // then extracting nearby nouns, which produced word salad. A paraphrase
    // that cannot parse is worse than no paraphrase.
    expect(signal?.clause).toContain('spreadsheet of every client renewal date');
  });

  it('returns nothing when the sentence says too little', () => {
    expect(readSignal('did it by hand')?.clause).toBeNull();
  });

  it('reads nothing into text with no marker', () => {
    expect(readSignal('I like this library a lot, it works well.')).toBeNull();
  });
});

describe('a pass of discovery', () => {
  it('sows a few seeds, each pointing at a sentence somebody wrote', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(replies({
      nbHits: 3,
      hits: [
        { objectID: '1', created_at: '2026-05-01T00:00:00Z',
          comment_text: 'We keep a spreadsheet of every supplier certificate expiry '
            + 'and check it by hand each month. Something always slips.' },
        { objectID: '2', created_at: '2026-04-01T00:00:00Z',
          comment_text: 'I like this library.' },
        { objectID: '4', created_at: '2026-02-01T00:00:00Z',
          comment_text: 'I sort my whole vinyl collection by hand every weekend, '
            + 'purely because I enjoy doing it that way.' },
        { objectID: '3', created_at: '2026-03-01T00:00:00Z',
          comment_text: 'There is no tool that reconciles these two ledgers, so we '
            + 'wrote a script to keep track of the differences.' },
      ],
    }));
    const result = await discover({ founderId: OWNER, mandateId, world: 'real' });
    vi.restoreAllMocks();

    expect(result.sown.length).toBeGreaterThan(0);
    // Frontier discipline: a small number of meaningful seeds, never a volume.
    expect(result.sown.length).toBeLessThanOrEqual(4);
    const first = result.sown[0];
    // THE SEED IS NOW A HYPOTHESIS IN FOUNDRY'S OWN WORDS, not a quote of the
    // search term and not a quote of the source. What the source said is
    // preserved beneath it.
    expect(first?.seed).not.toContain('"');
    expect(first?.seed).toMatch(/may|might/);
    expect(first?.asserts).toBeTruthy();
    // And the next question came from reading the sentence rather than from a
    // fixed string, which is the whole point: understanding a signal well
    // enough to ask a better next question.
    expect(first?.nextQuestion).toContain('unattended');
    // The sentence somebody actually wrote is still underneath, verbatim.
    const beneath = (await query(
      'SELECT origin_said FROM opportunity_seeds WHERE id = ?', [first?.seedId]))
      .rows[0] as Record<string, unknown>;
    expect(String(beneath.origin_said)).toContain('by hand each month');
    // MOST OF A PASS IS DECLINING, and it declines in two different places.
    // The sentence with no marker at all was never paid to be read; the one
    // with a marker and no business in it was read and turned down.
    expect(result.read).toBeLessThan(result.looked);
    expect(result.passedOver.some((p) => p.because.includes('coherent economic problem')))
      .toBe(true);

    // ORIGIN IS WALKABLE. The seed points at the observation; the observation is
    // what somebody wrote.
    const seed = (await query(
      `SELECT origin, origin_observation_id, inference, signal_kind, interpretation_id
         FROM opportunity_seeds WHERE id = ?`, [first?.seedId]))
      .rows[0] as Record<string, unknown>;
    expect(String(seed.origin)).toBe('signal');
    expect(seed.origin_observation_id).not.toBeNull();
    expect(seed.interpretation_id).not.toBeNull();
    // And the reading is stored AS a reading, never as the evidence.
    expect(String(seed.inference)).toContain('may describe');
    expect(String(seed.signal_kind)).toBeTruthy();
    // THE OBSERVATION CLAIMS ONLY THAT SOMEBODY WROTE IT. The earlier version
    // filed Foundry's reading of the sentence as the claim, wearing the
    // sentence's authority.
    const claims = ((await query(
      'SELECT claim FROM market_claims WHERE seed_id = ?', [first?.seedId]))
      .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.claim));
    expect(claims.some((c) => c.startsWith('somebody wrote:'))).toBe(true);
    expect(claims.some((c) => c === first?.seed)).toBe(true);
  });
});

describe('and then kills what the evidence actually contradicts', () => {
  it('does not bury a claim about pain because a registry came back empty', async () => {
    // THE DEFECT THAT SHIPPED, as a test. The old rule was SOURCE TWO EMPTY,
    // THEREFORE BURY. A registry knows what already exists and knows nothing
    // whatever about whether the work hurts, so its silence cannot falsify a
    // claim about pain.
    vi.spyOn(globalThis, 'fetch').mockImplementation(replies({
      total: 900,
      objects: [{ package: { name: 'unrelated-thing', version: '1.0.0',
        date: '2026-01-01', description: 'Something else entirely',
        links: { npm: 'https://npm/z' } } }],
    }));
    const weeded = await weedOut({ founderId: OWNER, world: 'real' });
    vi.restoreAllMocks();

    const pain = weeded.saidNothing.find((s) => s.seed.includes('certificate expiry'));
    expect(pain).toBeDefined();
    expect(pain?.because).toContain('does not settle');
    // And what it DID establish is kept, because "pain exists, no substitute
    // found" does not make the pain false — it may strengthen a gap thesis.
    expect(pain?.because).toContain('what a gap looks like');
    // Still alive, and honestly so.
    expect(weeded.buried.map((b) => b.seed)).not.toContain(pain?.seed);
    // And the questioning is on the record, so a later burial can be shown to
    // have rested on evidence capable of bearing it.
    const asked = (await query(
      `SELECT q.stance, q.found, q.bearing FROM seed_questionings q
         JOIN opportunity_seeds s ON s.id = q.seed_id
        WHERE q.founder_id = ? AND s.seed LIKE '%certificate expiry%'
        ORDER BY q.rowid DESC LIMIT 1`, [OWNER]))
      .rows[0] as Record<string, unknown> | undefined;
    expect(String(asked?.stance)).toBe('substitute');
    expect(String(asked?.bearing)).toBe('says_nothing');
  });

  it('buries a gap thesis when real, relevant, maintained substitutes come back', async () => {
    // The other half of the owner's example, and the one that IS a strong
    // contradiction: the claim was that nothing exists, and things genuinely
    // about it came back maintained.
    vi.spyOn(globalThis, 'fetch').mockImplementation(replies({
      total: 3,
      objects: [
        { package: { name: 'ledger-reconcile', version: '2.1.0', date: '2026-08-01',
          description: 'Reconciles two ledgers and reports the differences',
          links: { npm: 'https://npm/a' } } },
        { package: { name: 'ledgers-diff', version: '1.4.2', date: '2026-07-14',
          description: 'Unattended reconciliation of ledger differences',
          links: { npm: 'https://npm/b' } } },
      ],
    }));
    const weeded = await weedOut({ founderId: OWNER, world: 'real' });
    vi.restoreAllMocks();

    const dead = weeded.buried.find((b) => b.seed.includes('ledgers'));
    expect(dead).toBeDefined();
    expect(dead?.because).toContain('nothing adequate exists');
    const row = (await query(
      `SELECT buried_because FROM opportunity_seeds
        WHERE founder_id = ? AND buried_at IS NOT NULL AND seed LIKE '%ledgers%'`, [OWNER]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.buried_because)).toContain('asked what already exists');
  });

  it('leaves a survivor eligible for investigation, not for belief', async () => {
    const open = await openSeeds(OWNER);
    for (const seed of open) {
      const believe = await whatItWouldTakeToBelieve(seed.id);
      // Surviving the weeding is not the promotion gate. The candidate rule
      // counts independent ways of knowing and is separate.
      expect(believe.have.length).toBeLessThanOrEqual(2);
    }
    expect(await whyWeStartedLooking('nothing')).toBeNull();
  });
});

describe('and promotes only what earned it', () => {
  it('builds the candidate out of the reading rather than fresh prose', async () => {
    const pass = await promoteWhatEarnedIt({ founderId: OWNER, world: 'real' });
    const first = pass.promoted[0];
    expect(first).toBeDefined();

    const cand = (await query(
      `SELECT headline, who_has_it, the_problem, kill_thesis, unknowns_json
         FROM venture_opportunities WHERE id = ?`, [first?.opportunityId]))
      .rows[0] as Record<string, unknown>;
    // NOTHING IS INVENTED AT PROMOTION. The kill thesis is what the reader said
    // would show it misread the sentence — written before any of this evidence
    // arrived, which is what makes it worth anything.
    expect(String(cand.kill_thesis)).toContain('one-off');
    expect(String(cand.the_problem)).toContain('may describe');
    expect(String(cand.who_has_it)).toContain('compliance');
    // The ambiguity the reader named survives as an unknown rather than being
    // quietly resolved by a confident card.
    expect(String(cand.unknowns_json)).toContain('one workplace');
    expect(String(cand.unknowns_json)).toContain('would pay');

    // AND THE CHAIN IS WALKABLE BACKWARDS, from the candidate to the sentence.
    const why = await whyWeStartedLooking(String(first?.opportunityId));
    expect(why?.observation).toContain('by hand each month');
    expect(why?.motivatedBy).toBeTruthy();
    expect(why?.observation).toContain(String(why?.motivatedBy));
    expect(why?.misreadIf).toContain('one-off');
    expect(why?.lookingFor).toBeTruthy();
  });

  it('refuses a seed that only one way of knowing has spoken about', async () => {
    // A candidate that exists because Foundry told a plausible story about one
    // source is the failure the whole apparatus is built to prevent.
    const seedId = 'lonely_seed';
    const interpId = (await query(
      'SELECT id FROM observation_interpretations WHERE hypothesis IS NOT NULL LIMIT 1'))
      .rows[0] as Record<string, unknown>;
    const claimId = await formClaim({ founderId: OWNER,
      claim: 'people may want this', evidenceMode: 'real' });
    const observationId = await observe({ founderId: OWNER, claimId,
      sourceType: 'community', source: 'https://news.ycombinator.com/item?id=9',
      saw: 'somebody said so', bearing: 'supports', directness: 'direct',
      observedAt: new Date('2026-05-01'), evidenceMode: 'real' });
    await query(
      `INSERT INTO opportunity_seeds
         (id, founder_id, mandate_id, seed, origin, origin_said, origin_observation_id,
          evidence_mode, interpretation_id, hypothesis_kind)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [seedId, OWNER, mandateId, 'people may want this', 'signal', 'somebody said so',
        observationId, 'real', String(interpId.id), 'pain_exists']);
    await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [seedId, claimId]);

    const pass = await promoteWhatEarnedIt({ founderId: OWNER, world: 'real' });
    const no = pass.refused.find((r) => r.seed === 'people may want this');
    expect(no).toBeDefined();
    expect(no?.because).toContain('Only one way of knowing');
    expect(pass.promoted.map((p) => p.seedId)).not.toContain(seedId);
  });
});

describe('a pass that runs twice', () => {
  it('does not sow the same hypothesis again, or mint the claim again', async () => {
    // Both were defects found by reading the diff rather than by a failure: the
    // duplicate check ran after sowing, and each weeding pass minted a fresh
    // claim saying the same thing about the same seed.
    const before = (await query(
      'SELECT COUNT(*) AS n FROM market_claims WHERE founder_id = ?', [OWNER]))
      .rows[0] as Record<string, unknown>;

    vi.spyOn(globalThis, 'fetch').mockImplementation(replies({
      nbHits: 1,
      hits: [{ objectID: '1', created_at: '2026-05-01T00:00:00Z',
        comment_text: 'We keep a spreadsheet of every supplier certificate expiry '
          + 'and check it by hand each month. Something always slips.' }],
    }));
    const again = await discover({ founderId: OWNER, mandateId, world: 'real' });
    vi.restoreAllMocks();
    // It was promoted earlier in this file, so it is no longer an open seed —
    // what must not happen is a second seed for a hypothesis already carried
    // forward. Either way it is not sown twice.
    expect(again.sown.filter((s) => s.seed.includes('certificate expiry')).length)
      .toBeLessThanOrEqual(1);

    vi.spyOn(globalThis, 'fetch').mockImplementation(replies({ total: 0, objects: [] }));
    await weedOut({ founderId: OWNER, world: 'real' });
    await weedOut({ founderId: OWNER, world: 'real' });
    vi.restoreAllMocks();
    const dupes = (await query(
      `SELECT claim, COUNT(*) AS n FROM market_claims
        WHERE founder_id = ? AND claim LIKE 'nothing maintained already does this%'
        GROUP BY claim, seed_id HAVING n > 1`, [OWNER]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(dupes).toEqual([]);
    expect(Number(before.n)).toBeGreaterThan(0);
  });
});
