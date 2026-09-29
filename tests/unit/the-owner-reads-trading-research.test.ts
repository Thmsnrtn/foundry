// =============================================================================
// THE OWNER READS TRADING RESEARCH — AND NOTHING THERE LOOKS LIKE MONEY.
//
// One reading under Economics: what is being asked, what the evidence says,
// what the research cannot see, and that no order is possible. Only the owner
// begins or stops it; a stop says why; nothing here reaches Economics' figures.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'tr_owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'tr_owner';
let app: Hono;
const as = (email: string): Hono => {
  const a = new Hono();
  a.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  return a;
};
const text = async (a: Hono, path: string): Promise<string> =>
  (await (await a.request(path)).text()).replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, '\'').replace(/\s+/g, ' ');
const post = (a: Hono, path: string, body: Record<string, string> = {}) =>
  a.request(path, { method: 'POST', body: new URLSearchParams(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_tr', 'tr_owner@example.com', 'Owner']);
  const { moneyRoutes } = await import('../../src/routes/dashboard/money-place.js');
  app = as('tr_owner@example.com');
  app.route('/', moneyRoutes);
});

describe('the reading', () => {
  it('before anything begins, says no order is possible and offers one button', async () => {
    const t = await text(app, '/foundry/money/research');
    expect(t).toMatch(/Not observing anything/);
    expect(t).toMatch(/No order is possible/);
    expect(t).toMatch(/Nothing here is income, and none of it is counted in Economics/);
    expect(t).toMatch(/Begin observing/);
    expect(t).toMatch(/The settlement index itself/);
  });

  it('nobody but the owner can begin it', async () => {
    const stranger = as('someone@example.com');
    const { moneyRoutes } = await import('../../src/routes/dashboard/money-place.js');
    stranger.route('/', moneyRoutes);
    expect((await post(stranger, '/foundry/money/research/begin', { venue: 'kalshi' })).status).toBe(403);
  });

  it('the owner begins it, and the page shows the question and how it would be proved wrong', async () => {
    expect((await post(app, '/foundry/money/research/begin', { venue: 'nyse' })).headers.get('location')).toMatch(/error=Not%20a%20venue/);
    expect((await post(app, '/foundry/money/research/begin')).headers.get('location')).toMatch(/error=Not%20a%20venue/);
    const r = await post(app, '/foundry/money/research/begin', { venue: 'kalshi' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/foundry/money/research?done=begun');
    const t = await text(app, '/foundry/money/research?done=begun');
    expect(t).toMatch(/Observing Kalshi's 15-minute Bitcoin contracts/);
    expect(t).toMatch(/What would prove it wrong/);
    expect(t).toMatch(/Stop observing Kalshi/);
    expect(t).toMatch(/Begin observing Polymarket/);
    expect((await post(app, '/foundry/money/research/begin', { venue: 'kalshi' })).headers.get('location')).toMatch(/error=.*already/);
  });

  it('shows the evidence\'s verdict in words, with the simulation called a simulation', async () => {
    const thesis = String(((await query(`SELECT id FROM capital_research_theses`)).rows[0] as Record<string, unknown>).id);
    const { evaluateThesis } = await import('../../src/services/capital/research.js');
    await evaluateThesis(thesis);
    const t = await text(app, '/foundry/money/research');
    expect(t).toMatch(/Not enough yet/);
    expect(t).toMatch(/Simulated result — never money/);
    expect(t).not.toMatch(/\bprofit\b/i);
  });

  it('shows the last window: the book, the proxy named as a proxy, and each forecast with its reason', async () => {
    const thesis = String(((await query(`SELECT id FROM capital_research_theses`)).rows[0] as Record<string, unknown>).id);
    await query(`INSERT INTO capital_contract_rules (id, venue, series_ticker, settlement_source, fee_type, fee_multiplier) VALUES ('rule1','kalshi','KXBTC15M','CF Benchmarks','quadratic',1)`);
    await query(`INSERT INTO capital_market_snapshots (id, venue, series_ticker, market_ticker, rule_id, open_time, close_time, floor_strike, rules_primary_digest,
      received_at, best_yes_bid, best_yes_ask, yes_book_json, no_book_json, proxy_price, proxy_source, proxy_observed_at, proxy_sigma_1m)
      VALUES ('s1','kalshi','KXBTC15M','KXBTC15M-PAGE',?,?,?,83504.45,'d',?,0.44,0.45,'[]','[]',83492.54,'coinbase BTC-USD spot (proxy)',?,0.00038)`,
    ['rule1', new Date(Date.now() - 300_000).toISOString(), new Date(Date.now() + 600_000).toISOString(), new Date().toISOString(), new Date().toISOString()]);
    await query(`INSERT INTO capital_forecasts (id, founder_id, thesis_id, snapshot_id, market_ticker, model, p_yes, decision, reason)
      VALUES ('f1',?,?,'s1','KXBTC15M-PAGE','proxy_drift_v1',0.4332,'skip','best net edge -0.0132 per contract on NO is below 0.02')`, [OWNER, thesis]);
    const t = await text(app, '/foundry/money/research');
    expect(t).toMatch(/The last window/);
    expect(t).toMatch(/Proxy \(not the settlement source\)/);
    expect(t).toMatch(/The proxy model P\(YES\) 0\.4332 — no trade: best net edge -0\.0132/);
    expect(t).toMatch(/Reference level \$83504\.45/);
  });

  it('a stop needs a reason, and then it stops', async () => {
    expect((await post(app, '/foundry/money/research/stop', { venue: 'kalshi', because: '' })).headers.get('location')).toMatch(/error=/);
    expect((await post(app, '/foundry/money/research/stop', { venue: 'polymarket', because: 'x' })).headers.get('location')).toMatch(/Nothing%20was%20being%20observed/);
    expect((await post(app, '/foundry/money/research/stop', { venue: 'kalshi', because: 'the products come first' })).headers.get('location'))
      .toBe('/foundry/money/research?done=stopped');
    const t = await text(app, '/foundry/money/research');
    expect(t).toMatch(/Kalshi: stopped/);
    expect(t).toMatch(/the products come first/);
  });

  it('Economics points to it and counts none of it', async () => {
    const t = await text(app, '/foundry/money');
    expect(t).toMatch(/Trading research is a simulation and is never counted here/);
    const raw = await (await app.request('/foundry/money')).text();
    expect(raw).toContain('href="/foundry/money/research"');
  });
});
