process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getBoardPacket } from '../../src/services/scp/investor/board-packet.js';

// =============================================================================
// A COMPANY IS NOT EVERYONE'S TO READ.
//
// `getBoardPacket(id)` ran `SELECT * FROM board_packets WHERE id=?`, so whatever
// asked for a packet got it: **any authenticated founder could read any
// company's board packet** — the executive summary, the key metrics, the wins,
// the risks, the asks, the next-quarter goals. The most sensitive document
// Foundry produces about a company. The reader now takes the founder and the
// query joins `products` to scope on `owner_id`, which is where the rule has to
// live: the route that first exposed it has since been removed with the rest of
// Commercial Foundry, and the service must not depend on a caller to be safe.
//
// THE RULE WAS KNOWN AND APPLIED THREE TIMES BY ITS NEIGHBOURS.
// `getInvestorUpdate(id, ownerId)` joins `products` and scopes on `owner_id`,
// with a comment saying why; `markPacketFinalized` and `markUpdateSent` both
// take the founder. The READ of the most sensitive of the four was the one that
// was missed, which is what happens when a rule lives in each caller instead of
// in one place. `middleware/tenant.ts` IS that one place — it states ownership
// validation and the deliberate 404-rather-than-403 — and it is mounted
// nowhere, sitting on the unreachable-modules baseline.
//
// SIX IDIOMS were found in use for "is this company theirs". A rule with six
// implementations has no floor: the seventh route has nothing. So the fix is
// not only this route. `check-tenant-scope.mjs` is the floor, and its baseline
// is two entries, each of which had to earn a written reason on the route
// itself. Both of those routes have since been deleted, so the reasons went
// with them; what the floor still has to do is refuse a THIRD.
//
// AND THE OPERATOR APPROVED A COMPANY'S DECISION AS THE FOUNDER. Two routes on
// the `isFounder`-gated operator surface ran
// `UPDATE decisions SET status=…, decided_by='founder' WHERE id = ?` with no
// scope at all. `isFounder` is FOUNDRY'S OWNER, not the company's founder — so
// the operator could resolve any company's decision and the ledger recorded it
// as the act of the person whose company it was. Those routes are gone, so
// nothing here reads them; what survives them is the column vocabulary, which
// admits 'founder' or 'second_self' and nothing else because the operator
// resolving a company's decisions is not a thing the boundary doctrine
// describes. That is the check kept below: adding an authority quietly is the
// one thing the constitutional invariant names, and the vocabulary is where it
// would have to show up.
// =============================================================================

const SERVICE = 'src/services/scp/investor/board-packet.ts';

beforeAll(async () => {
  await runMigrations();
  for (const [f, p] of [['f_mine', 'p_mine'], ['f_theirs', 'p_theirs']]) {
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
      [f, `c_${f}`, `${f}@example.com`]);
    await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
      [p, `Co ${p}`, f]);
  }
});
beforeEach(async () => { await query('DELETE FROM board_packets'); });

async function packet(productId: string): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO board_packets (id, product_id, quarter, period_start, period_end,
                                narrative_json, status)
     VALUES (?, ?, '2026-Q3', '2026-07-01', '2026-09-30', ?, 'draft')`,
    [id, productId, JSON.stringify({
      executive_summary: 'Runway is nine months and churn is rising.',
      key_metrics: [], wins: [], risks: [], asks: [], next_quarter_goals: [],
      agent_insights: [],
    })]);
  return id;
}

describe('a board packet belongs to one company', () => {
  it('its owner can read it', async () => {
    const id = await packet('p_mine');
    const data = await getBoardPacket(id, 'f_mine');
    expect(data?.packet.executive_summary).toMatch(/Runway is nine months/);
  });

  it('another founder cannot, and cannot tell it apart from one that does not exist', async () => {
    const id = await packet('p_theirs');
    expect(await getBoardPacket(id, 'f_mine'),
      'the most sensitive document Foundry produces about a company').toBeNull();
    expect(await getBoardPacket('a_packet_that_never_existed', 'f_mine')).toBeNull();
  });

  it('and the query scopes on the owning product', () => {
    const code = stripComments(readFileSync(SERVICE, 'utf8'), { lineComments: true });
    expect(code).toMatch(/JOIN products p ON p\.id = bp\.product_id/);
    expect(code, 'the unscoped read is what any id could reach')
      .not.toMatch(/SELECT \* FROM board_packets WHERE id=\?/);
  });
});

describe('the operator does not decide for a company', () => {
  it('the vocabulary still has no value for the operator', async () => {
    // If one ever appears, it is because somebody added an authority, and this
    // is where they will find out that it was noticed.
    const sql = ((await query(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='decisions'"))
      .rows[0] as Record<string, unknown>).sql as string;
    expect(sql).toMatch(/decided_by IN \('founder', 'second_self'\)/);
  });
});

describe('the floor under all of it', () => {
  it('admits nothing into its baseline beyond the two reasons ever allowed', () => {
    const baseline = readFileSync('docs/db/tenant-scope-baseline.txt', 'utf8')
      .split('\n').filter(Boolean);
    // BOTH of the ever-allowed entries are now routes that no longer exist. The
    // Stripe webhook went with Commercial Foundry; `GET /case-studies/:id` went
    // with `routes/public/landing.ts`, deleted on 13 September 2026 because
    // Private Foundry has no marketing surface of its own. Whether their lines
    // have been swept out of the baseline yet is that cleanup's business —
    // `check-tenant-scope.mjs` already reports the stale entry and says to
    // remove it — so neither is asserted PRESENT here any more.
    //
    // What must not happen either way is a THIRD entry: an exemption is not
    // something a route can take for itself. Note that once the file is swept
    // clean this check scans an empty list and proves nothing on its own; the
    // planted-route test below is what keeps the floor real.
    const EVER_ALLOWED = ['GET /case-studies/:id', 'POST /api/webhooks/stripe/:productId'];
    expect(baseline.filter((l) => !EVER_ALLOWED.includes(l))).toEqual([]);
  });

  it('catches a planted route that takes a company id and never says whose', () => {
    const planted = 'src/routes/api/_gate_fixture_tenant.ts';
    writeFileSync(planted, [
      "import { Hono } from 'hono';",
      "export const fixtureRoutes = new Hono();",
      "fixtureRoutes.get('/api/fixture/:id', async (c) => {",
      "  const id = c.req.param('id');",
      "  return c.json({ id });",
      '});',
      '',
    ].join('\n'));
    try {
      let failed = false;
      try {
        execFileSync('node', ['scripts/check-tenant-scope.mjs'], { encoding: 'utf8' });
      } catch (e) {
        failed = true;
        expect(String((e as { stderr?: string }).stderr ?? ''))
          .toMatch(/GET \/api\/fixture\/:id/);
      }
      expect(failed, 'a gate that cannot fail is decoration').toBe(true);
    } finally {
      unlinkSync(planted);
    }
  });

  it('is chained into the composite gate', () => {
    expect(readFileSync('package.json', 'utf8')).toMatch(/check-tenant-scope\.mjs/);
  });
});

describe('a column default is not an observation', () => {
  it('founder_health.engagement_trend no longer defaults to stable', async () => {
    const col = ((await query('PRAGMA table_info(founder_health)')).rows as unknown as
      Array<Record<string, unknown>>).find((c) => String(c.name) === 'engagement_trend')!;
    expect(col.dflt_value,
      'a row written for any other reason said a person was doing fine').toBeNull();
  });
});
