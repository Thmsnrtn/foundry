// =============================================================================
// WAS THE INSTRUMENT WORKING WHEN THE WORLD WAS ASKED?
//
// The worst defect this campaign found, and a returning owner found it by
// using the product: nineteen cold emails went to strangers inviting a reply,
// the Workshop's reply path was not routed, and seven days later the sealed
// rule settled the test SURPRISED and the institution filed that as evidence
// about a market. No rule was broken. A null result is only evidence about the
// world if the world could have answered.
//
// This runs on the world's own path — Experiment 001 carried by the hand, 21
// written to, 19 delivered — because a test that supplies its own result
// cannot show a defect in the instrument that produced one.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';

beforeAll(async () => {
  ({ experimentId: X } = await seedProductionShape({ settledBy: 'the world' }));
  app = await ownerApp();
  me = owner(app);
});

describe('a null result on a channel that may not have carried a reply says less', () => {
  it('the settled page says what was wrong with the instrument and what the result therefore does not establish', async () => {
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    // The Workshop's reply path is not routed, as production's was not.
    await query(`UPDATE public_workshop SET health_json = ?, health_at = datetime('now') WHERE founder_id = ?`,
      [JSON.stringify({ site: { status: 'healthy', detail: '' }, sending: { status: 'healthy', detail: '' },
        replyInbox: { status: 'needs_attention', detail: 'mail routing is not enabled on the zone' } }), OWNER]);
    const doubts = await doubtsAboutTheInstrument(X);
    expect(doubts).toHaveLength(1);
    expect(doubts[0].channel).toBe('reply');
    expect(doubts[0].sentence).toMatch(/messages went out under this test asking people to reply/);
    expect(doubts[0].sentence).toMatch(/mail routing is not enabled/);
    // IT NEVER CLAIMS TO KNOW WHAT IT CANNOT: the health reading is a snapshot.
    expect(doubts[0].sentence).toMatch(/cannot say whether it was working while the test ran/);
    expect(doubts[0].doesNotEstablish).toMatch(/silence on a channel that may not have carried a reply/);
    const page = asText(await me.page(`/foundry/experiments/${X}`));
    expect(page).toContain('About the instrument');
    expect(page).toContain('mail routing is not enabled');
    // THE VERDICT IS NOT TOUCHED. A sealed rule counted what it said it would;
    // what the institution CLAIMS the result establishes is its own to correct.
    expect(page).toContain('Surprised');
    const { outcomeOf } = await import('../../src/services/founder/what-happened.js');
    expect((await outcomeOf(X))!.word).toBe('surprised');
  });

  it('the Inbox says what went out and that silence is not an answer while the path is down', async () => {
    const inbox = asText(await me.page('/foundry/inbox'));
    expect(inbox).toMatch(/messages have gone out under your tests, each inviting a reply/);
    expect(inbox).toContain('The reply path needs you');
    expect(inbox).toContain('silence here is not an answer from anybody');
    expect(inbox).not.toContain('Nothing has been sent, so nothing has come back');
  });

  it('a working reply path raises no doubt at all', async () => {
    await query(`UPDATE public_workshop SET health_json = ? WHERE founder_id = ?`,
      [JSON.stringify({ replyInbox: { status: 'healthy', detail: 'routing is enabled' } }), OWNER]);
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    expect(await doubtsAboutTheInstrument(X)).toEqual([]);
    expect(asText(await me.page(`/foundry/experiments/${X}`))).not.toContain('About the instrument');
  });
});
