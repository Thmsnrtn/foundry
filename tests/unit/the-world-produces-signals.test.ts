process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { briefFor, discover, readSignal, weedOut } from '../../src/services/venture/discovery.js';
import { connectResearchSource } from '../../src/services/venture/research-sources.js';
import { openSeeds, whatItWouldTakeToBelieve, whyWeStartedLooking } from '../../src/services/venture/seeds.js';
import { absorbParagraph, currentMandate, readVentureParagraph } from '../../src/services/venture/mandate.js';

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
    expect(first?.seed).toContain('"');
    expect(first?.nextQuestion).toContain('already sell something');

    // ORIGIN IS WALKABLE. The seed points at the observation; the observation is
    // what somebody wrote.
    const seed = (await query(
      `SELECT origin, origin_observation_id, inference, signal_kind
         FROM opportunity_seeds WHERE id = ?`, [first?.seedId]))
      .rows[0] as Record<string, unknown>;
    expect(String(seed.origin)).toBe('signal');
    expect(seed.origin_observation_id).not.toBeNull();
    // And the reading is stored AS a reading, never as the evidence.
    expect(String(seed.inference)).toContain('reads like');
    expect(String(seed.signal_kind)).toBeTruthy();
  });
});

describe('and then kills most of them', () => {
  it('buries a seed the world had nothing to say about', async () => {
    // The second way of knowing returns things that share no words with it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(replies({
      total: 900,
      objects: [{ package: { name: 'unrelated-thing', version: '1.0.0',
        date: '2026-01-01', description: 'Something else entirely',
        links: { npm: 'https://npm/z' } } }],
    }));
    const weeded = await weedOut({ founderId: OWNER, world: 'real' });
    vi.restoreAllMocks();

    expect(weeded.asked).toBeGreaterThan(0);
    expect(weeded.buried.length).toBeGreaterThan(0);
    // It died of evidence, not of taste.
    expect(weeded.buried[0]?.because).toContain('the world had nothing to say');

    const dead = (await query(
      `SELECT buried_because FROM opportunity_seeds
        WHERE founder_id = ? AND buried_at IS NOT NULL LIMIT 1`, [OWNER]))
      .rows[0] as Record<string, unknown>;
    expect(String(dead.buried_because)).toContain('asked what already exists');
  });

  it('leaves a survivor eligible for investigation, not for belief', async () => {
    const open = await openSeeds(OWNER);
    for (const seed of open) {
      const believe = await whatItWouldTakeToBelieve(seed.id);
      // Surviving the weeding is not the promotion gate. Two stances make a
      // seed worth looking at further; the candidate rule is separate.
      expect(believe.have.length).toBeLessThanOrEqual(2);
    }
    expect(await whyWeStartedLooking('nothing')).toBeNull();
  });
});
