import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { executeRaw, query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { splitSqlStatements } from '../../src/db/migrate.js';
import { finishReservation, reserveSpend, SpendCeilingError } from '../../src/services/ai/spend-ledger.js';

// Interactive libSQL transactions use distinct connections; a named file is
// required because `file::memory:` is private to each connection.
process.env.TURSO_DATABASE_URL = `file:/tmp/foundry-ai-spend-${process.pid}-${Date.now()}.db`;

const caps = { global: 10, product: 10, founder: 10 };
const input = (overrides: Record<string, unknown> = {}) => ({
  productId: 'p1', founderId: 'f1', model: 'test/model', amountCents: 6, caps, ...overrides,
});

beforeAll(async () => {
  // The migrations are the schema. Anything this file used to create by hand
  // is already here, in the shape the product actually has — a fixture that
  // disagrees with the schema proves nothing about the product.
  await runMigrations();
  // Two migrations were re-applied on top by hand, which is how this file's
  // `products` came to be a two-column stand-in and how the second apply
  // collided with a column a later migration had already added.
  await query(
    `INSERT OR IGNORE INTO founders (id, clerk_user_id, email) VALUES ('f1','clerk_f1','f1@test.local')`);
  await query("INSERT OR IGNORE INTO products(id, name, owner_id) VALUES ('p1', 'Ledger Co', 'f1')");
});

beforeEach(async () => {
  await executeRaw('DELETE FROM ai_spend_reservations;\nDELETE FROM ai_daily_spend;');
});

describe('atomic AI spend reservations', () => {
  it('admits only one of two concurrent calls that would exceed every cap together', async () => {
    const results = await Promise.allSettled([reserveSpend(input()), reserveSpend(input())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(SpendCeilingError);
    const rows = await query('SELECT reserved_cents, spent_cents FROM ai_daily_spend');
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every((r) => Number((r as Record<string, unknown>).reserved_cents) === 6)).toBe(true);
  });

  it('settles actual cost and releases unused authorization across all scopes', async () => {
    const reservation = await reserveSpend(input());
    await finishReservation(reservation, { kind: 'settled', actualCents: 2 });
    const rows = await query('SELECT reserved_cents, spent_cents FROM ai_daily_spend');
    expect(rows.rows.every((r) => Number((r as Record<string, unknown>).reserved_cents) === 0)).toBe(true);
    expect(rows.rows.every((r) => Number((r as Record<string, unknown>).spent_cents) === 2)).toBe(true);
  });

  it('releases definitive failures but accounts expired ambiguous calls at the full reservation', async () => {
    const definitive = await reserveSpend(input({ amountCents: 4 }));
    await finishReservation(definitive, { kind: 'released' });
    const ambiguous = await reserveSpend(input({ amountCents: 6, ttlMs: -1 }));
    await finishReservation(ambiguous, { kind: 'ambiguous' });
    await expect(reserveSpend(input({ amountCents: 5 }))).rejects.toBeInstanceOf(SpendCeilingError);
    const reservation = await query('SELECT status, actual_cents FROM ai_spend_reservations WHERE id = ?', [ambiguous.id]);
    expect(reservation.rows[0]).toMatchObject({ status: 'expired', actual_cents: 6 });
  });

  it('blocks concurrent provider dispatch through the real AI client before the cap can race', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AI_DAILY_COST_CEILING_CENTS = '1';
    process.env.AI_DAILY_COST_CEILING_FOUNDER_CENTS = '1';
    process.env.AI_DAILY_COST_CEILING_GLOBAL_CENTS = '1';
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      id: 'r1', model: 'anthropic/claude-sonnet-5',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.resetModules();
    const { callClaude, MODELS } = await import('../../src/services/ai/client.js');
    const request = { model: MODELS.SONNET, maxTokens: 1, systemPrompt: 's'.repeat(1800), userPrompt: 'u', productId: 'p1' };
    const results = await Promise.allSettled([callClaude(request), callClaude(request)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
