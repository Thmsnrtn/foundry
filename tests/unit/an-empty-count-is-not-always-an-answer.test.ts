// =============================================================================
// AN EMPTY COUNT IS NOT ALWAYS AN ANSWER.
//
// Half a dozen surfaces say a version of "nothing came back". Each counted its
// own rows and printed its own sentence, and not one of them could ask the
// question that decides what the sentence means: was the path that would have
// carried something working while we were waiting?
//
// Three readings, kept apart on purpose — the path was well throughout
// (nothing came back, and that is a fact about the world); the path was down
// on days of the window (the silence is partly ours); the window has days with
// no reading at all (an honest gap, said once and not turned into an alarm).
//
// The surfaces that draw a conclusion from an empty count read the same one
// function. This is deliberately a SENTENCE and not a card: an institution
// that turned every uncertainty into a warning would teach its owner to ignore
// warnings, which is worse than the thing it was guarding against.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, asText, owner, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  await advanceDays(1);
  await runMorning(HANDS);
  app = await ownerApp();
  me = owner(app);
});

const record = async (channel: string, day: string, status: string, detail: string): Promise<void> => {
  const { recordWorkshopHealth } = await import('../../src/services/public-workshop/settings.js');
  await recordWorkshopHealth(OWNER, { [channel]: { status, detail } }, new Date(day + 'T12:00:00Z'));
};

describe('what silence means, read from the days rather than from now', () => {
  it('a path well on every day of the window adds nothing at all', async () => {
    const { whatSilenceMeans } = await import('../../src/services/venture/the-instrument.js');
    await record('replyInbox', '2030-01-01', 'healthy', 'routing is enabled');
    await record('replyInbox', '2030-01-02', 'healthy', 'routing is enabled');
    const r = await whatSilenceMeans(OWNER, 'replyInbox', new Date('2030-01-01T00:00:00Z'), new Date('2030-01-02T00:00:00Z'), 'a reply');
    expect(r.meaning).toBe('reliable');
    expect(r.sentence, 'nothing to add is nothing to print').toBeNull();
  });

  it('a day nobody watched is an honest gap, not reassurance and not an alarm', async () => {
    const { whatSilenceMeans } = await import('../../src/services/venture/the-instrument.js');
    const r = await whatSilenceMeans(OWNER, 'replyInbox', new Date('2030-01-01T00:00:00Z'), new Date('2030-01-05T00:00:00Z'), 'a reply');
    expect(r.meaning).toBe('unknown');
    expect(r.daysUnwatched).toBe(3);
    expect(r.sentence).toMatch(/no record of whether a reply could have reached me on 3 of those 5 days/);
  });

  it('a path down on days of the window says the silence is not all theirs', async () => {
    const { whatSilenceMeans } = await import('../../src/services/venture/the-instrument.js');
    await record('replyInbox', '2030-01-03', 'needs_attention', 'mail routing is not enabled on the zone');
    await record('replyInbox', '2030-01-04', 'healthy', 'routing is enabled');
    await record('replyInbox', '2030-01-05', 'healthy', 'routing is enabled');
    const r = await whatSilenceMeans(OWNER, 'replyInbox', new Date('2030-01-01T00:00:00Z'), new Date('2030-01-05T00:00:00Z'), 'a reply');
    expect(r.meaning).toBe('broken');
    expect(r.daysBroken).toBe(1);
    expect(r.sentence).toMatch(/On 1 of those 5 days a reply could not have reached me/);
    expect(r.sentence).toMatch(/the silence is not all theirs/);
  });
});

describe('the surfaces that conclude from an empty count read it', () => {
  it('the Inbox says what its silence means, from the days and not from this moment', async () => {
    // The route failed for a day in the middle of the window and came back.
    // Right now it is fine, and an inbox that looks exactly like an inbox
    // nobody wrote to is not the same inbox.
    const first = (await query(
      `SELECT date(MIN(o.executed_at)) AS day FROM outbound_actions o
        WHERE o.experiment_act = 'offer' AND o.status = 'executed'`, []))
      .rows[0] as Record<string, unknown>;
    await record('replyInbox', String(first.day), 'needs_attention', 'mail routing is not enabled on the zone');
    const inbox = asText(await me.page('/foundry/inbox'));
    expect(inbox).toMatch(/messages have gone out under your tests, each inviting a reply/);
    // Whatever the reply path is doing right now, the page has something to
    // say about the days the test was actually asking.
    expect(inbox).toMatch(/could not have reached me|no record of whether a reply could have reached me/);
  });

  it('the answer to "has anybody paid" does not read an empty count as a fact about buyers', async () => {
    // The door takes the sentence and answers on Home, which is where the
    // owner is looking when he asks.
    await me.post('/foundry/ask', { said: 'Has anybody paid yet?' });
    const answer = asText(await me.page('/foundry?q=' + encodeURIComponent('Has anybody paid yet?')));
    expect(answer).toContain('Nobody has paid for anything yet.');
    expect(answer).toMatch(/no record of whether a payment could have reached me|a payment could not have reached me/);
  });

  it('a search that has looked at nothing does not call an empty shelf an answer', async () => {
    // WHAT IS ASSERTED AND WHY IT IS ASSERTED HERE. The seeded world's search
    // has already examined something and already holds a candidate, so
    // neither empty-shelf branch renders in it, and staging one would mean
    // deleting rows the schema's own foreign keys protect. What can be held
    // to is the claim itself: the page no longer contains a sentence calling
    // an empty shelf a real answer without saying how much was looked at.
    const source = readFileSync(resolve(__dirname, '../../src/routes/dashboard/places.ts'), 'utf8');
    expect(source, 'an empty shelf is an answer about the world only when something was looked at')
      .not.toMatch(/None yet\. Bringing you none is a real answer/);
    expect(source).toMatch(/nothing has been looked at yet, so that is not an\s*\n?\s*answer about the world/);
    expect(source).toMatch(/out of \$\{String\(progress\.looked\)\} looked at\. Bringing you none is a real answer/);
    // And the page still renders, with the count it has.
    const searching = asText(await me.page('/foundry/searching'));
    expect(searching).toMatch(/looked at/);
  });
});
