// =============================================================================
// CAPITAL RESEARCH CANNOT REACH AN ORDER.
//
// The owner asked for trading to become one of Foundry's tools. What Foundry
// can do today is research it: read public data, forecast, score. It cannot
// place, change or cancel an order, and that must not rest on a flag somebody
// could flip (the legacy bot's DRY_RUN; the legacy platform's paper fallback
// inside the live stream). It rests on absences this test asserts:
//   · no code in src/services/capital names an order path, a signing header,
//     a key, or any HTTP method but GET;
//   · the reader refuses any path outside its public allowlist before the
//     network;
//   · the only capability that names a trading venue is `observe`, bound to
//     no tool, needing no credential;
//   · no table can hold an order, an account or a mandate;
//   · research never touches products, experiments, sales or the ledger.
// A real-money path would have to remove these on purpose, in review, with the
// owner's written mandate — never by configuration.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);

import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { assertReadable, MarketDataRefused, readJson } from '../../src/services/capital/public-markets.js';

const DIR = 'src/services/capital';
const source = readdirSync(DIR).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(`${DIR}/${f}`, 'utf8')] as const);
/** Code only: the comments are allowed to name what the code refuses. */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

beforeAll(async () => { await runMigrations(); });

describe('in the source', () => {
  it('no order path, signing header, key or non-GET method anywhere in capital research', () => {
    expect(source.length).toBeGreaterThanOrEqual(6);
    for (const [file, text] of source) {
      const c = code(text);
      for (const banned of [/\/portfolio/i, /KALSHI-ACCESS/i, /private[_-]?key/i, /createSign|\.sign\(/, /method:\s*['"](POST|PUT|PATCH|DELETE)/i,
        /placeOrder|place_order|create_order|\/orders\b/i, /process\.env\.[A-Z_]*(KEY|SECRET|TOKEN)/]) {
        expect(banned.test(c), `${file} matches ${String(banned)}`).toBe(false);
      }
    }
  });

  it('research never writes a product, an experiment, a sale or a ledger entry', () => {
    for (const [file, text] of source) {
      expect(/\b(INSERT INTO|UPDATE)\s+(products|venture_experiments|experiment_|business_outcome|ledger_|metric_snapshots|portfolio_)/i.test(code(text)), file).toBe(false);
    }
  });
});

describe('at the network boundary', () => {
  it('refuses any path outside the public allowlist before a request is made', async () => {
    for (const url of [
      'https://api.elections.kalshi.com/trade-api/v2/portfolio/orders',
      'https://api.elections.kalshi.com/trade-api/v2/portfolio/events/orders',
      'https://api.elections.kalshi.com/trade-api/v2/portfolio/balance',
      'https://api.elections.kalshi.com/trade-api/v2/portfolio/fills',
      'https://demo-api.kalshi.co/trade-api/v2/markets',
      'http://api.elections.kalshi.com/trade-api/v2/markets',
      'https://api.exchange.coinbase.com/orders',
    ]) {
      expect(() => assertReadable(url), url).toThrow(MarketDataRefused);
    }
    let called = false;
    await expect(readJson('https://api.elections.kalshi.com/trade-api/v2/portfolio/orders', async () => { called = true; return new Response('{}'); }))
      .rejects.toThrow(MarketDataRefused);
    expect(called).toBe(false);
  });

  it('what it may read, it reads with GET and nothing else', async () => {
    const seen: string[] = [];
    await readJson('https://api.elections.kalshi.com/trade-api/v2/markets/KXBTC15M-X', async (_u, init) => {
      seen.push(String(init.method)); expect(init.body).toBeUndefined(); return new Response('{}');
    });
    expect(seen).toEqual(['GET']);
  });
});

describe('in the constitution', () => {
  it('the only capability naming a trading venue is to observe, bound to no tool, with no credential', async () => {
    const caps = (await query(
      `SELECT c.capability_key, c.rung, a.needs_credential, a.basis FROM capabilities c
         LEFT JOIN capability_access a ON a.capability_key = c.capability_key
        WHERE c.capability_key IN (SELECT capability_key FROM capability_providers WHERE provider IN ('kalshi','coinbase'))`)).rows;
    expect(caps).toEqual([{ capability_key: 'read_public_event_markets', rung: 'observe', needs_credential: 0, basis: 'public_observation' }]);
    const tools = (await query(`SELECT tool FROM capability_providers WHERE provider IN ('kalshi','coinbase')`)).rows;
    expect(tools.every((t) => (t as Record<string, unknown>).tool === null)).toBe(true);
    // Whole words of the key: `screen_trademark` is about names, not markets.
    const keys = (await query(`SELECT capability_key FROM capabilities`)).rows.map((r) => String((r as Record<string, unknown>).capability_key));
    expect(keys.filter((k) => k.split('_').some((w) => /^(orders?|trades?|trading|positions?|wager|bet)$/.test(w)))).toEqual([]);
  });

  it('no capital table can hold an order, an account, a balance or a mandate', async () => {
    const tables = (await query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'capital_%' ORDER BY name`)).rows
      .map((r) => String((r as Record<string, unknown>).name));
    expect(tables).toEqual(['capital_contract_rules', 'capital_evaluations', 'capital_forecasts', 'capital_market_snapshots',
      'capital_paper_fills', 'capital_research_theses', 'capital_resolutions']);
    for (const t of tables) {
      const cols = (await query(`SELECT name FROM pragma_table_info(?)`, [t])).rows.map((r) => String((r as Record<string, unknown>).name));
      for (const c of cols) expect(/order|balance|credential|api_key|mandate|account/i.test(c), `${t}.${c}`).toBe(false);
    }
  });
});
