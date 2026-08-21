process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { syncSentryEvents } from '../../src/services/integration/sentry.js';
import { syncIntercomEvents } from '../../src/services/integration/intercom.js';

// =============================================================================
// A FLOOR THAT IS NAMED A FLOOR.
//
// The GitHub summaries had it, and so did these two: a count taken from the
// length of a CAPPED PAGE and reported under the name of a total.
//
// `sentry.ts` fetched unresolved issues with `limit=25` and stored
// `open_count: issues.length`. A project with three hundred unresolved issues
// reported twenty-five, and `critical_count` counted only within those
// twenty-five — to Sentinel, the agent whose question is whether a system is in
// trouble. "25 unresolved" and "at least 25" are different answers to that.
//
// `intercom.ts` was ALREADY DOING THE RIGHT THING for its headline number: it
// reads Intercom's own `total_count` and only falls back to the page length.
// Worth recording, because a sweep that reports only what it broke tells the
// next reader nothing about where not to look — and because the pattern to copy
// was already in the repository. What it did not do was carry that care to
// `opened_today`, which was counted within a page of fifty and reported as a
// total. The comment beside it said "Estimate opened today"; the field did not.
// =============================================================================

const P = 'p_fl';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_fl','c_fl','f@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_fl','active')", [P]);
  for (const [name, cfg] of [
    ['sentry', { org_slug: 'acme', project_slug: 'app' }],
    ['intercom', {}],
  ] as Array<[string, Record<string, unknown>]>) {
    await query(
      `INSERT INTO integrations (id, product_id, type, provider, name, status,
                                 credentials_json, config_json)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [`int_${name}`, P, name, name, name,
       JSON.stringify({ access_token: 't', auth_token: 't' }), JSON.stringify(cfg)]);
  }
});
beforeEach(async () => { await query('DELETE FROM integration_events'); });
afterEach(() => { vi.unstubAllGlobals(); });

async function event(type: string): Promise<Record<string, unknown>> {
  const row = (await query(
    'SELECT data_json FROM integration_events WHERE product_id=? AND event_type=?', [P, type]))
    .rows[0] as Record<string, unknown>;
  return JSON.parse(String(row.data_json)) as Record<string, unknown>;
}

describe('unresolved issues', () => {
  function sentryReturns(issues: unknown[]): void {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('/issues/') ? issues : []),
      text: async () => '[]',
    }));
  }

  it('is an exact count when the page was not full', async () => {
    sentryReturns([{ level: 'error', title: 'a' }, { level: 'fatal', title: 'b' }]);
    await syncSentryEvents(P);

    const e = await event('error_summary');
    expect(e.open_count).toBe(2);
    expect(e.open_page_truncated).toBe(false);
    expect(e.critical_count_in_page).toBe(1);
  });

  it('is a floor, named a floor, when the page was full', async () => {
    sentryReturns(Array.from({ length: 100 }, () => ({ level: 'error', title: 'x' })));
    await syncSentryEvents(P);

    const e = await event('error_summary');
    expect(e.open_count, 'Sentinel is answering whether the system is in trouble')
      .toBeUndefined();
    expect(e.open_count_at_least).toBe(100);
    expect(e.open_page_truncated).toBe(true);
  });
});

describe('open conversations', () => {
  function intercomReturns(body: Record<string, unknown>): void {
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200, json: async () => body, text: async () => '{}',
    }));
  }

  it('prefers Intercom\'s own total over the page length', async () => {
    intercomReturns({
      total_count: 812,
      conversations: Array.from({ length: 50 }, () => ({ created_at: 1, statistics: {} })),
    });
    await syncIntercomEvents(P);
    expect(Number((await event('conversation_volume')).total_conversations ?? 0)).toBe(812);
  });

  it('does not report a page-bound count of today as a total', async () => {
    intercomReturns({
      conversations: Array.from({ length: 50 }, () => ({
        created_at: Math.floor(Date.now() / 1000), statistics: {},
      })),
    });
    await syncIntercomEvents(P);
    expect((await event('conversation_volume')).opened_today,
      'a full page with no total means the real figure is larger by an unknown amount')
      .toBeNull();
  });

  it('reports it when the page was not full', async () => {
    intercomReturns({
      conversations: [{ created_at: Math.floor(Date.now() / 1000), statistics: {} }],
    });
    await syncIntercomEvents(P);
    expect(Number((await event('conversation_volume')).opened_today)).toBe(1);
  });
});

describe('the floor survives the trip to the reader', () => {
  it('getSentrySummary says "at least" rather than losing the number', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('/issues/')
        ? Array.from({ length: 100 }, () => ({ level: 'error', title: 'x' })) : []),
      text: async () => '[]',
    }));
    await syncSentryEvents(P);

    const { getSentrySummary } = await import('../../src/services/integration/sentry.js');
    const health = await getSentrySummary(P);
    expect(health.openIssues, 'naming it honestly upstream must not throw it away')
      .toBe(100);
    expect(health.openIssuesIsFloor).toBe(true);
  });

  it('and says it is exact when it is', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('/issues/')
        ? [{ level: 'error', title: 'x' }] : []),
      text: async () => '[]',
    }));
    await syncSentryEvents(P);

    const { getSentrySummary } = await import('../../src/services/integration/sentry.js');
    const health = await getSentrySummary(P);
    expect(health.openIssues).toBe(1);
    expect(health.openIssuesIsFloor).toBe(false);
  });
});

describe('the counts that were totals are gone', () => {
  it('sentry no longer names a capped page a count', () => {
    const code = stripComments(
      readFileSync('src/services/integration/sentry.ts', 'utf8'), { lineComments: true });
    expect(code, 'the truncated branch must exist').toMatch(/open_count_at_least: issues\.length/);
    expect(code, 'and the count must be conditional, not unconditional')
      .toMatch(/\.\.\.\(truncated/);
  });
});
