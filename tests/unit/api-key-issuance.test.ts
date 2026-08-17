process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  API_SCOPES, getApiKeys, issueApiKey, revokeIssuedApiKey,
} from '../../src/services/api/api-key-issuance.js';
import { validateApiKey } from '../../src/services/rbac/permissions.js';

// =============================================================================
// The public API becomes reachable — owner decision, on evidence.
//
// `/api/v1` and the Fathom/Fireflies transcript webhooks were mounted,
// authenticated, and unusable by anyone: both `createApiKey` helpers had zero
// callers, and `POST /api/v1/settings/api-keys` — advertised on the revenue
// dashboard — did not exist and could not have, because that namespace is
// behind API-key authentication.
//
// Turning it on meant fixing what would otherwise have shipped with it:
//
//   • Three write routes sat behind `agents:read`. A read key could create an
//     experiment, post results, conclude it, and write a metric snapshot.
//   • The MCP transport had NO scope check at all. Scopes were resolved by the
//     middleware and then, on that one surface, never consulted — so any key
//     could resolve a decision and record a new one.
//
// Both are the same shape as everything else found this session: a credential
// doing more than its name says.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const P = 'ak_co';
const OTHER = 'ak_other';
const OWNER = 'ak_owner';
const OTHER_OWNER = 'ak_owner2';

beforeAll(async () => {
  await runMigrations();
  await query(
    `INSERT INTO founders (id,clerk_user_id,email) VALUES
      ('${OWNER}','ak_c1','o@example.com'),('${OTHER_OWNER}','ak_c2','x@example.com')`, []);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?),(?,?,?)',
    [P, 'Barrowfield Groundworks', OWNER, OTHER, 'Somebody Else', OTHER_OWNER]);
});

describe('issuing a key', () => {
  it('authenticates for exactly the scopes the owner ticked', async () => {
    const issued = await issueApiKey({
      productId: P, founderId: OWNER, label: 'Reporting job',
      scopes: ['agents:read', 'metrics:write'], days: 30,
    });
    expect('key' in issued).toBe(true);
    const key = issued as { id: string; key: string; scopes: string[]; expiresAt: string };
    expect(key.key.startsWith('fnd_')).toBe(true);
    expect(key.scopes).toEqual(['agents:read', 'metrics:write']);

    const validated = await validateApiKey(key.key);
    expect(validated).toMatchObject({ productId: P, scopes: ['agents:read', 'metrics:write'] });

    // Issuing is a founder assertion, with provenance, like every other thing
    // the owner tells Foundry.
    const evidence = (await query(
      `SELECT payload_json FROM signal_events
        WHERE product_id=? AND event_type='founder_issued_api_key'`, [P],
    )).rows[0] as Record<string, unknown>;
    expect(JSON.parse(String(evidence.payload_json))).toMatchObject({
      founder_id: OWNER, label: 'Reporting job', scopes: ['agents:read', 'metrics:write'],
    });
  });

  it('stores a hash and never the key', async () => {
    const issued = await issueApiKey({
      productId: P, founderId: OWNER, label: 'Hashed', scopes: ['agents:read'],
    }) as { id: string; key: string };

    const row = (await query(
      'SELECT key_hash,key_prefix FROM api_keys WHERE id=?', [issued.id],
    )).rows[0] as Record<string, unknown>;
    expect(String(row.key_hash)).not.toContain(issued.key);
    expect(String(row.key_hash)).toMatch(/^[0-9a-f]{64}$/);
    // The prefix is for recognising a key in a list, and is not enough to use.
    expect(await validateApiKey(String(row.key_prefix))).toBeNull();

    // Nothing in the listing can reconstruct it.
    const listed = await getApiKeys(P);
    expect(JSON.stringify(listed)).not.toContain(issued.key);
  });

  it('expires, and an expired key stops working', async () => {
    const issued = await issueApiKey({
      productId: P, founderId: OWNER, label: 'Short-lived', scopes: ['agents:read'], days: 1,
    }) as { id: string; key: string };
    expect(await validateApiKey(issued.key)).not.toBeNull();

    await query("UPDATE api_keys SET expires_at=datetime('now','-1 hour') WHERE id=?", [issued.id]);
    expect(await validateApiKey(issued.key),
      'an expired key must stop authenticating').toBeNull();
  });

  it('stops the moment the owner withdraws it', async () => {
    const issued = await issueApiKey({
      productId: P, founderId: OWNER, label: 'Withdrawn', scopes: ['agents:read'],
    }) as { id: string; key: string };

    expect(await revokeIssuedApiKey({
      productId: P, founderId: OTHER_OWNER, keyId: issued.id }), 'not the owner').toBe(false);
    expect(await validateApiKey(issued.key)).not.toBeNull();

    expect(await revokeIssuedApiKey({ productId: P, founderId: OWNER, keyId: issued.id })).toBe(true);
    expect(await validateApiKey(issued.key)).toBeNull();
  });

  it('refuses a scope no route honours, an empty set, and a foreign product', async () => {
    expect(await issueApiKey({
      productId: P, founderId: OWNER, label: 'Greedy', scopes: ['*'],
    })).toEqual({ refused: 'scope_unknown' });
    expect(await issueApiKey({
      productId: P, founderId: OWNER, label: 'Greedy', scopes: ['admin:everything'],
    })).toEqual({ refused: 'scope_unknown' });
    expect(await issueApiKey({
      productId: P, founderId: OWNER, label: 'Empty', scopes: [],
    })).toEqual({ refused: 'scopes_required' });
    expect(await issueApiKey({
      productId: OTHER, founderId: OWNER, label: 'Sneak', scopes: ['agents:read'],
    })).toEqual({ refused: 'not_owned' });
  });

  it('cannot outlive a year, however long is asked for', async () => {
    const issued = await issueApiKey({
      productId: P, founderId: OWNER, label: 'Forever', scopes: ['agents:read'], days: 99_999,
    }) as { expiresAt: string };
    const years = (new Date(issued.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(years).toBeLessThanOrEqual(366);
  });

  it('grants nothing institutional', async () => {
    // A key is a bounded delegation of one product's API surface. It is not
    // authority: it cannot create a responsibility, widen a consent, or reach
    // anything Foundry sends on the company's behalf.
    expect((await query(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 0 });
    expect((await query(
      'SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 0 });
  });
});

describe('the scope vocabulary is exactly what the routes enforce', () => {
  /** Every scope string any v1 route actually demands. */
  function enforcedScopes(): string[] {
    const files = readdirSync(resolve(ROOT, 'src/api/v1')).filter((f) => f.endsWith('.ts'));
    const found = new Set<string>();
    for (const f of files) {
      const source = readFileSync(resolve(ROOT, 'src/api/v1', f), 'utf8');
      for (const m of source.matchAll(/requireScope\('([^']+)'\)/g)) found.add(m[1]);
      // The MCP transport checks per tool rather than per route.
      for (const m of source.matchAll(/'(agents:(?:read|write))'/g)) found.add(m[1]);
    }
    return [...found].sort();
  }

  it('offers no scope that no route honours, and demands none a founder cannot grant', () => {
    // Bidirectional on purpose. One direction alone lets a vocabulary rot into
    // a menu of things that do nothing, or a route demand a permission that
    // cannot be issued — which is how `/api/v1` became unreachable in the first
    // place.
    expect(enforcedScopes()).toEqual([...API_SCOPES].sort());
  });

  it('no write route sits behind a read scope', () => {
    // Three of them did: POST /experiments, PUT /:id/results,
    // POST /:id/conclude, and POST /metrics/snapshots.
    const offenders: string[] = [];
    for (const f of readdirSync(resolve(ROOT, 'src/api/v1')).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(resolve(ROOT, 'src/api/v1', f), 'utf8');
      for (const [i, line] of source.split('\n').entries()) {
        const m = /\.(post|put|patch|delete)\('[^']*',\s*requireScope\('([^']+)'\)/.exec(line);
        if (m && /:read$/.test(m[2])) offenders.push(`src/api/v1/${f}:${i + 1} → ${m[1]} behind ${m[2]}`);
      }
    }
    expect(offenders,
      'A mutating route is gated by a read scope:\n' + offenders.join('\n')).toEqual([]);
  });

  it('every mounted v1 route group demands a scope', () => {
    // `mcp.ts` did not, for its whole life. It is the exception now only in
    // MECHANISM — per tool rather than per route — and must still be checking.
    const mcp = readFileSync(resolve(ROOT, 'src/api/v1/mcp.ts'), 'utf8');
    expect(mcp, 'the MCP transport must consult the resolved scopes').toContain("c.get('scopes')");
    expect(mcp, 'writing tools must need a write scope').toMatch(/WRITING_TOOLS/);
    expect(mcp, 'an unknown tool must not be assumed harmless')
      .toMatch(/return 'agents:write';/);

    for (const f of readdirSync(resolve(ROOT, 'src/api/v1'))
      .filter((f) => f.endsWith('.ts') && !['index.ts', 'mcp.ts'].includes(f))) {
      const source = readFileSync(resolve(ROOT, 'src/api/v1', f), 'utf8');
      // Anchored to the start of a line so `c.get('productId')` is not counted
      // as a route — it is a context read, and treating it as a route made this
      // gate demand five scopes that nothing needed.
      const routes = [...source.matchAll(/^\w+\.(get|post|put|patch|delete)\('/gm)].length;
      const guarded = [...source.matchAll(/requireScope\('/g)].length;
      expect(guarded, `every route in ${f} must demand a scope`).toBe(routes);
    }
  });
});
