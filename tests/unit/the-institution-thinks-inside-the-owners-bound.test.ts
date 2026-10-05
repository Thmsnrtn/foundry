// =============================================================================
// LAW (Roadmap 2027 R32): THE CHARTER'S THINKING RATE BINDS EVERY VENTURE
// CALL, PRICED AT REAL RATES.
//
// Every model call that searches, designs, makes or answers for the owner's
// portfolio is the institution's own (no company exists yet to charge), and
// the door resolved the owner's cap only from a company. So the forge, offer
// composition, discovery, the legal pass and correspondence ran to the
// deployment's global ceiling, never to the $1 a day the owner was told binds
// before a charter or the rate he signed; and none of that spend reached the
// founder's ledger, so "Thinking so far" and the forge's own "today's
// thinking is spent" read a number that left it out. And the price table
// charged Opus at three times and Sonnet at one and a half times its rate, so
// the bound bought a third of the thinking it claimed to.
//
// Now an institution call is charged to the institution's owner: refused at
// the same founder cap a company call is, and counted where the owner reads it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.AI_DAILY_COST_CEILING_CENTS = '100000';
process.env.AI_DAILY_COST_CEILING_FOUNDER_CENTS = '100000';
process.env.AI_DAILY_COST_CEILING_GLOBAL_CENTS = '100000';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
  id: 'r1', model: 'anthropic/claude-sonnet-5',
  choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 1000 },
}), { status: 200, headers: { 'content-type': 'application/json' } }));

beforeAll(async () => {
  await seedProductionShape();
  vi.stubGlobal('fetch', fetchSpy);
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('an institution call is the owner\'s thinking', () => {
  it('is refused at the pre-charter dollar, like a company call', async () => {
    const { callClaude, MODELS } = await import('../../src/services/ai/client.js');
    const { institutionSpend } = await import('../../src/services/ai/what-it-is-for.js');
    const subject = institutionSpend('composing a probe for the owner\'s own portfolio search; no company exists yet', 'composing a probe');
    fetchSpy.mockClear();
    // About $1.20 of input at Sonnet's real $2 a million: over the dollar.
    await expect(callClaude({ model: MODELS.SONNET, maxTokens: 1, systemPrompt: 's'.repeat(600_000), userPrompt: 'u', subject }))
      .rejects.toThrow(/ceiling reached \(founder\)/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is counted where the owner reads today\'s thinking', async () => {
    const { callClaude, MODELS } = await import('../../src/services/ai/client.js');
    const { institutionSpend } = await import('../../src/services/ai/what-it-is-for.js');
    const { thinkingToday } = await import('../../src/services/institution/spending.js');
    const before = (await thinkingToday(OWNER)).spentTodayCents;
    await callClaude({ model: MODELS.SONNET, maxTokens: 100, systemPrompt: 's', userPrompt: 'u',
      subject: institutionSpend('reading one observation for the owner\'s own search', 'reading an observation') });
    expect(fetchSpy).toHaveBeenCalled();
    const after = (await thinkingToday(OWNER)).spentTodayCents;
    expect(after).toBeGreaterThan(before);
    const r = (await query('SELECT founder_id, founder_cap_cents, actual_cents FROM ai_spend_reservations ORDER BY created_at DESC, rowid DESC LIMIT 1', [])).rows[0] as Record<string, unknown>;
    // 1,000 in and 1,000 out at $2/$10 a million: 1.2 cents.
    expect(Number(r.actual_cents)).toBeCloseTo(1.2, 5);
    expect(String(r.founder_id)).toBe(OWNER);
    expect(Number(r.founder_cap_cents)).toBe(100);
  });
});

describe('at the rates the provider charges', () => {
  it('Opus 4.8 at $5/$25, Sonnet 5 at $2/$10, Haiku 4.5 at $1/$5 a million tokens', async () => {
    const { computeCostCents, MODELS } = await import('../../src/services/ai/client.js');
    expect(computeCostCents(MODELS.OPUS, 1_000_000, 1_000_000)).toBe(3000);
    expect(computeCostCents(MODELS.SONNET, 1_000_000, 1_000_000)).toBe(1200);
    expect(computeCostCents(MODELS.HAIKU, 1_000_000, 1_000_000)).toBe(600);
  });
});
