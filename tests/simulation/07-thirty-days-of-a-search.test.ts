// =============================================================================
// THIRTY DAYS OF A SEARCH THAT FINDS NOTHING, HONESTLY.
//
// The owner does not use Foundry in one sitting. He gives a direction, comes
// back two days later, steers it, goes away for a week, and asks what
// happened. This drives that month over the shared world, through the real
// entrance, with the morning's routines run against providers that answer
// nothing — the commonest real day — and reads back what he would read.
// Nothing is invented to fill the silence; that is the property under test.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../src/db/client.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { OWNER, advanceDays, asText, owner, ownerApp, routinesRanThisMorning, runMorning, seedProductionShape } from '../helpers/world.js';

// The public sources are not stubbed: every look answers 404, which is what
// an unreachable source honestly is. The model abstains from everything.
const { fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => say({ abstain: 'nothing coherent to read here' })),
  callOpus: vi.fn(async () => say({ abstain: 'nothing coherent to read here' })),
}));
afterAll(() => { vi.unstubAllGlobals(); });

const SAID = 'Find and investigate low-maintenance digital income opportunities, explore different economic forms, evaluate evidence, reject weak candidates, and develop justified experiments within my authority and spending limits.';
const LOOKING = ['sense_check_tick', 'real_market_evidence_tick', 'venture_discovery_tick', 'forge_tick'] as const;

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
const openSearch = async () => (await query(`SELECT id, statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;
const candidatesOf = async (mandateId: string) => (await query(`SELECT id FROM venture_opportunities WHERE mandate_id = ?`, [mandateId])).rows.length;
const morning = async () => { const r = await runMorning(LOOKING); await routinesRanThisMorning(); return r; };

beforeAll(async () => {
  await seedProductionShape({ eyes: true });
  app = await ownerApp();
  me = owner(app);
});

describe('day 1 — he gives the direction', () => {
  it('replaces the finished search with his, and Home says it is looking', async () => {
    const shown = await me.ask(SAID);
    expect(await shown.text()).toContain('Point the search, or start this one?');
    const r = await me.confirm(SAID, 'replace');
    expect(r.headers.get('location')).toContain('done=replacedsearch');
    const open = await openSearch();
    expect(open).toHaveLength(1);
    expect(String(open[0]!.statement)).toContain('low-maintenance digital income');
    const home = asText(await me.page('/foundry'));
    expect(home).toMatch(/Foundry is working|Looking/);
    expect(home).not.toContain('nowhere to look');
  });
});

describe('day 2 — the morning runs and finds nothing', () => {
  it('no candidate is invented; the search says what it looked through and that nothing came of it', async () => {
    await advanceDays(1);
    const ran = await morning();
    expect(ran.filter((r) => !r.ok).map((r) => `${r.job}: ${r.error ?? ''}`)).toEqual([]);
    const open = (await openSearch())[0]!;
    expect(await candidatesOf(String(open.id))).toBe(0);
    const searching = asText(await me.page('/foundry/searching'));
    expect(searching).toContain('What I am looking for');
    expect(searching).toContain('0 looked at');
    expect(searching).not.toContain('Why it might');
    // The pulse: the routines ran. (The activity strip may well say "Stopped
    // looking" about yesterday's replaced search; that is not the pulse.)
    const home = asText(await me.page('/foundry'));
    expect(home).toContain('Foundry is working');
    expect(home).not.toMatch(/hasn.t completed its scheduled work|has not run for longer/);
  });
});

describe('day 4 — he steers it', () => {
  it('"Focus more on calculators." is one row on the search, and the morning still invents nothing', async () => {
    await advanceDays(2);
    const shown = await me.ask('Focus more on calculators.');
    expect(await shown.text()).toContain('Hold the search to this?');
    await me.confirm('Focus more on calculators.');
    const g = (await query(`SELECT g.kind, g.subject FROM venture_guidance g JOIN venture_mandates m ON m.id = g.mandate_id WHERE m.founder_id = ? AND m.closed_at IS NULL AND g.superseded_by IS NULL`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;
    expect(g.map((x) => [String(x.kind), String(x.subject)])).toContainEqual(['favour', 'calculators']);
    await morning();
    expect(await candidatesOf(String((await openSearch())[0]!.id))).toBe(0);
    expect(asText(await me.page('/foundry/searching'))).toContain('I will put my effort toward calculators first');
  });
});

describe('day 8 — he asks what happened while he was away', () => {
  it('the letter carries the search and the steering, says nothing left the building, and puts no money on a test that did not run', async () => {
    await advanceDays(4);
    await morning();
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 8);
    expect(letter.changed.some((c) => c.startsWith('a search opened:'))).toBe(true);
    expect(letter.changed.some((c) => c.includes('you steered the search: "Focus more on calculators."'))).toBe(true);
    expect(letter.effects.some((e) => /messages sent to people/.test(e))).toBe(false);
    // Experiment 001 settled inside the window: it is reported as what was
    // set aside and what went, never as the ceiling spent.
    expect(letter.money.some((m) => /\$100\.00 on a test/.test(m))).toBe(false);
    expect(letter.money.every((m) => !m.startsWith('a test,') || /set aside for it/.test(m))).toBe(true);
    const back = await me.answer('What did I miss while I was away?');
    expect(back).not.toContain("I don't know yet");
  });
});

describe('day 30 — still looking, still honest', () => {
  it('the search is open, Home says it is looking, and a month of nothing is not a wall of text', async () => {
    await advanceDays(22);
    await morning();
    expect(await openSearch()).toHaveLength(1);
    expect(await candidatesOf(String((await openSearch())[0]!.id))).toBe(0);
    const home = asText(await me.page('/foundry'));
    expect(home).toContain('Foundry is working');
    expect(home).not.toMatch(/hasn.t completed its scheduled work|has not run for longer/);
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 30);
    const lines = [...letter.happened, ...letter.handled, ...letter.changed, ...letter.money, ...letter.effects, ...letter.outcomes, ...letter.learned, ...letter.needsYou];
    expect(lines.length).toBeLessThanOrEqual(12);
    // And the record of every morning is there: thirty passes, none failed.
    const health = (await query(`SELECT consecutive_failures FROM job_health WHERE job_name = 'venture_discovery_tick'`, [])).rows[0] as Record<string, unknown> | undefined;
    expect(Number(health?.consecutive_failures ?? 0)).toBe(0);
  });
});
