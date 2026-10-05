// =============================================================================
// LAW (Roadmap 2027 R39): DISCOVERY NEVER PAYS TWICE FOR ONE SENTENCE.
//
// The discussion archive answers by relevance with no date filter, so it
// returns largely the same top hits every morning; and one comment can match
// two of the brief's phrasings in the same pass. Each match used to become a
// new observation and a new paid reading. Only a reading that abstained was
// remembered, so a sentence that had produced a hypothesis was read again,
// and paid for again, every day. Now a sentence already read (the same
// address or the same words, in this pass or an earlier one, in the same
// world) is passed over before the money is spent, and says when it was read.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';

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
const { discover } = await import('../../src/services/venture/discovery.js');
const { connectResearchSource } = await import('../../src/services/venture/research-sources.js');
const { absorbParagraph, currentMandate, readVentureParagraph } = await import('../../src/services/venture/mandate.js');
const client = await import('../../src/services/ai/client.js');

const OWNER = 'once_owner';
let mandateId = '';
const ONE_COMMENT = { nbHits: 1, hits: [{ objectID: '77', created_at: '2026-05-01T00:00:00Z',
  comment_text: 'We keep a spreadsheet of every supplier certificate expiry and check it by hand each month. Something always slips.' }] };
const reads = () => (client.callSonnet as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

function replies(body: unknown): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_once', 'owner@example.com', 'Owner']);
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

describe('one sentence, read once', () => {
  it('within a pass: a comment that matches every phrasing of the brief is read once', async () => {
    const world = vi.spyOn(globalThis, 'fetch').mockImplementation(replies(ONE_COMMENT));
    const before = reads();
    const r = await discover({ founderId: OWNER, mandateId, world: 'real' });
    world.mockRestore();
    expect(reads() - before).toBe(1);
    expect(r.read).toBe(1);
  });

  it('across passes: the next morning it is passed over before anything is paid, and says when it was read', async () => {
    const world = vi.spyOn(globalThis, 'fetch').mockImplementation(replies(ONE_COMMENT));
    const before = reads();
    const observationsBefore = Number(((await query('SELECT COUNT(*) AS n FROM market_observations WHERE founder_id = ?', [OWNER])).rows[0] as Record<string, unknown>).n);
    const r = await discover({ founderId: OWNER, mandateId, world: 'real' });
    world.mockRestore();
    expect(reads() - before).toBe(0);
    expect(r.read).toBe(0);
    expect(r.passedOver.map((p) => p.because).join(' ')).toMatch(/already read on \d{4}-\d{2}-\d{2}; a sentence is not paid for twice/);
    const observationsAfter = Number(((await query('SELECT COUNT(*) AS n FROM market_observations WHERE founder_id = ?', [OWNER])).rows[0] as Record<string, unknown>).n);
    expect(observationsAfter).toBe(observationsBefore);
  });

  it('a different sentence is still read', async () => {
    const world = vi.spyOn(globalThis, 'fetch').mockImplementation(replies({ nbHits: 1, hits: [{ objectID: '78', created_at: '2026-05-02T00:00:00Z',
      comment_text: 'Every quarter I wrote a script to keep track of the differences between the two ledgers by hand.' }] }));
    const before = reads();
    await discover({ founderId: OWNER, mandateId, world: 'real' });
    world.mockRestore();
    expect(reads() - before).toBe(1);
  });
});
