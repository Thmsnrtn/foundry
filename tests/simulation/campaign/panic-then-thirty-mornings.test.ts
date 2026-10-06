// =============================================================================
// PANIC, THEN THIRTY MORNINGS — does Stop everything stop everything?
//
// A test is allowed under a charter with Experiment 001's cohort of twenty-one
// approved businesses (seeded as `world.ts` seeds it for 'the world'); one
// morning proves the hand writes (the first stage of five). Then the question
// the button cannot answer by itself: what happens to a hand that is already
// writing when Stop lands — caught on the morning stage two (twelve) is due.
// Then the owner presses Stop over HTTP — the same `POST /autopilot/panic` the
// button posts, through `stopEverything` — and the hands run every morning for
// thirty days with businesses still unwritten. Nothing may leave. Then he
// resumes, and the record has to say what that resumed.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/db/client.js';
import { providerStubs } from '../../helpers/provider-stubs.js';
import { HANDS, OWNER, advanceDays, asText, giveTheWorkshopEars, outreachOnly, owner, ownerApp, routinesRanThisMorning, runMorning, seedProductionShape } from '../../helpers/world.js';
import { recordFinding } from './campaign-helpers.js';

const { state, fetch: stubFetch } = providerStubs();
// A gate on the provider: when set, the next send waits here until released,
// which is how a hand is caught mid-flight on purpose rather than by luck.
let gate: Promise<void> | null = null;
vi.stubGlobal('fetch', (async (url: string | URL, init?: RequestInit) => {
  if (gate && String(url) === 'https://api.resend.com/emails') { const g = gate; gate = null; await g; }
  return stubFetch(url, init);
}) as typeof fetch);
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => say({ abstain: 'nothing to read' })),
  callOpus: vi.fn(async () => say({ abstain: 'nothing to read' })),
}));
afterAll(() => { vi.unstubAllGlobals(); });

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;
const morning = async () => { const r = await runMorning(HANDS); await routinesRanThisMorning(); return r; };
const executed = async () => Number((await one(`SELECT COUNT(*) AS n FROM outbound_actions WHERE experiment_id = ? AND status = 'executed'`, [X])).n);
const unwritten = async () => Number((await one(
  `SELECT COUNT(*) AS n FROM experiment_recipients r WHERE r.experiment_id = ? AND r.review_status = 'approved'
     AND r.id NOT IN (SELECT recipient_id FROM outbound_actions WHERE experiment_id = ? AND recipient_id IS NOT NULL)`, [X, X])).n);
const sentToPeople = () => outreachOnly(state.sends).length;
const form = (body: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
const markDelivered = () => { for (const s of state.sends) state.deliveryState.set(s.id, 'delivered'); };
const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

beforeAll(async () => {
  ({ experimentId: X } = await seedProductionShape({ unsettled: true, undecided: true, charter: true }));
  app = await ownerApp();
  me = owner(app);
  state.domains.push({ id: 'dom_w', name: 'apexmicro.ai', status: 'verified', records: [] });
  // THE COHORT OF TWENTY-ONE, exactly as `settledByTheWorld` in tests/helpers/world.ts assembles it.
  const { applyProof1Cohort, amendProof1ForTheCohort } = await import('../../../src/services/venture/proof-1-cohort.js');
  const cohort = await applyProof1Cohort(OWNER);
  const { approveRemaining, recordMaterial, materialOf, recipientsOf, reviewRecipient, allowExperiment } = await import('../../../src/services/venture/hand.js');
  for (const sh of cohort.shadowed.filter((x) => x.instead === null)) {
    const row = (await recipientsOf(X)).find((r) => r.counterpartyRef === sh.who);
    if (row) await reviewRecipient({ founderId: OWNER, experimentId: X, recipientId: row.id, decision: 'approved', email: sh.has, reason: 'the address the cohort chose, supplied by hand' });
  }
  await amendProof1ForTheCohort(OWNER);
  await approveRemaining({ founderId: OWNER, experimentId: X });
  for (const r of (await recipientsOf(X)).filter((x) => x.reviewStatus === 'approved' && !x.qualifiedAt)) {
    await reviewRecipient({ founderId: OWNER, experimentId: X, recipientId: r.id, decision: 'struck', reason: 'no recorded grounds put it in this population' });
  }
  const brief = (await materialOf(X, 'deliverable'))!;
  await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'deliverable', title: brief.title, body: brief.body, pulledAt: new Date(Date.now() - 86_400_000), by: 'the world' });
  const { standUpWorkshop } = await import('../../../src/services/public-workshop/infrastructure.js');
  await standUpWorkshop(OWNER, stubFetch as unknown as typeof fetch);
  await giveTheWorkshopEars(OWNER);
  await allowExperiment({ founderId: OWNER, experimentId: X });
}, 120_000);

describe('day 2 — something would send', () => {
  it('the first stage goes out through the provider: five offers executed, sixteen approved businesses still unwritten', async () => {
    expect(await unwritten()).toBe(21);
    await advanceDays(1);
    const ran = await morning();
    expect(ran.filter((r) => !r.ok).map((r) => `${r.job}: ${r.error ?? ''}`)).toEqual([]);
    expect(sentToPeople()).toBe(5);
    expect(await executed()).toBe(5);
    expect(await unwritten()).toBe(16);
    markDelivered();
  });
});

describe('day 3 — Stop lands while the hand is writing stage two', () => {
  it('a tick already at the provider when Stop lands — how much more leaves', async () => {
    await advanceDays(1);
    // The morning's order: the Workshop republishes what changed before the hand
    // writes (the hand refuses a stale page: `publication_gate`). Then the hand.
    await runMorning(['public_workshop_tick']);
    const before = sentToPeople();
    expect(await unwritten()).toBe(16);
    let release!: () => void;
    gate = new Promise<void>((r) => { release = r; });
    const { JOB_REGISTRY } = await import('../../../src/jobs/index.js');
    const tick = JOB_REGISTRY['experiment_hand_tick']!.fn();
    try {
      for (let i = 0; i < 400 && gate !== null; i++) await new Promise((r) => setTimeout(r, 25));
      if (gate !== null) { gate = null; await tick; throw new Error(`the hand never reached the provider on day 3 (sent ${String(sentToPeople() - before)})`); }
      const { stopEverything } = await import('../../../src/services/control/stop.js');
      const stopped = await stopEverything(OWNER);
      expect(stopped.outreachPaused).toBe(true);
      const atStop = sentToPeople();
      const executedAtStop = await executed();
      release();
      await tick;
      const afterStop = sentToPeople() - atStop;
      const left = await unwritten();
      process.stdout.write(`mid-flight: ${String(before)} before, ${String(atStop)} at Stop, ${String(afterStop)} more after Stop; ${String(left)} of 16 still unwritten\n`);
      if (afterStop > 1) {
        recordFinding({ id: 'F-PANIC-1', sev: 'P1', area: 'venture/hand',
          title: 'a hand already writing when Stop lands finishes its stage',
          evidence: `experiment_hand_tick was held at its first provider call of a twelve-offer stage; stopEverything completed (outreachPaused=true); released, the tick sent ${String(afterStop)} more offers, ${String(left)} of 16 left unwritten.` });
      }
      // THE ONE MESSAGE ALREADY HANDED TO THE PROVIDER CANNOT BE UNSENT; nothing
      // after it may go. The hand re-reads the pause before each offer (its
      // publication gate), so the stage stops at the second.
      expect(afterStop).toBeLessThanOrEqual(1);
      expect(await executed()).toBe(executedAtStop + afterStop);
      expect(left).toBe(16 - afterStop);
    } finally {
      gate = null;
      await tick.catch(() => undefined);
      // The service-level stop is lifted where it lives, so the owner's own Stop below is the one under test.
      const { resumeEconomicActivity } = await import('../../../src/services/public-workshop/settings.js');
      await resumeEconomicActivity(OWNER);
      markDelivered();
    }
  }, 60_000);
});

describe('day 4 — the owner presses Stop everything', () => {
  it('POST /autopilot/panic stops the estate and sends him to Controls saying so, with businesses still unwritten', async () => {
    await advanceDays(1);
    const r = await app.request('/autopilot/panic', form({ _csrf: 'world', return_to: 'foundry' }));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^\/foundry\/controls\?done=stopped_all&companies=\d+&missions=\d+&outreach=1$/);
    const w = await one('SELECT economic_pause_at, economic_pause_by, economic_pause_reason FROM public_workshop WHERE founder_id = ?', [OWNER]);
    expect(w.economic_pause_at).not.toBeNull();
    expect(String(w.economic_pause_by)).toBe(`founder:${OWNER}`);
    expect(String(w.economic_pause_reason)).toBe('the owner pressed Stop everything');
    expect(await unwritten()).toBeGreaterThan(0);
  });
});

describe('thirty mornings, stopped', () => {
  let stoppedAt = '';
  it('nothing is dispatched for thirty days, while approved businesses remain unwritten and the test is live for part of it', async () => {
    const executedAtStop = await executed();
    const sentAtStop = sentToPeople();
    const unwrittenAtStop = await unwritten();
    stoppedAt = new Date().toISOString();
    let liveMornings = 0;
    for (let day = 0; day < 30; day++) {
      await advanceDays(1);
      if ((await one('SELECT ran_at FROM venture_experiments WHERE id = ?', [X])).ran_at == null) liveMornings += 1;
      await morning();
    }
    expect(liveMornings).toBeGreaterThan(0);
    expect(sentToPeople()).toBe(sentAtStop);
    expect(await executed()).toBe(executedAtStop);
    expect(await unwritten()).toBe(unwrittenAtStop);
    const settled = await one('SELECT ran_at, verdict FROM venture_experiments WHERE id = ?', [X]);
    process.stdout.write(`stopped: ${String(liveMornings)} of 30 mornings had the test live with ${String(unwrittenAtStop)} unwritten; it ${settled.ran_at ? `settled ${String(settled.verdict)} during the stop` : 'is still open'}\n`);
  }, 300_000);

  it('while stopped, the reason, who pressed it and since when are held on the Workshop row', async () => {
    // Re-aimed 2026-10-06 (independent audit): the hand refuses before it
    // reaches the gateway, so there are no kill_switch rows by design; the
    // durable record of a pause in progress is public_workshop.economic_pause_*.
    const w = await one('SELECT economic_pause_at, economic_pause_reason, economic_pause_by FROM public_workshop WHERE founder_id = ?', [OWNER]);
    expect(w.economic_pause_at).not.toBeNull();
    expect(String(w.economic_pause_reason)).toMatch(/Stop everything/);
    expect(String(w.economic_pause_by)).toBe(`founder:${OWNER}`);
  });

  it('Home says the institution is stopped and by whom, in the pulse\'s words', async () => {
    const home = decode(asText(await me.page('/foundry')));
    // The pulse reads the hand's block (`whatIsBlocked`): "carrying the test one
    // step — new economic activity is paused: the owner pressed Stop everything".
    const said = /.{0,80}new economic activity is paused: the owner pressed Stop everything.{0,40}/.exec(home)?.[0];
    process.stdout.write(`Home after Stop: ${said ?? '(nothing about the pause)'}\n`);
    if (!said) {
      recordFinding({ id: 'F-PANIC-3', sev: 'P2', area: 'routes/dashboard/foundry-shell (Home)',
        title: 'thirty days after Stop everything, Home does not say the institution is stopped',
        evidence: `GET /foundry after POST /autopilot/panic and 30 mornings never mentions the pause; it opens: "${home.slice(0, 280)}".` });
    }
    expect(home).toContain('new economic activity is paused: the owner pressed Stop everything');
    expect(home).toMatch(/Blocked|blocked|stuck/);
  });

  it('Controls and the public Workshop page say Paused, since when, and by whom', async () => {
    const controls = asText(await me.page('/foundry/controls'));
    const workshop = asText(await me.page('/foundry/public-workshop'));
    expect(controls).toContain('new economic activity paused since');
    expect(workshop).toContain('New economic activity is paused');
    expect(workshop).toContain('by you');
    expect(workshop).toContain('the owner pressed Stop everything');
  });
});

describe('he resumes', () => {
  it('POST /foundry/public-workshop/resume lifts the pause; the next morning the hand is free to write again, and the record says what there was to write', async () => {
    const r = await app.request('/foundry/public-workshop/resume', form({ _csrf: 'world' }));
    expect(r.status).toBe(302);
    expect((await one('SELECT economic_pause_at FROM public_workshop WHERE founder_id = ?', [OWNER])).economic_pause_at).toBeNull();
    const sentBefore = sentToPeople();
    const live = await one('SELECT ran_at, verdict FROM venture_experiments WHERE id = ?', [X]);
    await advanceDays(1);
    const ran = await morning();
    expect(ran.filter((x) => !x.ok)).toEqual([]);
    expect(asText(await me.page('/foundry/public-workshop'))).not.toContain('New economic activity is paused');
    if (live.ran_at == null) {
      // Still open: the remaining approved recipients are written to again.
      expect(sentToPeople()).toBeGreaterThan(sentBefore);
    } else {
      // THE WORLD'S VERDICT IS NOT STOPPED BY STOP: the sealed rule settled the
      // test during the pause (Proof 1 settles seven days after placement), so
      // there is nothing left to send on it, and History must say so.
      expect(String(live.verdict)).toMatch(/surprised|confirmed/);
      expect(sentToPeople()).toBe(sentBefore);
      const history = asText(await me.page('/foundry/experiments/history'));
      expect(history).toMatch(/settled|surprised|confirmed/i);
      process.stdout.write(`resume: the test had settled ${String(live.verdict)} on ${String(live.ran_at)} during the stop with ${String(await unwritten())} businesses never written to; sends could not resume on it, and History says so\n`);
    }
  }, 60_000);

  // FIXED F-PANIC-2 (remediation 1.3, 6 October 2026): Stop everything and the
  // resume that ends it each write a row into `estate_pause_events`, which
  // nothing changes, and Activity reads them. (The pin first looked in
  // audit_log; that table is per company and pruned at 180 days, so the record
  // lives in its own kept rows instead — see migration 388.)
  it('after he resumes, a durable record still says the estate was stopped, by whom and when', async () => {
    const stops = (await query(
      `SELECT kind, principal, reason, detail, paused_since, paused_seconds, unwritten FROM estate_pause_events WHERE founder_id = ? ORDER BY at, rowid`, [OWNER]))
      .rows as unknown as Array<Record<string, unknown>>;
    const trace = stops.length;
    if (trace === 0) {
      recordFinding({ id: 'F-PANIC-2', sev: 'P2', area: 'public-workshop/settings + control/stop',
        title: 'resuming after Stop everything erases the only record that the estate was ever stopped',
        evidence: 'settings.ts resumeEconomicActivity sets economic_pause_at/_reason/_by = NULL; services/control/stop.ts writes no record; nothing names the pause after resume.' });
    }
    expect(trace).toBeGreaterThan(0);
    // Two stops: the one that landed mid-send on day 3 (resumed at once, as
    // that scenario does) and the owner's own on day 4. The latest resume is
    // the one that ended thirty stopped mornings.
    const stopped = stops.filter((r) => r.kind === 'stopped_everything').at(-1);
    const resumed = stops.filter((r) => r.kind === 'resumed').at(-1);
    expect(stops.filter((r) => r.kind === 'stopped_everything').length, 'each Stop is its own row').toBeGreaterThanOrEqual(2);
    expect(stopped, 'the Stop itself is kept').toBeTruthy();
    expect(String(stopped!.principal)).toBe(`founder:${OWNER}`);
    expect(String(stopped!.detail)).toMatch(/new outreach paused/);
    expect(resumed, 'and the resume that ended it').toBeTruthy();
    // Thirty stopped mornings and a day: the pause lasted at least thirty days.
    expect(Number(resumed!.paused_seconds)).toBeGreaterThanOrEqual(30 * 86_400);
    expect(Number(resumed!.unwritten)).toBeGreaterThanOrEqual(0);
    // Nothing may rewrite what he did.
    await expect(query(`UPDATE estate_pause_events SET reason = 'nothing happened' WHERE founder_id = ?`, [OWNER])).rejects.toThrow(/kept as it was/);
    // AND HE CAN READ IT, where the doctrine says he reads what happened.
    const activity = asText(await me.page('/foundry/activity'));
    expect(activity).toMatch(/You stopped everything/);
    expect(activity).toMatch(/You resumed new activity after \d+ days?/);
  });
});
