// =============================================================================
// WHAT REACHES THE ONE THING, AND WHAT THE DAY REQUIRED
//
// Three readings this file holds to, each a gap a reviewer found by using the
// product rather than by reading it:
//
//   1. A TEST THE WORLD SETTLED WHILE HE WAS AWAY asks nothing of him, which
//      is exactly why it never reached the first screen: it stood behind every
//      act and every ask. A result nobody reads is a test nobody learns from,
//      so it is the one thing once, until he has seen it.
//   2. HEALTH IS ABOUT THE DAY, NOT ABOUT WHETHER A JOB RETURNED. A morning
//      that ran and observed nothing while a search stood open did what it
//      was told and not what the day required; "Healthy" was a lie of
//      omission, and it now says what is waiting and why.
//   3. ONE WORD FOR ONE PLACE. The same door was Discover in the rail and
//      Searching in the crumbs; the same reading was Estate on Home and
//      Health on Controls.
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
  ({ experimentId: X } = await seedProductionShape({ searching: true }));
  app = await ownerApp();
  me = owner(app);
});

describe('a test the world settled reaches the one thing, once', () => {
  it('is the first thing on Home, says what it established and what it does not, and asks nothing', async () => {
    // He has never looked: the first visit has no "since", so nothing is new.
    const first = asText(await me.page('/foundry'));
    expect(first).not.toContain('The world answered.');
    // He looked before the world settled it, and comes back after: the marker
    // he left moves back, which is the same fact from the other side.
    await query(`UPDATE owner_visits SET looked_at = datetime(?, '-1 minutes'), since = datetime(?, '-1 minutes') WHERE founder_id = ?`,
      [String(((await query('SELECT ran_at FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>).ran_at),
        String(((await query('SELECT ran_at FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>).ran_at), OWNER]);
    const home = asText(await me.page('/foundry'));
    expect(home).toContain('The world answered.');
    expect(home).toContain('Surprised');
    expect(home).toContain('Nothing is asked of you here');
    expect(home).toContain('What it establishes');
    expect(home).toContain('Read what happened');
  });

  it('and stops being the one thing once his marker is past it: a result is shown until it is seen, not forever', async () => {
    // A VISIT IS A SESSION, NOT A PAGE LOAD (what-changed.ts): the marker moves
    // when he has been away long enough for coming back to mean something. Once
    // it is past the settlement, the world's answer is history he can go and
    // read, not the thing his screen is for.
    await query(`UPDATE owner_visits SET looked_at = datetime('now'), since = datetime('now') WHERE founder_id = ?`, [OWNER]);
    const seen = asText(await me.page('/foundry'));
    expect(seen).not.toContain('The world answered.');
    expect(seen).toContain('Last test');
  });

  it('the reading itself names it, so every surface that asks what needs him gets the same answer', async () => {
    const { whatNeedsHim } = await import('../../src/routes/dashboard/foundry-shell.js');
    const settled = { experimentId: X, title: 'the brief', outcome: { word: 'surprised', label: 'Surprised', meaning: 'm', reason: 'r', establishes: 'e', doesNotEstablish: 'd', when: '2026-09-15', settled: true, concluded: true } };
    const state = { asked: [], owed: [], obligations: [], acquisitions: [], routinesFailing: [], checks: [], record: 'no rate yet',
      charter: { live: false, workshop: null, readyTests: 0, sealedDesigns: 0 }, settledSinceHeLooked: settled } as never;
    const a = whatNeedsHim(state);
    expect(a?.kind).toBe('read_the_result');
    // AND IT NEVER DISPLACES SOMETHING THAT NEEDS HIM. A result asks nothing;
    // an act he must answer is the screen's whole purpose, and the settled
    // test waits beneath it until the queue is clear.
    const withAnAct = { ...(state as object), asked: [{ id: 'a1', tier: 'obligation', productId: 'p', companyName: 'c', summary: 's', why: 'w', rung: 'legal', rungMeans: null, puttingItBack: null, costCents: 0, expiresAt: '2026-10-01', absorbable: null }] } as never;
    expect(whatNeedsHim(withAnAct)?.kind).toBe('spend');
  });
});

describe('health is about the day, not about whether a job returned', () => {
  it('a morning that observed nothing while a search is open is waiting, with the reason', async () => {
    // The search has been open since before this morning: a search opened
    // minutes ago has not had a morning yet, and is not owed one. The mandate
    // row is immutable by its own guard, so the day moves instead, as the
    // laboratory moves days everywhere else.
    const { advanceDays } = await import('../helpers/world.js');
    expect((await advanceDays(2)).refused).toEqual([]);
    const { healthOf } = await import('../../src/services/founder/health.js');
    const h = await healthOf(OWNER);
    expect(h.state).not.toBe('ok');
    expect(h.failed.join(' ')).toContain('a search is open and nothing was looked at today');
    expect(asText(await me.page('/foundry/controls'))).toContain('nothing was looked at today');
  });

  it('once the morning has looked, the day is done and health says so', async () => {
    await query(
      `INSERT INTO market_retrievals (id, founder_id, source_type, source, terms, returned_count, examined_count, relevant_count,
                                      can_see, cannot_see, would_most_help, retrieved_at, evidence_mode)
       VALUES ('mr_day', ?, ?, 'https://example.test', 'millwork', 3, 3, 0,
               'what the notices say', 'who answered them', 'the buyers behind them', datetime('now'), 'real')`,
      [OWNER, String(((await query('SELECT source_type FROM market_source_types LIMIT 1', [])).rows[0] as Record<string, unknown>).source_type)]);
    const { healthOf } = await import('../../src/services/founder/health.js');
    const h = await healthOf(OWNER);
    expect(h.failed.join(' ')).not.toContain('nothing was looked at today');
  });
});

describe('one word for one place', () => {
  it('the rail, the More sheet and the crumbs all say Searching, and Home says Health', async () => {
    const home = await me.page('/foundry');
    expect(home).not.toContain('>Discover<');
    expect(asText(home)).toContain('Searching');
    const searching = await me.page('/foundry/searching');
    expect(asText(searching)).toContain('Searching');
    expect(searching).not.toContain('>Discover<');
    // Estate was Home's word for what Controls calls Health.
    expect(asText(home)).not.toContain('Estate');
    expect(asText(home)).toContain('Health');
    expect(asText(await me.page('/foundry/controls'))).toContain('Health');
  });

  it('the vocabulary is the one table, and every place in it has a name and an address', async () => {
    const { LABELS, ADDRESSES } = await import('../../src/views/owner/labels.js');
    for (const [place, label] of Object.entries(LABELS)) {
      expect(label, place).toMatch(/^[A-Z]/);
      expect(ADDRESSES[place as keyof typeof ADDRESSES], place).toMatch(/^\//);
    }
    expect(LABELS.discover).toBe('Searching');
  });
});

// =============================================================================
// A SUMMARY READS THE LIST IT SUMMARISES.
//
// Two convergence reviewers found this independently, by using the product:
// "Nothing needs a decision from you" was printed six inches above "Needs you
// 1", and the Ask box answered "What needs me?" with "Nothing. I will tell you
// the moment that changes." The calm sentences were computed from the one-thing
// reader, which has no branch for some of the kinds the queue holds.
// =============================================================================
describe('nothing is never said above a queue with something in it', () => {
  it('the one thing points at the list when it cannot put one decision in front of him', async () => {
    const { whatNeedsHim } = await import('../../src/routes/dashboard/foundry-shell.js');
    const bare = { asked: [], owed: [], obligations: [], acquisitions: [], routinesFailing: [], checks: [],
      record: 'no rate yet', elsewhere: [], grantable: [], permissions: [], candidates: [], expecting: [],
      pendingCandidates: [], responsibilities: [], watching: { real: 0, invented: 0, itself: false },
      charter: { live: false, workshop: null, readyTests: 0, sealedDesigns: 0 },
      settledSinceHeLooked: null, queued: 0 } as never;
    expect(whatNeedsHim(bare)).toBeNull();
    const withQueue = { ...(bare as object), queued: 2 } as never;
    const a = whatNeedsHim(withQueue);
    expect(a).toMatchObject({ kind: 'queued', n: 2 });
    // LAST OF ALL: anything that can be one decision outranks a pointer at a list.
    const withAnAct = { ...(withQueue as object), asked: [{ id: 'a1', tier: 'external', productId: 'p', companyName: 'c', summary: 's', why: 'w', rung: 'financial', rungMeans: null, puttingItBack: null, costCents: 100, expiresAt: '2026-10-01', absorbable: null }] } as never;
    expect(whatNeedsHim(withAnAct)?.kind).toBe('spend');
  });

  it('the screen and the Ask answer agree with the count beside them', async () => {
    const home = asText(await me.page('/foundry'));
    const waiting = /Needs you (\d+)/.exec(home);
    if (waiting && Number(waiting[1]) > 0) {
      expect(home).not.toContain('Nothing needs a decision from you');
      expect(home).not.toContain('Everything is fine. Nothing needs you.');
      const said = asText(await me.answer('what needs me'));
      expect(said).not.toContain('Nothing. I will tell you the moment that changes');
    }
  });
});
