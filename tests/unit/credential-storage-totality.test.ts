process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { registerIntegration } from '../../src/services/integrations/framework.js';

// =============================================================================
// Every credential column, and every writer of it.
//
// Reading the credential surfaces beside each other found the same shape three
// times over, each time with the weaker path live:
//
//   api_keys.key_hash          two authenticators, one without expiry/scopes
//   integrations.config_json   two forms, one storing secrets in the clear
//   integrations.credentials   two writers, one storing JSON in the clear
//
// The third is the one this file was written for. `connections.ts` has always
// written that column through `encryptToken`, and `mcp-client.ts` reads it back
// through `getPlaintextToken` — but `framework.ts:registerIntegration` wrote
// `JSON.stringify(credentials)` straight in, and it is mounted at
// POST /api/products/:id/integrations. So one column carried two encodings
// depending on which route the founder happened to use.
//
// The invariant §4 asks for, stated once: authentication establishes who and
// which tenant. It does not establish that the secret behind it was stored
// properly. Every column that holds secret material has exactly one encoding,
// and every writer uses it.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const P = 'cst_co';
const OWNER = 'cst_owner';

/** Columns that hold secret material, and the helper each writer must use.
 * Hashed columns are listed too: a hash is a storage decision like any other,
 * and the point of the list is that a column has ONE answer. */
const SECRET_COLUMNS: Record<string, { via: RegExp; why: string }> = {
  'integrations.credentials': {
    via: /encryptToken\(/,
    why: 'reversible — MCP and provider adapters must present the real value',
  },
  'integrations.credentials_json': {
    via: /encryptCredentialPayload\(/,
    why: 'reversible — sync adapters must present the real value',
  },
  'api_keys.key_hash': {
    via: /hashKey\(|createHash\('sha256'\)/,
    why: 'one-way — an API key is only ever verified, never replayed by us',
  },
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function executable(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','cst_c','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Co','${OWNER}')`, []);
});

describe('a secret column has one encoding', () => {
  it('and every module that writes one uses it', () => {
    const offenders: string[] = [];
    for (const [column, { via, why }] of Object.entries(SECRET_COLUMNS)) {
      const [table, field] = column.split('.');
      for (const file of walk(resolve(ROOT, 'src'))) {
        const source = executable(file);
        // A write to this table that names this column.
        const writes = new RegExp(
          `(INSERT INTO ${table}\\b[\\s\\S]{0,400}?\\b${field}\\b|UPDATE ${table}[\\s\\S]{0,300}?\\b${field}\\s*=)`, 'i');
        if (!writes.test(source)) continue;
        if (via.test(source)) continue;
        offenders.push(`${file.slice(ROOT.length + 1)} writes ${column} without ${String(via)} (${why})`);
      }
    }
    expect(offenders,
      'A module writes secret material without the encoding that column uses. One '
      + 'column, one answer — otherwise what is stored depends on which route the '
      + 'founder happened to take:\n' + offenders.join('\n')).toEqual([]);
  });

  it('stores nothing readable when a credential arrives over the mounted API', async () => {
    // The concrete case: POST /api/products/:id/integrations, behind founder
    // auth, wrote the JSON in the clear.
    await registerIntegration(P, OWNER, {
      provider: 'stripe' as never,
      credentials: { api_key: 'sk_live_shouldnotappear' },
      config: { account_id: 'acct_1' },
    });
    const row = (await query(
      'SELECT credentials, config FROM integrations WHERE product_id=?', [P],
    )).rows[0] as Record<string, unknown>;
    expect(String(row.credentials)).not.toContain('sk_live_shouldnotappear');
    expect(String(row.config ?? '')).not.toContain('sk_live_shouldnotappear');
  });

  it('and the value still comes back for the adapter that needs it', async () => {
    // Encrypting is only half the requirement. A secret nobody can read is a
    // broken integration, which is exactly what the OTHER half of this defect
    // family looked like — six adapters reading a column the founder's form
    // never wrote.
    const { getPlaintextToken } = await import('../../src/lib/crypto.js');
    const row = (await query(
      'SELECT credentials FROM integrations WHERE product_id=?', [P],
    )).rows[0] as Record<string, unknown>;
    const plaintext = getPlaintextToken(String(row.credentials));
    expect(JSON.parse(plaintext!)).toMatchObject({ api_key: 'sk_live_shouldnotappear' });

    // And the sync path must do that decryption itself. Asserting only that the
    // value round-trips through the helper proves the helper works, not that
    // the reader uses it — a mutation removing the call from `runSync` passed
    // an earlier version of this test.
    const framework = executable(resolve(ROOT, 'src/services/integrations/framework.ts'));
    const sync = framework.slice(framework.indexOf('export async function runSync'));
    expect(sync.slice(0, sync.indexOf('\n}')),
      'runSync must decrypt what registerIntegration encrypted')
      .toMatch(/getPlaintextToken\(/);
  });
});

describe('what a credential establishes', () => {
  it('is never taken from the request payload', () => {
    // §4's rule. A caller may present a credential; it may not declare what
    // that credential is for. Every purpose/scope check must read server-side
    // state, so these route files must never derive the thing being checked
    // from the body.
    const offenders: string[] = [];
    for (const rel of ['src/routes/ingest/index.ts', 'src/api/middleware/auth.ts', 'src/api/v1/mcp.ts']) {
      const source = executable(resolve(ROOT, rel));
      for (const m of source.matchAll(/(authenticateIngest|requireScope|holds)\(([^)]*)\)/g)) {
        if (/\bbody\.|\breq\.body|params\.(scope|purpose)/.test(m[2])) offenders.push(`${rel} → ${m[0]}`);
      }
    }
    expect(offenders,
      'A purpose or scope being checked was taken from the request:\n' + offenders.join('\n'))
      .toEqual([]);
  });

  it('is bound to a tenant by the credential, not by the caller', () => {
    // Every intake resolves productId from the credential it authenticated,
    // never from a field in the body — otherwise one company's token would
    // reach another company's data by asking nicely.
    const ingest = executable(resolve(ROOT, 'src/routes/ingest/index.ts'));
    // EVERY binding, not just the first. Checking that the right line exists
    // somewhere is satisfied while other routes do the wrong thing — a mutation
    // rewriting only the first one passed an earlier version of this.
    // EVERY assignment, not just the `const` ones and not just the first. The
    // metrics route declares `let productId` and assigns it in two branches, so
    // matching only `const productId =` would have skipped both — and a
    // mutation rewriting a single binding passed an earlier version of this.
    const bindings = [...ingest.matchAll(/\bproductId(?::\s*string)?\s*=\s*([^;]+);/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim())
      .filter((b) => b !== '');
    expect(bindings.length, 'the intakes must bind a tenant').toBeGreaterThanOrEqual(4);
    for (const binding of bindings) {
      const fromCredential =
        binding === 'identity.productId'
        || binding === 'scoped.productId'
        // The metrics route resolves the legacy product-wide token by lookup.
        // `resolveIngestProduct` is that lookup, named: it takes the TOKEN and
        // nothing else, and returns null for a company that no longer exists.
        || binding === 'resolved'
        || /productResult\.rows\[0\]/.test(binding);
      expect(fromCredential,
        `a tenant was bound from something other than the credential: ${binding}`).toBe(true);
    }
  });
});
