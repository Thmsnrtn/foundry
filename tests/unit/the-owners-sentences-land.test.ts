// =============================================================================
// THE OWNER'S SENTENCES LAND.
//
// Six sentences a person says to the institution, traced through the real
// front door: "Is anything making money yet?" reached the permissions answer
// because the word "money" sits in that rule; "I don't like this direction",
// "Look more closely at calculators" and "Clear the messages I've already
// dealt with" came back "I did not follow that"; "Find something with less
// legal exposure" was a steer with a search open and nothing without one;
// "Show me what you've found" was answered with "I don't know". Each now
// lands where it belongs, with a search open and with none, and the one act
// among them — housekeeping — is confirmed with its count and reversible.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';
import { whichDoor } from '../../src/services/institution/the-door.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
const NOT_FOLLOWED = 'I did not follow that';

const hear = async (rfc: string, subject: string, body: string) => {
  const { hearMail } = await import('../../src/services/public-workshop/mail.js');
  return hearMail({ founderId: OWNER, to: 'thomas@apexmicro.ai', from: `${rfc}@example.com`, fromName: 'A shop',
    subject, body, rfcMessageId: `<${rfc}@example.com>`, spf: 'pass', dkim: 'pass', dmarc: 'pass', size: 120 });
};

beforeAll(async () => {
  await seedProductionShape({ searching: true, eyes: true });
  app = await ownerApp();
  me = owner(app);
  const mail = await import('../../src/services/public-workshop/mail.js');
  await mail.openTheEars(OWNER);
  await hear('one', 'Re: A shortlist of open Massachusetts public bids', 'Thanks, this looks useful.');
  await hear('two', 'Re: A shortlist of open Massachusetts public bids', 'Got it, thank you.');
  await hear('three', 'A question about the brief', 'Can you tell me more about how the bids are chosen?');
  const threads = await mail.theThreads(OWNER, 'working');
  for (const t of threads.filter((x) => /one|two/.test(x.key) || /Thanks|Got it/.test(x.newest.body))) {
    await mail.settleThread({ founderId: OWNER, threadKey: t.key, because: 'the owner dealt with it' });
  }
});

describe('the door places each sentence', () => {
  it('classifies the six with a search open, none of them unplaceable', () => {
    const open = { searching: true };
    expect(whichDoor('Is anything making money yet?', open).destination).toBe('question');
    expect(whichDoor("I don't like this direction.", open).destination).toBe('venture');
    expect(whichDoor('Find something with less legal exposure.', open).destination).toBe('venture');
    expect(whichDoor("Show me what you've found.", open).destination).toBe('question');
    expect(whichDoor('Look more closely at calculators.', open).destination).toBe('venture');
    expect(whichDoor("Clear the messages I've already dealt with.", open).destination).toBe('housekeeping');
  });

  it('with no search open, a steering sentence that asks to look is a direction; housekeeping does not depend on a search', () => {
    const none = { searching: false };
    expect(whichDoor('Find something with less legal exposure.', none).destination).toBe('venture');
    expect(whichDoor("I don't like this direction.", none).destination).not.toBe('unplaceable');
    expect(whichDoor("Clear the messages I've already dealt with.", none).destination).toBe('housekeeping');
    expect(whichDoor('Archive everything I have handled.', none).destination).toBe('housekeeping');
    expect(whichDoor('Tidy up the inbox.', none).destination).toBe('housekeeping');
    // Not housekeeping: a hold on sending, and an unrelated "clear".
    expect(whichDoor("Don't send anything to anyone.", none).destination).toBe('authority');
    expect(whichDoor('Clear the decks and find me a new business.', none).destination).toBe('venture');
  });
});

describe('with a search open', () => {
  it('"Is anything making money yet?" is answered from the world\'s rows, not from permissions', async () => {
    const t = asText(await me.answer('Is anything making money yet?'));
    expect(t).toContain('Nobody has paid for anything yet.');
    expect(t).toContain('settled surprised');
    expect(t).not.toContain('what I am allowed to do');
    expect(t).not.toContain('No charter is signed');
    for (const q of ['Has anyone bought anything?', 'Are we making any money?', 'Any sales yet?']) {
      expect(asText(await me.answer(q))).toContain('Nobody has paid for anything yet.');
    }
  });

  it('"Show me what you\'ve found." names the search and what stands', async () => {
    const t = asText(await me.answer("Show me what you've found."));
    expect(t).toContain('1 candidate stands.');
    expect(t).toContain('Looking for: Find out whether small Massachusetts trade businesses');
    expect(t).toContain('A filtered brief of public bid notices');
    expect(t).toContain('Explore');
    expect(t).not.toContain(NOT_FOLLOWED);
    expect(asText(await me.answer('What have you found so far?'))).toContain('Looking for:');
  });

  it('"I don\'t like this direction." offers to steer away, or to stop', async () => {
    const r = await me.ask("I don't like this direction.");
    expect(r.status).toBe(200);
    const t = asText(await r.text());
    expect(t).toContain('Change course?');
    expect(t).toContain('a different kind of candidate');
    expect(t).toContain('The search now:');
    expect(t).toContain('Standing candidates I would pass over: A filtered brief of public bid notices');
    expect(t).toContain('Stop looking instead');
    expect(t).not.toContain(NOT_FOLLOWED);
  });

  it('"Find something with less legal exposure." and "Look more closely at calculators." steer the open search', async () => {
    const legal = asText(await (await me.ask('Find something with less legal exposure.')).text());
    expect(legal).toContain('Hold the search to this?');
    expect(legal).toContain('low legal exposure');
    const closer = asText(await (await me.ask('Look more closely at calculators.')).text());
    expect(closer).toContain('Hold the search to this?');
    expect(closer).toContain('calculators');
    await me.confirm('Look more closely at calculators.');
    const { currentMandate } = await import('../../src/services/venture/mandate.js');
    const m = (await currentMandate(OWNER))!;
    expect(m.guidance.some((g) => g.kind === 'favour' && /calculators/.test(g.subject ?? ''))).toBe(true);
  });

  it('"Clear the messages I\'ve already dealt with." is confirmed with the count, performed, and reversible', async () => {
    const mail = await import('../../src/services/public-workshop/mail.js');
    const before = await mail.threadCounts(OWNER);
    expect(before.handled).toBe(2);
    expect(before.working).toBe(1);
    const r = await me.ask("Clear the messages I've already dealt with.");
    expect(r.status).toBe(200);
    const raw = await r.text();
    const t = asText(raw);
    expect(t).toContain('Put away 2 conversations?');
    expect(t).toContain('Nothing is deleted');
    expect(raw).toContain('action="/foundry/inbox/clear-handled"');
    expect(t).not.toContain(NOT_FOLLOWED);
    // Nothing moved on the confirmation alone.
    expect((await mail.threadCounts(OWNER)).handled).toBe(2);

    const did = await me.post('/foundry/inbox/clear-handled', { because: 'you cleared what you had dealt with' });
    expect(did.status).toBe(302);
    expect(String(did.headers.get('location'))).toBe('/foundry/inbox?done=cleared&n=2');
    const after = await mail.threadCounts(OWNER);
    expect(after.handled).toBe(0);
    expect(after.archived).toBe(2);
    expect(after.working).toBe(1); // what still needs him did not move
    const inbox = asText(await me.page('/foundry/inbox?done=cleared&n=2'));
    expect(inbox).toContain('Put away. 2 conversations you had dealt with');
    const putAway = await mail.theThreads(OWNER, 'archived');
    expect(putAway.every((x) => x.newest.archivedBecause === 'you cleared what you had dealt with')).toBe(true);

    // Reversible: put one back.
    await mail.unarchiveThread({ founderId: OWNER, threadKey: putAway[0]!.key });
    const back = await mail.threadCounts(OWNER);
    expect(back.archived).toBe(1);
    expect(back.handled).toBe(1);

    // Asked again with nothing left: says so, moves nothing.
    await mail.archiveThread({ founderId: OWNER, threadKey: putAway[0]!.key, because: 'again' });
    const again = asText(await (await me.ask('Clear the messages I have dealt with.')).text());
    expect(again).toContain('Nothing to put away');
  });
});

describe('with no search open', () => {
  beforeAll(async () => {
    await me.confirm('Stop looking.');
    const { currentMandate } = await import('../../src/services/venture/mandate.js');
    expect(await currentMandate(OWNER)).toBeNull();
  });

  it('"I don\'t like this direction." and "Show me what you\'ve found." say nothing is being looked for, and how to give a direction', async () => {
    const dislike = asText(await (await me.ask("I don't like this direction.")).text());
    expect(dislike).toContain('Nothing is being looked for');
    expect(dislike).toContain('no direction to dislike yet');
    expect(dislike).not.toContain(NOT_FOLLOWED);
    const found = asText(await me.answer("Show me what you've found."));
    expect(found).toContain('Nothing is being looked for');
    expect(found).toContain('Explore');
  });

  it('"Find something with less legal exposure." opens a search held to that constraint, after he confirms', async () => {
    const r = await me.ask('Find something with less legal exposure.');
    expect(r.status).toBe(200);
    const t = asText(await r.text());
    expect(t).toContain('Go and look, holding it to this?');
    expect(t).toContain('low legal exposure');
    expect(t).not.toContain(NOT_FOLLOWED);
    const { currentMandate } = await import('../../src/services/venture/mandate.js');
    expect(await currentMandate(OWNER)).toBeNull(); // nothing opened on the preview
    const did = await me.confirm('Find something with less legal exposure.');
    expect(did.status).toBe(302);
    const m = await currentMandate(OWNER);
    expect(m).not.toBeNull();
    expect(m!.statement).toBe('Find something with less legal exposure.');
    expect(m!.guidance.some((g) => g.dimension === 'legal_exposure')).toBe(true);
  });

  it('"Is anything making money yet?" still answers from the rows with nothing running', async () => {
    const t = asText(await me.answer('Is anything making money yet?'));
    expect(t).toContain('Nobody has paid for anything yet.');
    expect(t).toContain('Nothing is running now');
  });
});
