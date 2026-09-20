// =============================================================================
// THE WORKING SET STAYS TRUE.
//
// An object's end was written on one row and read by nothing else. A closed
// search left its candidates standing on Explore and in its count while
// Discover said "I am not looking for anything"; a design nobody had decided
// kept asking to be decided; the owner's own stop was the one thing Activity
// could not show; a thread he put away came back on a new reply with no
// trace it had been put away. Each is proven here from the real entrance,
// over the shared world.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let candidateId = '';
let designId = '';
const rows = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows as unknown as Array<Record<string, unknown>>;
const exploreCount = async () => {
  const { shelfCandidates } = await import('../../src/services/venture/shelves.js');
  return (await shelfCandidates(OWNER)).reduce((n, sh) => n + sh.candidates.length, 0);
};
const needsHim = async () => {
  const { waitingOn: whatNeedsHim } = await import("../../src/services/founder/attention.js");
  return (await whatNeedsHim(OWNER)).map((a) => String(a.id));
};

beforeAll(async () => {
  await seedProductionShape({ searching: true, eyes: true });
  app = await ownerApp();
  me = owner(app);
  // The open search (Experiment 001's) has one candidate still open; design a
  // test under it that nobody has decided.
  const open = (await rows(`SELECT id FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER]))[0]!;
  candidateId = String((await rows(`SELECT id FROM venture_opportunities WHERE mandate_id = ? AND verdict IS NULL LIMIT 1`, [String(open.id)]))[0]!.id);
  // Experiment 001 answered the candidate's first unknown; a new design needs an open one.
  const { raiseUnknown } = await import('../../src/services/venture/market-evidence.js');
  const unknownId = await raiseUnknown({ founderId: OWNER, opportunityId: candidateId, blocking: true,
    question: 'Would a second cohort of shops buy at the same price?', cheapestTest: 'offer it to twenty more' });
  const { designExperiment } = await import('../../src/services/venture/validation.js');
  designId = await designExperiment({
    founderId: OWNER, opportunityId: candidateId, unknownId,
    whatWeDo: 'offering the brief to the next twenty shops', whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays',
    costCents: 2500, evidenceMode: 'real' });
});

describe('a closed search takes its debris with it', () => {
  it('before: the candidate stands on Explore and the design is undecided', async () => {
    expect(await exploreCount()).toBe(1);
    const d = (await rows(`SELECT decision, retired_at FROM venture_experiments WHERE id = ?`, [designId]))[0]!;
    expect(d.decision).toBeNull();
    expect(d.retired_at).toBeNull();
  });

  it('"Stop looking." closes the search, buries its candidate with a way back, retires the undecided design', async () => {
    const shown = await me.ask('Stop looking.');
    expect(await shown.text()).toContain('Stop looking?');
    const r = await me.confirm('Stop looking.');
    expect(r.headers.get('location')).toContain('searchstopped');

    const c = (await rows(`SELECT verdict, verdict_why, revisit_if FROM venture_opportunities WHERE id = ?`, [candidateId]))[0]!;
    expect(String(c.verdict)).toBe('rejected');
    expect(String(c.verdict_why)).toBe('the search closing: the owner said to stop');
    expect(String(c.revisit_if)).toContain('a search opens that this fits');
    const d = (await rows(`SELECT retired_at, retired_because FROM venture_experiments WHERE id = ?`, [designId]))[0]!;
    expect(d.retired_at).not.toBeNull();
    expect(String(d.retired_because)).toContain('its search was closed');
  });

  it('after: Explore, the attention queue, Discover and Activity all agree', async () => {
    expect(await exploreCount()).toBe(0);
    expect(await needsHim()).not.toContain(designId);
    const searching = asText(await me.page('/foundry/searching'));
    expect(searching).toContain('I am not looking for anything');
    const activity = asText(await me.page('/foundry/activity'));
    expect(activity).toContain('Stopped looking:');
    expect(activity).toContain('Started looking:');
    const now = asText(await me.page('/foundry/experiments'));
    expect(now).not.toContain('offering the brief to the next twenty shops');
  });
});

describe('replacing a search is on the record', () => {
  it('a new direction opens a search; a second one, chosen to replace it, closes the first with his reason', async () => {
    await me.confirm('Find low-maintenance digital income.');
    expect((await rows(`SELECT statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).map((m) => String(m.statement)))
      .toEqual(['Find low-maintenance digital income.']);
    const shown = await me.ask('Explore API opportunities.');
    expect(await shown.text()).toContain('Point the search, or start this one?');
    await me.confirm('Explore API opportunities.', 'replace');
    const open = await rows(`SELECT statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER]);
    expect(open.map((m) => String(m.statement))).toEqual(['Explore API opportunities.']);
    const activity = asText(await me.page('/foundry/activity'));
    expect(activity).toContain('Started looking: Explore API opportunities.');
    expect(activity).toContain('Stopped looking: Find low-maintenance digital income.');
    expect(activity).toContain('the owner gave a new direction');
    // And steering shows too.
    await me.confirm('Focus more on calculators.');
    expect(asText(await me.page('/foundry/activity?kind=search'))).toContain('Steered the search: Focus more on calculators.');
  });
});

describe('a thread he put away that a reply reopened says so', () => {
  it('the newest message brings the thread back into flight, and the row says when he put it away', async () => {
    const { archiveThread, hearMail, openTheEars, theThreads } = await import('../../src/services/public-workshop/mail.js');
    await openTheEars(OWNER);
    const first = await hearMail({ founderId: OWNER, to: 'thomas@apexmicro.ai', from: 'shop@example.com', fromName: 'A shop',
      subject: 'Re: A shortlist of open Massachusetts public bids', body: 'Thanks, this looks useful.', rfcMessageId: '<m1@example.com>' });
    expect(first.duplicate).toBe(false);
    const thread = (await theThreads(OWNER, 'working'))[0]!;
    await archiveThread({ founderId: OWNER, threadKey: thread.key, because: 'dealt with' });
    expect((await theThreads(OWNER, 'working')).some((t) => t.key === thread.key)).toBe(false);

    await hearMail({ founderId: OWNER, to: 'thomas@apexmicro.ai', from: 'shop@example.com', fromName: 'A shop',
      subject: 'Re: A shortlist of open Massachusetts public bids', body: 'Actually, one more question.', rfcMessageId: '<m2@example.com>', inReplyTo: '<m1@example.com>' });
    const back = (await theThreads(OWNER, 'working')).find((t) => t.key === thread.key);
    expect(back).toBeDefined();
    expect(back!.putAwayAt).not.toBeNull();
    expect(back!.putAwayBecause).toBe('dealt with');
    const inbox = asText(await me.page('/foundry/inbox'));
    expect(inbox).toContain('Reopened: you put this away');
    expect(inbox).toContain('a newer message brought it back');
  });
});
