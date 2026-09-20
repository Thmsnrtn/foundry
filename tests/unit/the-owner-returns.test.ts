// =============================================================================
// THE OWNER RETURNS AFTER A FORTNIGHT.
//
// A reviewer drove the day-15 world as the owner and found: "what happened
// while I was away" answered for seven days and called the rest nothing; a
// sentence with the word "Foundry" in it was routed to the company that
// carries Foundry's name; "stop pursuing this direction" was not a stop;
// Explore, empty because he closed the search, called that an answer about
// the world; a buried candidate's reason was printed twice; the same steering
// sentence appeared twice on Activity; "what are you working on" said nobody
// had asked it to look after anything, with his search running every morning.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, advanceDays, asText, owner, ownerApp, routinesRanThisMorning, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;

beforeAll(async () => {
  await seedProductionShape({ searching: true, eyes: true });
  const { markVisit } = await import('../../src/services/founder/what-changed.js');
  await markVisit(OWNER);
  await advanceDays(15);
  await routinesRanThisMorning();
  await markVisit(OWNER); // he is back
  app = await ownerApp();
  me = owner(app);
});

describe('what he asks first', () => {
  it('"what happened while I was away" covers the fortnight and says the search ran', async () => {
    const t = asText(await me.answer("I've been away two weeks. What happened while I was away?"));
    const fortnightAgo = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10);
    expect(t).toContain(`Since ${fortnightAgo}`);
    expect(t).toContain('ran each morning');
    expect(t).not.toContain("I don't know yet");
  });

  it('a sentence with "Foundry" in it is about the institution, not about the company that carries its name', async () => {
    const t = asText(await me.answer('Can I afford to let Foundry run another test?'));
    expect(t).toContain('No charter is signed');
    expect(t).not.toContain('You have not told me to hold back');
  });

  it('"what are you working on" names the search', async () => {
    const t = asText(await me.answer('What are you working on?'));
    expect(t).toContain('I am looking for:');
    expect(t).not.toContain('nobody has asked me to look after anything');
  });

  it('the same steering sentence appears once on Activity', async () => {
    const t = asText(await me.page('/foundry/activity?kind=search'));
    expect(t.split('Steered the search: Find low-maintenance digital income opportunities.').length - 1).toBe(1);
  });
});

describe('stopping in his own words', () => {
  it('"Stop pursuing this direction." is a stop; afterwards Explore says he closed it, and the reason is printed once', async () => {
    const shown = await me.ask('Stop pursuing this direction.');
    expect(await shown.text()).toContain('Stop looking?');
    await me.confirm('Stop pursuing this direction.');
    expect((await query(`SELECT id FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).rows).toHaveLength(0);
    const explore = asText(await me.page('/foundry/experiments/explore'));
    expect(explore).toContain('the last search closed on');
    expect(explore).toContain('the owner said to stop');
    expect(explore).not.toContain('an answer about the world');
    const buried = (await query(`SELECT verdict_why FROM venture_opportunities WHERE verdict = 'rejected' AND verdict_why LIKE 'the search closing:%'`, [])).rows as unknown as Array<Record<string, unknown>>;
    for (const b of buried) expect(String(b.verdict_why)).toBe('the search closing: the owner said to stop');
  });
});
