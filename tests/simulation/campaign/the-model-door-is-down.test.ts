// =============================================================================
// THE MODEL DOOR IS DOWN — five ways the provider fails, and what the
// institution does with each.
//
// A local HTTP server stands in for OpenRouter; `OPENROUTER_BASE_URL` points
// the real client at it. Nothing is mocked in the client: the key check, the
// reservation, the timeout, the retries and the settlement are the production
// code. For each failure the forge is driven through its own routine
// (`forge_tick` → `forgePass` → `lensFinding` → `callSonnet` → `callClaude`)
// against an undesigned real test, then twenty direct calls through the same
// client measure the ledger under repetition, then the owner's pages are read
// while nothing has answered all day. The proof that the door is reached at
// all — a door that answers — runs last, because one answered call is, by
// design, the end of "answered nothing today".
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
// The client reads its timeout once, at import. 120 s by default; shortened
// here so a hung door is bounded, and the default is a finding below.
process.env.AI_TIMEOUT_MS = '400';
process.env.OPENROUTER_API_KEY = 'sk-or-door-test';

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/db/client.js';
import { providerStubs } from '../../helpers/provider-stubs.js';
import { OWNER, asText, ownerApp, routinesRanThisMorning, seedProductionShape } from '../../helpers/world.js';
import { recordFinding, runUnderLock } from './campaign-helpers.js';

type Mode = 'ok' | '500' | '401' | 'hang' | 'malformed' | '429';
let mode: Mode = '500';
let hits = 0;
let server: Server;
let baseUrl = '';
const hung: Array<() => void> = [];

// The door: every other address goes to the provider stubs, as the sims do.
const { fetch: stubFetch } = providerStubs();
const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (baseUrl && u.startsWith(baseUrl)) return realFetch(url, init);
  return stubFetch(url, init);
}) as typeof fetch);

let app: Awaited<ReturnType<typeof ownerApp>>;
let X = '';
let opportunityId = '';
let fresh = 0;
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;
const outboundCount = async () => Number((await one('SELECT COUNT(*) AS n FROM outbound_actions')).n);
const reservations = async () => (await query(
  `SELECT status, COUNT(*) AS n FROM ai_spend_reservations GROUP BY status`, [])).rows as unknown as Array<{ status: string; n: number }>;

/** An undesigned real test for the forge to deliberate (the shape sim 08 makes on day 25). */
async function anUndesignedTest(): Promise<string> {
  fresh += 1;
  const { raiseUnknown } = await import('../../../src/services/venture/market-evidence.js');
  const unknownId = await raiseUnknown({ founderId: OWNER, opportunityId, blocking: true,
    question: `Would a shop that saw the brief pay for the next one? (${String(fresh)})`, cheapestTest: 'offer the second brief to those who received the first' });
  const { designExperiment } = await import('../../../src/services/venture/validation.js');
  return designExperiment({ founderId: OWNER, opportunityId, unknownId,
    whatWeDo: `offering a second brief to those who received the first (${String(fresh)})`, whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays',
    costCents: 2500, evidenceMode: 'real' });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    hits += 1;
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      if (mode === 'hang') { hung.push(() => res.destroy()); return; }
      if (mode === '500') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"message":"upstream exploded"}}'); return; }
      if (mode === '401') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"invalid key"}}'); return; }
      if (mode === '429') { res.writeHead(429, { 'content-type': 'application/json' }); res.end('{"error":{"message":"rate limited"}}'); return; }
      if (mode === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"choices": [{"message": {"content": "'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'r', model: 'x', choices: [{ message: { role: 'assistant', content: JSON.stringify({ abstain: 'nothing here' }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: Math.ceil(body.length / 4), completion_tokens: 8 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${String(typeof addr === 'object' && addr ? addr.port : 0)}`;
  process.env.OPENROUTER_BASE_URL = baseUrl;

  ({ experimentId: X } = await seedProductionShape({ searching: true }));
  app = await ownerApp();
  opportunityId = String((await one('SELECT opportunity_id FROM venture_experiments WHERE id = ?', [X])).opportunity_id);
  await routinesRanThisMorning();
}, 60_000);

afterAll(async () => {
  for (const close of hung) close();
  await new Promise<void>((r) => server.close(() => r()));
  vi.unstubAllGlobals();
});

/** Drive the forge through its routine against a fresh undesigned test and read what the door left behind. */
async function forgeUnderMode(m: Mode) {
  const experimentId = await anUndesignedTest();
  mode = m; hits = 0;
  const before = await outboundCount();
  const out = await runUnderLock('forge_tick');
  const health = await one(`SELECT consecutive_failures, last_error_name FROM job_health WHERE job_name = 'forge_tick'`);
  return { out, hits, health, experimentId, outboundAfter: await outboundCount(), outboundBefore: before };
}

describe.each<[Mode, string, string, boolean]>([
  ['500', 'ambiguous', 'retried then exhausted', true],
  ['429', 'ambiguous', 'retried then exhausted', true],
  ['malformed', 'ambiguous', 'retried then exhausted', true],
  ['hang', 'ambiguous', 'timed out, retried, exhausted', true],
  ['401', 'released', 'refused without retry', false],
])('the door answers %s', (m, endsAs, how, retried) => {
  it(`forge_tick fails as ModelDoorError (${how}); the reservation ends ${endsAs}; nothing goes out`, async () => {
    const before = await reservations();
    const r = await forgeUnderMode(m);
    expect(r.hits).toBe(retried ? 3 : 1);
    expect(r.out.state).toBe('refused');
    expect(r.out.errorName).toBe('ModelDoorError');
    expect(String(r.health.last_error_name)).toBe('ModelDoorError');
    expect(r.outboundAfter).toBe(r.outboundBefore);
    const after = await reservations();
    const delta = (s: string) => Number(after.find((x) => x.status === s)?.n ?? 0) - Number(before.find((x) => x.status === s)?.n ?? 0);
    expect(delta(endsAs)).toBeGreaterThanOrEqual(1);
    expect(delta('reserved')).toBe(0);
    // The test itself is untouched: undesigned, not retired, no refusal held against it.
    expect(Number((await one('SELECT COUNT(*) AS n FROM forge_refusals WHERE experiment_id = ?', [r.experimentId])).n)).toBe(0);
    expect((await one('SELECT retired_at FROM venture_experiments WHERE id = ?', [r.experimentId])).retired_at).toBeNull();
  }, 120_000);
});

describe('twenty failures in a row', () => {
  it('the door is asked until the breaker rests it; then refused at once, typed, with nothing reserved; ambiguous reservations stay under the cap', async () => {
    mode = '500'; hits = 0;
    const { callSonnet, ModelDoorResting, resetModelDoorBreaker, modelDoorBreaker } = await import('../../../src/services/ai/client.js');
    resetModelDoorBreaker();
    const { institutionSpend } = await import('../../../src/services/ai/what-it-is-for.js');
    const { thinkingCapFor } = await import('../../../src/services/institution/spending.js');
    const cap = await thinkingCapFor(OWNER);
    const today = new Date().toISOString().slice(0, 10);
    const ambBefore = Number((await one(`SELECT COUNT(*) AS n FROM ai_spend_reservations WHERE status = 'ambiguous' AND date = ?`, [today])).n);
    const names = new Map<string, number>();
    let resting = 0;
    for (let i = 0; i < 20; i++) {
      try {
        await callSonnet('You are a lens.', `Read this record and reply with JSON. attempt ${String(i)}`, 200,
          institutionSpend('a campaign measuring what the door does under repeated failure', 'a lens', { kind: 'experiment', id: X }));
      } catch (e) {
        const n = e instanceof Error ? e.name : 'Error';
        names.set(n, (names.get(n) ?? 0) + 1);
        if (e instanceof ModelDoorResting) resting += 1;
      }
    }
    const spend = await one(`SELECT reserved_cents, spent_cents FROM ai_daily_spend WHERE scope = 'founder' AND scope_id = ? AND date = ?`, [OWNER, today]);
    const amb = Number((await one(`SELECT COUNT(*) AS n FROM ai_spend_reservations WHERE status = 'ambiguous' AND date = ?`, [today])).n);
    process.stdout.write(`twenty failures: thrown ${JSON.stringify([...names])}; door asked ${String(hits)} times; resting refusals ${String(resting)}; ambiguous today ${String(amb)}; founder reserved ${String(spend?.reserved_cents)}c spent ${String(spend?.spent_cents)}c of cap ${String(cap)}c\n`);
    // Every attempt either reached the door, was refused at the ceiling, or was refused by the resting breaker — all named.
    expect((names.get('ModelDoorError') ?? 0) + (names.get('SpendCeilingError') ?? 0)).toBe(20);
    // THE BREAKER: five calls (three attempts each) reach the door; the other fifteen never do, and reserve nothing.
    expect(hits).toBeLessThanOrEqual(5 * 3);
    expect(resting).toBeGreaterThanOrEqual(15);
    expect(amb - ambBefore).toBeLessThanOrEqual(5);
    expect(modelDoorBreaker().restingUntil).not.toBeNull();
    // The ambiguous rows hold their reservation until expiry; they are counted against the cap, never above it.
    expect(Number(spend?.reserved_cents ?? 0) + Number(spend?.spent_cents ?? 0)).toBeLessThanOrEqual(cap + 1);
    const { modelDoorToday } = await import('../../../src/services/ai/spend-ledger.js');
    const door = await modelDoorToday();
    expect(door.failed).toBeGreaterThanOrEqual(amb);
    expect(door.settled).toBe(0);
  }, 300_000);
});

describe('what the owner reads while nothing has answered all day', () => {
  const phrase = 'the model door failed';
  it('Controls says so, with the count, where the production facts live', async () => {
    const r = await app.request('/foundry/controls');
    expect(r.status).toBe(200);
    const text = asText(await r.text());
    expect(text).toMatch(/the model door failed \d+ times today and answered nothing/);
    expect(text).toContain('check the OpenRouter credit and key');
  });

  // F-DOOR-2, FIXED 2026-10-06 (was it.fails): Home's pulse, its health card
  // and the absence page read modelDoorDown(), the same canonical reading
  // Controls' "can it sell" renders.
  it('Home and the absence page render 200 and say the door is down in the words the code uses', async () => {
    // The code's phrasing for a failed door is in services/control/production-facts.ts:
    // `the model door failed N times today and answered nothing, so nothing new can be found or designed`.
    const homeR = await app.request('/foundry');
    const absR = await app.request('/foundry/absence');
    expect([homeR.status, absR.status]).toEqual([200, 200]);
    const home = asText(await homeR.text());
    const absence = asText(await absR.text());
    const has = { home: home.includes(phrase), absence: absence.includes(phrase) };
    if (!has.home || !has.absence) {
      const { howFoundryIsRunning } = await import('../../../src/services/founder/health.js');
      const pulse = await howFoundryIsRunning(OWNER);
      recordFinding({ id: 'F-DOOR-2', sev: 'P2', area: 'routes/dashboard (Home, absence)',
        title: 'a down model door is visible only on Controls; Home and the absence page attribute it to the forge routine',
        evidence: `forge_tick failed 5 times with ModelDoorError and 20 direct calls failed; Controls says "${/the model door failed[^.]*\./.exec(asText(await (await app.request('/foundry/controls')).text()))?.[0] ?? ''}"; `
          + `Home says "${/(Separately: )?\d+ routines? of mine (has|have) (stopped|failed)[^.]*\./.exec(home)?.[0] ?? '(nothing about a routine)'}" and the pulse behind it says "${pulse.sentence}"; `
          + `the absence page's loop evidence: "${/designing and attacking tests[^.]*\./.exec(absence)?.[0] ?? '(none)'}". Neither names the door, the credit or the key, which is what he would have to fix.` });
    }
    expect(has).toEqual({ home: true, absence: true });
  });

  it('no page shows the provider\'s message or the door\'s address: the class is kept, never the message', async () => {
    for (const path of ['/foundry', '/foundry/absence', '/foundry/controls']) {
      const text = await (await app.request(path)).text();
      expect(text).not.toContain('upstream exploded');
      expect(text).not.toContain(baseUrl);
    }
    expect(String((await one(`SELECT last_error_name FROM job_health WHERE job_name = 'forge_tick'`)).last_error_name)).toBe('ModelDoorError');
  });

  it('no outbound action was created while the door was down', async () => {
    expect(await outboundCount()).toBe(0);
  });
});

describe('the timeout is sized per tier and bounded per call (F-DOOR-1)', () => {
  it('a hung door is waited for at most the call\'s budget, and production budgets are minutes, not six of them', async () => {
    // Measured, not read: direct calls through the real client against a door
    // that never answers, with AI_TIMEOUT_MS = 400 set above.
    mode = 'hang'; hits = 0;
    const { callSonnet, MODELS, doorTimingFor, resetModelDoorBreaker } = await import('../../../src/services/ai/client.js');
    const { institutionSpend } = await import('../../../src/services/ai/what-it-is-for.js');
    const call = async (): Promise<{ name: string; ms: number }> => {
      resetModelDoorBreaker();
      const t0 = Date.now();
      let name = '';
      try {
        await callSonnet('You are a lens.', 'Read this and reply with JSON.', 100,
          institutionSpend('a campaign timing a hung door', 'a lens', { kind: 'experiment', id: X }));
      } catch (e) { name = e instanceof Error ? e.name : 'Error'; }
      return { name, ms: Date.now() - t0 };
    };
    // Under the tier's default budget, the three attempts fit.
    const wide = await call();
    expect(wide.name).toBe('ModelDoorError');
    expect(hits).toBe(3);
    expect(wide.ms).toBeGreaterThanOrEqual(3 * 400);
    // A budget shorter than one backoff: one attempt, and no waiting to give up.
    hits = 0;
    process.env.AI_CALL_BUDGET_MS = '600';
    try {
      const tight = await call();
      expect(tight.name).toBe('ModelDoorError');
      expect(hits).toBe(1);
      expect(tight.ms).toBeLessThan(1_500);
    } finally { delete process.env.AI_CALL_BUDGET_MS; }
    // Production's shape, with neither variable set: each tier's whole call fits
    // inside its budget, and none is the six minutes the 120 s default cost.
    for (const m of [MODELS.HAIKU, MODELS.SONNET, MODELS.OPUS]) {
      const t = doorTimingFor(m, {});
      expect(t.attemptMs).toBeLessThanOrEqual(t.budgetMs);
      expect(t.budgetMs).toBeLessThanOrEqual(180_000);
    }
    expect(doorTimingFor(MODELS.HAIKU, {}).budgetMs).toBeLessThan(doorTimingFor(MODELS.SONNET, {}).budgetMs);
    expect(doorTimingFor(MODELS.SONNET, {}).budgetMs).toBeLessThan(doorTimingFor(MODELS.OPUS, {}).budgetMs);
    resetModelDoorBreaker();
  }, 60_000);

  it('a forge pass stops at its own wall-clock deadline and leaves the rest for the next pass', async () => {
    mode = 'ok'; hits = 0;
    const { resetModelDoorBreaker } = await import('../../../src/services/ai/client.js');
    resetModelDoorBreaker();
    await anUndesignedTest();
    process.env.FORGE_PASS_DEADLINE_MS = '1';
    try {
      await new Promise((r) => setTimeout(r, 5));
      const { forgePass } = await import('../../../src/services/venture/forge-deliberation.js');
      const pass = await forgePass(OWNER);
      expect(pass.deliberated).toEqual([]);
      expect(pass.stoppedAtDeadline).toMatch(/deadline; designing .* left for the next pass/);
      expect(hits).toBe(0);
    } finally { delete process.env.FORGE_PASS_DEADLINE_MS; }
  }, 60_000);
});

describe('the door is reached for real', () => {
  it('with the door answering, the forge deliberates: the call settles and the routine passes', async () => {
    // After the breaker's cooldown the door is asked again; the rehearsal does not wait five minutes.
    (await import('../../../src/services/ai/client.js')).resetModelDoorBreaker();
    const r = await forgeUnderMode('ok');
    expect(r.hits).toBeGreaterThan(0);
    expect(r.out.state).toBe('ok');
    expect((await reservations()).some((x) => x.status === 'settled' && Number(x.n) > 0)).toBe(true);
    const { modelDoorToday } = await import('../../../src/services/ai/spend-ledger.js');
    expect((await modelDoorToday()).settled).toBeGreaterThan(0);
  }, 60_000);
});
