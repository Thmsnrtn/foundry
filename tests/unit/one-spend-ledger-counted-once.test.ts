process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getAICostData } from '../../src/services/founder/intelligence.js';
import { getOperatorSystemLines } from '../../src/services/letter/operator-pack.js';

// =============================================================================
// ONE SPEND LEDGER, COUNTED ONCE.
//
// Two operator surfaces reported Foundry's own AI spend, from two different
// ledgers, and both were wrong in different ways.
//
// THE FOUNDER-OPS BADGE read `cost_events` under a comment — mine, written
// earlier in this same campaign — calling it "the canonical spend ledger: real
// amounts, every cost type". `cost_events` has ONE writer:
// `scp/agents/base.ts`, fire-and-forget, for agent sessions only. It excludes
// founder chat, voice replies and every other model call. The same function was
// already counting chat TOKENS while reporting no chat COST, which is what a
// partial ledger beside a complete one looks like from the outside.
//
// `ai/client.ts` reserves and settles every call, so `ai_daily_spend` is the
// complete, reconciled record — including calls whose provider response was
// lost, which expire at the full authorized amount rather than vanishing. It is
// also the ledger the daily ceiling is enforced against, which makes it the one
// that decides whether Foundry may act.
//
// THE LETTER read that ledger and summed it across every scope. Migration 099's
// finish trigger writes the same amount to the global row, the product row and
// the founder row, so "AI spend today is X USD" counted each call up to three
// times. The ratio the warning fires on survived — the inflation is in both
// halves — but the money the operator was shown did not.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM ai_daily_spend');
  await query('DELETE FROM cost_events');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

const today = () => new Date().toISOString().slice(0, 10);

async function spend(scope: string, scopeId: string, cents: number, date = today()) {
  await query(
    `INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at)
     VALUES (?,?,?,?, datetime('now'))
     ON CONFLICT(scope, scope_id, date) DO UPDATE SET spent_cents = spent_cents + excluded.spent_cents`,
    [scope, scopeId, date, cents]);
}

describe('the same call is not counted once per scope', () => {
  it('reports what was spent, not three times what was spent', async () => {
    // One $4.00 call, attributable to a product and a founder: the finish
    // trigger writes 400 cents to all three rows.
    await spend('global', '__global__', 400);
    await spend('product', 'p1', 400);
    await spend('founder', 'f1', 400);

    const cost = await getAICostData();
    expect(cost.total_cost_24h, 'summing every scope reported $12.00').toBe(4);
  });

  it('reads the ledger the ceiling is enforced against, not the partial copy', async () => {
    const founderId = `f_${nanoid(8)}`;
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
      [founderId, `c_${founderId}`, `${founderId}@example.com`]);
    const productId = `p_${nanoid(8)}`;
    await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
      [productId, 'C', founderId]);

    // An agent session logged to cost_events; a founder chat did not, because
    // nothing writes cost_events for chat.
    await query(
      `INSERT INTO cost_events (id, product_id, cost_type, amount_usd)
       VALUES (?,?, 'llm_tokens', 1.00)`, [nanoid(), productId]);
    await spend('global', '__global__', 900); // $9.00 of real, reconciled spend

    const cost = await getAICostData();
    expect(cost.total_cost_24h, 'the partial ledger said $1.00').toBe(9);
  });

  it('says nothing was spent when nothing was', async () => {
    expect((await getAICostData()).total_cost_24h).toBe(0);
  });

  it('divides the real total across founders', async () => {
    for (let i = 0; i < 4; i++) {
      const id = `f_${nanoid(8)}`;
      await query(
        'INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?,?,?,?)',
        [id, `c_${id}`, `${id}@example.com`, 'growth']);
    }
    await spend('global', '__global__', 800);
    const cost = await getAICostData();
    expect(cost.cost_per_founder).toBe(2);
  });
});

describe('the letter the operator reads', () => {
  it('prints the real amount when it warns about a spike', async () => {
    // Three quiet prior days at $1.00 global, then $20.00 today. Product and
    // founder rows carry the same amounts, and used to be summed in.
    for (let d = 1; d <= 3; d++) {
      const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      await spend('global', '__global__', 100, date);
      await spend('product', 'p1', 100, date);
      await spend('founder', 'f1', 100, date);
    }
    await spend('global', '__global__', 2000);
    await spend('product', 'p1', 2000);
    await spend('founder', 'f1', 2000);

    const lines = await getOperatorSystemLines();
    const spendLine = lines.find((l) => l.includes('AI spend today'));
    expect(spendLine, 'a 20x spike should be reported').toBeDefined();
    expect(spendLine, 'the tripled figure was 60.00').toContain('20.00 USD');
    expect(spendLine).toContain('20.0×');
  });

  it('stays quiet on an ordinary day', async () => {
    for (let d = 0; d <= 3; d++) {
      const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      await spend('global', '__global__', 100, date);
    }
    const lines = await getOperatorSystemLines();
    expect(lines.find((l) => l.includes('AI spend today'))).toBeUndefined();
  });
});

describe('neither reader restates the rule', () => {
  it('scopes every ai_daily_spend read', () => {
    for (const f of ['src/services/founder/intelligence.ts',
                     'src/services/letter/operator-pack.ts']) {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      const reads = src.match(/FROM ai_daily_spend[\s\S]{0,160}/g) ?? [];
      expect(reads.length, `${f} should read the ledger`).toBeGreaterThan(0);
      for (const r of reads) {
        expect(r, `${f}: an unscoped SUM counts each call up to three times`)
          .toMatch(/scope = '?global'?|scope = \?/);
      }
    }
  });

  it('no longer calls the partial ledger canonical', () => {
    const src = readFileSync('src/services/founder/intelligence.ts', 'utf8');
    expect(src, 'a comment of mine, corrected rather than defended')
      .not.toMatch(/canonical spend ledger: real amounts, every cost type/);
  });
});
