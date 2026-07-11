// =============================================================================
// Tests: Envelopes + Reserved Powers (Hands Law / Constitution Law 10)
// Grants bound WHAT; envelopes bound HOW MUCH per week; reserved powers never
// delegate. All three enforced INSIDE the governed call path — no route around.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

let remoteCalls = 0;
vi.stubGlobal('fetch', vi.fn(async () => {
  remoteCalls++;
  return new Response(JSON.stringify({
    jsonrpc: '2.0', id: 1, result: { ok: true },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}));

import { callMcpTool, issueGrant } from '../../src/services/integration/mcp-client.js';
import { checkAndConsume, setCap, getCap, getUsage, weekStarting, defaultCap } from '../../src/services/outbound/envelopes.js';
import { checkReserved } from '../../src/services/outbound/reserved.js';
import { encryptToken } from '../../src/lib/crypto.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('en_p','EnCo','en_f','active')", []);
  await query(
    `INSERT INTO integrations (id, product_id, owner_id, name, provider, type, status, credentials, config)
     VALUES ('en_srv', 'en_p', 'en_f', 'outbox', 'mcp', 'outbound', 'active', ?, ?)`,
    [encryptToken('tok'), JSON.stringify({ url: 'https://outbox.example/mcp' })],
  );
  await issueGrant({ productId: 'en_p', serverName: 'outbox', toolPattern: '*', maxCalls: 1000, createdBy: 'en_f' });
});

describe('envelopes: freedom inside a budget', () => {
  it('defaults are generous but finite; caps are founder-set', async () => {
    expect(defaultCap('mcp:anything')).toBe(100);
    expect(await getCap('en_p', 'mcp:outbox')).toBe(100);
    await setCap('en_p', 'mcp:outbox', 3);
    expect(await getCap('en_p', 'mcp:outbox')).toBe(3);
  });

  it('week key is the ISO Monday', () => {
    expect(weekStarting(new Date('2026-07-08T10:00:00Z'))).toBe('2026-07-06'); // Wed → Mon
    expect(weekStarting(new Date('2026-07-06T00:00:00Z'))).toBe('2026-07-06'); // Mon → same
    expect(weekStarting(new Date('2026-07-05T23:59:00Z'))).toBe('2026-06-29'); // Sun → prev Mon
  });

  it('consumes to the cap, then refuses without consuming', async () => {
    await setCap('en_p', 'scope:t', 2);
    expect((await checkAndConsume('en_p', 'scope:t')).allowed).toBe(true);
    expect((await checkAndConsume('en_p', 'scope:t')).allowed).toBe(true);
    const third = await checkAndConsume('en_p', 'scope:t');
    expect(third.allowed).toBe(false);
    expect(third.used).toBe(2); // refusal did not consume
  });
});

describe('reserved powers never delegate', () => {
  it('matches the constitutional list, conservatively', () => {
    expect(checkReserved('create_refund').reserved).toBe(true);
    expect(checkReserved('update_pricing').reserved).toBe(true);
    expect(checkReserved('delete_customer_data').reserved).toBe(true);
    expect(checkReserved('sign_contract').reserved).toBe(true);
    expect(checkReserved('send_email').reserved).toBe(false);
    expect(checkReserved('create_invoice').reserved).toBe(false);
  });
});

describe('enforced inside the governed path (no route around)', () => {
  it('a reserved tool is refused even with a live wildcard grant', async () => {
    const r = await callMcpTool({
      productId: 'en_p', agent: 'test', serverName: 'outbox', tool: 'create_refund',
      args: { amount: 500 }, dedupKey: 'r1',
    });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('reserved power');
    expect(remoteCalls).toBe(0); // nothing left the building
  });

  it('the weekly envelope stops fresh calls at the cap; dedup does not consume', async () => {
    await setCap('en_p', 'mcp:outbox', 2);
    const a = await callMcpTool({ productId: 'en_p', agent: 't', serverName: 'outbox', tool: 'post', args: {}, dedupKey: 'k1' });
    const aCached = await callMcpTool({ productId: 'en_p', agent: 't', serverName: 'outbox', tool: 'post', args: {}, dedupKey: 'k1' });
    const b = await callMcpTool({ productId: 'en_p', agent: 't', serverName: 'outbox', tool: 'post', args: {}, dedupKey: 'k2' });
    expect(a.ok && b.ok).toBe(true);
    expect(aCached.ok && (aCached as { cached: boolean }).cached).toBe(true); // deduped, envelope refunded
    expect(await getUsage('en_p', 'mcp:outbox')).toBe(2);

    const c = await callMcpTool({ productId: 'en_p', agent: 't', serverName: 'outbox', tool: 'post', args: {}, dedupKey: 'k3' });
    expect(c.ok).toBe(false);
    expect((c as { reason: string }).reason).toContain('weekly envelope reached');
    expect(remoteCalls).toBe(2); // only the two fresh calls went out
  });
});
