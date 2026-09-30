process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { readMandate } from '../../src/services/mandate/statements.js';
import { compileIntent, touchesAuthority } from '../../src/services/intent/compile.js';
import { effectiveAuthority } from '../../src/services/control/authority.js';
import { exploreSummary } from '../../src/services/explore/summary.js';

// =============================================================================
// TRADING IS PAPER AND SIMULATION ONLY (Institution V7, 30 September 2026; the
// long-horizon directive's 608, "test strategies, paper only";
// INSTITUTION_MODEL §6.1 "Financial assets: simulation only; LIVE does not
// exist").
//
// The owner can say they want trading strategies tested on paper, and it is
// heard as what they want — steering, never authority. A trading Mission can
// be a simulation or on paper; a real one is refused with the reason. Explore
// shows the three worlds — Simulation, Paper, Live — and Live is shown as not
// existing, never left out. No sentence, Mission or setting can create an
// order path, and none exists.
// =============================================================================

const OWNER = 'f_trade';
const NOW = new Date('2026-09-30T12:00:00Z');
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_trade', 'owner@example.com', 'Owner']);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});

describe('what the owner says', () => {
  it('"Test trading strategies, paper only" is what they want, kept theoretical, and never authority', () => {
    expect(readMandate('Test trading strategies, paper only', NOW)).toMatchObject({
      dimension: 'posture', subject: 'trading_theoretical', scope: { kind: 'domain', ref: 'trading' } });
    const p = compileIntent('Test trading strategies, paper only', { searching: false, now: NOW });
    expect(p.destination).toBe('mandate');
    expect(touchesAuthority(p)).toBe(false);
    // Asking to place a real order is not something the Mandate can hear.
    expect(readMandate('Place a real order on Kalshi for $100', NOW)).toBeNull();
  });

  it('confirms through the composer and is shown on Explore', async () => {
    const shown = await (await app.request('/foundry/ask', form({ said: 'Test trading strategies, paper only' }))).text();
    const hash = /name="hash" value="([0-9a-f]+)"/.exec(shown)![1]!;
    expect((await app.request('/foundry/mandate/confirm', form({ said: 'Test trading strategies, paper only', hash }))).status).toBe(302);
    expect((await exploreSummary(OWNER)).mandate.tradingTheoretical).toBe(true);
  });
});

describe('a trading Mission', () => {
  it('may be a simulation or on paper, and a real one is refused with the reason', async () => {
    expect((await app.request('/foundry/missions', form({ goal: 'Test a trading strategy on the Fed decision', mode: 'monitor', realm: 'paper' }))).status).toBe(302);
    expect((await app.request('/foundry/missions', form({ goal: 'Test a trading strategy on the Fed decision', mode: 'monitor', realm: 'simulation' }))).status).toBe(302);
    const real = await app.request('/foundry/missions', form({ goal: 'Trade the Fed decision with $100', mode: 'monitor', realm: 'real' }));
    expect(real.status).toBe(422);
    expect(await real.text()).toContain('Trading can only be a simulation or on paper here');
  });
});

describe('the three worlds', () => {
  it('shows Simulation and Paper with their counts, and Live as not existing', async () => {
    const html = await (await app.request('/foundry/explore')).text();
    const worlds = /<ul class="mandate-list trading-worlds"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? '';
    expect(worlds).toContain('<b>Simulation</b>');
    expect(worlds).toContain('<b>Paper</b>');
    expect(worlds).toMatch(/<b>Live<\/b> <span class="status back">Does not exist<\/span>/);
    expect(worlds).toContain('No sentence, Mission or setting can create one.');
    expect(html).toContain('You asked for it to stay theoretical, and it does.');
  });

  it('has no order path to show: none exists, and the authority reading agrees', async () => {
    expect((await query(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%order%' AND name NOT LIKE 'venue_orders%'`)).rows[0]).toMatchObject({ n: 0 });
    expect((await effectiveAuthority(OWNER, { domain: 'financial_assets' })).verdict).toBe('unavailable');
  });
});
