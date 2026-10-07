// =============================================================================
// Campaign 2026-10-06: the owner's first visit, from two places at once
//
// The owner walk (owner-walk.ts) met Home answering 503 "I can't reach my own
// records" on day one, twice, and 200 on every later visit. The logged cause:
// SQLITE_CONSTRAINT_PRIMARYKEY on owner_visits.founder_id. markVisit()
// (services/founder/what-changed.ts) reads the visit row and inserts one when
// it is missing; two first visits that overlap (phone and laptop, a link
// preview, a prefetch) both read "missing" and the second insert throws.
//
// F-WALK-1, FIXED 2026-10-06 (was it.fails): markVisit now inserts with
// ON CONFLICT(founder_id) DO NOTHING and re-reads, and moves the marker only
// if nobody moved it since it was read.
// =============================================================================

process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { providerStubs } from '../../helpers/provider-stubs.js';
import { ownerApp, seedProductionShape } from '../../helpers/world.js';

const { fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
afterAll(() => { vi.unstubAllGlobals(); });

vi.mock('../../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => ({ content: JSON.stringify({ abstain: 'not read in this test' }), tokensUsed: 1, costUsd: 0 })),
  callOpus: vi.fn(async () => ({ content: JSON.stringify({ abstain: 'not read in this test' }), tokensUsed: 1, costUsd: 0 })),
}));

let app: Awaited<ReturnType<typeof ownerApp>>;
/** What the racing first visits answered — read by the plain test below, so a
 *  harness fault cannot hide inside the racing test. */
let firstVisit: number[] = [];

beforeAll(async () => {
  await seedProductionShape({ charter: true });
  app = await ownerApp();
}, 60_000);

describe('the first visit', () => {
  it('two first visits to Home that arrive together both answer 200', async () => {
    const [a, b, c] = await Promise.all([app.request('/foundry'), app.request('/foundry'), app.request('/foundry')]);
    const statuses = [a.status, b.status, c.status];
    firstVisit = statuses;
    process.stdout.write(`first-visit statuses: ${statuses.join(',')}\n`);
    expect(statuses).toEqual([200, 200, 200]);
  }, 30_000);

  it('the racing visits failed only as the race fails, and a later visit answers 200', async () => {
    // Vacuity guard for the racing test above: it must have run, and every answer
    // must be a 200 or the race's 503 — a 403/500 would be a harness fault.
    expect(firstVisit).toHaveLength(3);
    expect(firstVisit.every((s) => s === 200 || s === 503)).toBe(true);
    const r = await app.request('/foundry');
    expect(r.status).toBe(200);
  }, 30_000);
});
