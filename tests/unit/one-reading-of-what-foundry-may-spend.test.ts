// =============================================================================
// ONE READING OF WHAT FOUNDRY MAY SPEND TODAY, AND WHY.
//
// Five ceilings touched thinking and exactly one refused a model call. The
// owner read five numbers on three pages and could not tell which would stop
// Foundry. Now one function says which ceiling binds today and why, the same
// number is handed to the door that buys thinking, and every surface reads it.
// This proves the number the owner reads is the number that refuses the call.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
// Controls is owner-gated: the world's owner is the instance's owner.
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.AI_DAILY_COST_CEILING_CENTS = '100000';
process.env.AI_DAILY_COST_CEILING_FOUNDER_CENTS = '100000';
process.env.AI_DAILY_COST_CEILING_GLOBAL_CENTS = '100000';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
  id: 'r1', model: 'anthropic/claude-sonnet-5',
  choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
}), { status: 200, headers: { 'content-type': 'application/json' } }));

beforeAll(async () => {
  await seedProductionShape();
  app = await ownerApp();
  vi.stubGlobal('fetch', fetchSpy);
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('one reading of what Foundry may spend', () => {
  it('unsigned: the pre-charter bound binds, every page says so, and the door refuses the call that would pass it', async () => {
    const { thinkingToday, thinkingCapFor } = await import('../../src/services/institution/spending.js');
    const t = await thinkingToday(OWNER);
    expect(t).toMatchObject({ bindingIs: 'pre-charter', bindingCents: 100, spentTodayCents: 0 });
    expect(t.ceilings[0]).toMatchObject({ name: 'Until a charter is signed', cents: 100, stops: 'call' });
    expect(await thinkingCapFor(OWNER)).toBe(100);
    // The same number, on Controls, in the Ask answer and in the absence reading.
    const me = owner(app);
    const controls = asText(await me.page('/foundry/controls'));
    expect(controls).toContain('$0.00 of $1.00 thought today');
    expect(controls).toContain('no charter is signed, so thinking is bounded at $1.00 a day');
    expect(controls).not.toContain('is the limit you set');
    expect(controls).toContain('a note you set');
    const asked = asText(await me.answer('what are you allowed to spend'));
    expect(asked).toContain('Today I may think up to $1.00');
    const { absenceReading } = await import('../../src/services/institution/absence-test.js');
    const bounded = (await absenceReading(OWNER, 7)).properties.find((p) => p.property === 'bounded')!;
    expect(bounded.evidence.join(' ')).toMatch(/at most \$1(\.00)? a day until a charter is signed/);
    // THE DOOR. A call whose reservation would pass $1 is refused at the
    // founder scope, though the deployment's own caps are a thousand dollars.
    const { callClaude, MODELS } = await import('../../src/services/ai/client.js');
    const { companySpend } = await import('../../src/services/ai/what-it-is-for.js');
    const company = String(((await query('SELECT id FROM products WHERE owner_id = ? AND reality = ? ORDER BY created_at LIMIT 1', [OWNER, 'real'])).rows[0] as Record<string, unknown>).id);
    const subject = companySpend(company, 'reading an observation');
    const big = { model: MODELS.SONNET, maxTokens: 1, systemPrompt: 's'.repeat(400_000), userPrompt: 'u', subject };
    await expect(callClaude(big)).rejects.toThrow(/ceiling reached \(founder\)/);
    expect(fetchSpy).not.toHaveBeenCalled();
    const small = { model: MODELS.SONNET, maxTokens: 1, systemPrompt: 's'.repeat(2000), userPrompt: 'u', subject };
    await callClaude(small);
    expect(fetchSpy).toHaveBeenCalledOnce();
    // The reservation row recorded the cap that applied: the pre-charter bound, not the deployment's.
    const r = (await query('SELECT founder_cap_cents FROM ai_spend_reservations ORDER BY created_at DESC, rowid DESC LIMIT 1', [])).rows[0] as Record<string, unknown>;
    expect(Number(r.founder_cap_cents)).toBe(100);
  });

  it('signed: the charter\'s rate binds, the same pages say so, and the call the pre-charter bound refused now passes', async () => {
    const { signCharter } = await import('../../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, testsTotalCents: 10000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 30,
      publicVoice: 'Apex Micro', statement: 'A river of nickels, none needing me.' });
    const { thinkingToday, testsToday } = await import('../../src/services/institution/spending.js');
    const t = await thinkingToday(OWNER);
    expect(t).toMatchObject({ bindingIs: 'charter', bindingCents: 300 });
    expect(t.because).toContain('the charter you signed allows $3.00 a day');
    const me = owner(app);
    const controls = asText(await me.page('/foundry/controls'));
    expect(controls).toMatch(/\$0\.\d\d of \$3\.00 thought today/);
    const charter = asText(await me.page('/foundry/charter'));
    expect(charter).toContain('Also standing');
    expect(charter).toContain('the charter binds');
    const tests = await testsToday(OWNER);
    expect(tests).toMatchObject({ chartered: true, totalCents: 10000, remainingCents: 10000, inFlight: 0, atOnce: 3 });
    const { callClaude, MODELS } = await import('../../src/services/ai/client.js');
    const { companySpend } = await import('../../src/services/ai/what-it-is-for.js');
    const company = String(((await query('SELECT id FROM products WHERE owner_id = ? AND reality = ? ORDER BY created_at LIMIT 1', [OWNER, 'real'])).rows[0] as Record<string, unknown>).id);
    const subject = companySpend(company, 'reading an observation');
    fetchSpy.mockClear();
    // ~$1.20 of input: over the pre-charter dollar, under the charter's three.
    await callClaude({ model: MODELS.SONNET, maxTokens: 1, systemPrompt: 's'.repeat(400_000), userPrompt: 'u', subject });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const r = (await query('SELECT founder_cap_cents FROM ai_spend_reservations ORDER BY created_at DESC, rowid DESC LIMIT 1', [])).rows[0] as Record<string, unknown>;
    expect(Number(r.founder_cap_cents)).toBe(300);
    // And a call that would pass three dollars is refused, as the charter says.
    await expect(callClaude({ model: MODELS.SONNET, maxTokens: 1, systemPrompt: 's'.repeat(1_200_000), userPrompt: 'u', subject })).rejects.toThrow(/ceiling reached \(founder\)/);
  });
});
