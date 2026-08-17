process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  connectIntegration, getIntegrationCredentials, isNonSecretConfigKey,
  markSecretsRotated, NON_SECRET_CONFIG_KEYS, quarantinedSecrets, splitIntegrationFields,
} from '../../src/services/integration/fabric.js';

// =============================================================================
// Two forms, one question, opposite answers — and the wrong one worked.
//
//   /integrations/:type/connect         split the form, encrypting everything
//                                       that was not one of five named config
//                                       keys into `credentials_json`.
//   /agents/integrations/:name/connect  put EVERY submitted field into
//                                       `config_json` in the clear — api keys,
//                                       bot tokens and auth tokens included.
//
// And all four sync adapters — Slack, Sentry, PostHog, Linear — read their
// credential from `config_json`. So the path that stored provider secrets in
// plaintext was the path that functioned, and the path that encrypted them
// correctly produced integrations that silently never synced: the adapter
// looked in the wrong place and reported "missing config field" forever.
//
// Slack was the clearest case. `IntegrationRecord` has no credentials field at
// all, so `integration.config_json.bot_token` could only ever be `undefined`
// for anything configured through the encrypting form — sync, notifications and
// agent briefings alike.
//
// The same shape as the two API-key authenticators earlier this session: two
// implementations of one thing, disagreeing, with the weaker one live.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const P = 'ics_co';
const OWNER = 'ics_owner';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','ics_c','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Co','${OWNER}')`, []);
});

describe('what may be stored in the clear', () => {
  it('treats an unclassified field as a secret, not as config', () => {
    // The fail-closed direction. A new provider whose config key is missing
    // from the list gets encrypted unnecessarily, which costs nothing; the
    // opposite mistake writes somebody's API key to a plaintext column.
    const { config, credentials } = splitIntegrationFields({
      host: 'https://eu.posthog.com',
      team_id: 'T123',
      api_key: 'phc_secret',
      some_field_nobody_classified: 'probably-a-secret',
    });
    expect(config).toEqual({ host: 'https://eu.posthog.com', team_id: 'T123' });
    expect(credentials).toEqual({
      api_key: 'phc_secret', some_field_nobody_classified: 'probably-a-secret',
    });
  });

  it('never classifies a credential-shaped name as config', () => {
    for (const key of ['api_key', 'auth_token', 'bot_token', 'access_token', 'secret', 'password']) {
      expect(isNonSecretConfigKey(key), `${key} must not be storable in the clear`).toBe(false);
    }
  });

  it('drops empty fields rather than storing blanks as credentials', () => {
    const { credentials } = splitIntegrationFields({ api_key: '', auth_token: undefined });
    expect(credentials).toEqual({});
  });
});

describe('an adapter finds the credential the founder entered', () => {
  it('reads it from the encrypted store', async () => {
    await connectIntegration(P, 'slack', {
      credentials_json: JSON.stringify({ bot_token: 'xoxb-real-token' }),
      config_json: { channel: 'general' },
    });

    // Encrypted at rest — the raw column must not contain the token.
    const row = (await query(
      'SELECT credentials_json,config_json FROM integrations WHERE product_id=? AND name=?',
      [P, 'slack'])).rows[0] as Record<string, unknown>;
    expect(String(row.credentials_json)).not.toContain('xoxb-real-token');
    expect(String(row.config_json)).not.toContain('xoxb-real-token');

    // And the adapter can still get at it.
    expect(await getIntegrationCredentials(P, 'slack'))
      .toMatchObject({ bot_token: 'xoxb-real-token' });
  });

  it('refuses a secret written to the plaintext column at all, now', async () => {
    // Migration 140 closed this at the schema. A guard in a service is a rule
    // the next service may not know about; a guard on the column is a rule
    // about the column.
    await expect(connectIntegration(P, 'posthog', {
      config_json: { api_key: 'phc_should_be_refused', host: 'https://x' },
    })).rejects.toThrow(/secret_in_plaintext/);
  });

  it('does not read the plaintext column at all any more', async () => {
    // Stated structurally on purpose. With migration 140's two triggers in
    // place, a row carrying a plaintext secret can no longer be CONSTRUCTED —
    // so there is no data fixture that can distinguish "fallback removed" from
    // "fallback present but nothing to find". The honest assertion is that the
    // query does not reach for the column.
    //
    // While the fallback existed, an adapter would happily authenticate using a
    // value from a plaintext column. That needed to become impossible rather
    // than merely deprecated, and impossible is what the trigger makes it.
    const source = readFileSync(
      resolve(ROOT, 'src/services/integration/fabric.ts'), 'utf8');
    const fn = source.slice(source.indexOf('export async function getIntegrationCredentials'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body, 'the credential read must not consult config_json').not.toContain('config_json');
    expect(body).toContain('credentials_json');
  });

  it('returns nothing for a company that has not connected it', async () => {
    expect(await getIntegrationCredentials('ics_nobody', 'slack')).toEqual({});
  });
});

describe('no adapter reads a credential from the plaintext blob', () => {
  it('is true of every sync adapter, structurally', () => {
    // The regression this prevents is the original defect: an adapter that
    // reaches into `config_json` for a secret both fails on encrypted installs
    // AND rewards storing it in the clear.
    const dir = resolve(ROOT, 'src/services/integration');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(resolve(dir, file), 'utf8')
        .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
        .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
      for (const m of source.matchAll(/config_json\.(\w+)/g)) {
        if (!isNonSecretConfigKey(m[1])) offenders.push(`${file} → config_json.${m[1]}`);
      }
    }
    expect(offenders,
      'An adapter reads a credential-shaped key out of the plaintext config blob:\n'
      + offenders.join('\n')).toEqual([]);
  });

  it('is true of both founder-facing connect forms', () => {
    // Both now route through the same split rather than each deciding.
    for (const rel of [
      'src/routes/dashboard/integrations.ts',
      'src/routes/dashboard/agents-integrations.ts',
    ]) {
      const source = readFileSync(resolve(ROOT, rel), 'utf8');
      expect(source, `${rel} must use the shared split`).toContain('splitIntegrationFields');
    }
    // And the old literal list must not come back as a second opinion.
    expect(readFileSync(resolve(ROOT, 'src/routes/dashboard/integrations.ts'), 'utf8'))
      .not.toContain("['activation_event', 'active_user_event', 'team_id', 'host', 'account_id']");
  });
});

// =============================================================================
// Migration 140: the plaintext column is emptied and then closed.
//
// A secret that has been in a plaintext column must be ROTATED, not relocated.
// The migration therefore records the KEY and discards the value — a quarantine
// that stores the secret is the plaintext column with a more reassuring name —
// and the application refuses to authenticate with anything that is not in the
// encrypted store.
//
// The migration deliberately does not encrypt what it moves: SQLite has no
// access to the application's encryption key, and a migration that pretended to
// encrypt would produce a column that LOOKS canonical and holds plaintext.
// =============================================================================

describe('secrets that were already in the clear', () => {
  it('are named for rotation and no longer usable', async () => {
    // A row as it would have existed before the migration ran.
    await query(
      `INSERT INTO integrations (id,product_id,name,type,status,config_json)
       VALUES ('ics_pre',?,'preexisting','inbound','active','{}')`, [P]);
    await query(
      `INSERT INTO integration_secret_quarantine
         (id,product_id,integration_id,integration_name,secret_key)
       VALUES ('q1',?,'ics_pre','preexisting','api_key')`, [P]);

    const quarantined = await quarantinedSecrets(P);
    expect(quarantined.map((q) => `${q.integration}:${q.key}`)).toContain('preexisting:api_key');
    // The value is deliberately absent — there is nothing here to leak.
    expect(JSON.stringify(quarantined)).not.toMatch(/phc_|xoxb-|sk_/);

    // And it cannot be used to authenticate anything.
    expect(await getIntegrationCredentials(P, 'preexisting')).toEqual({});
  });

  it('are settled when the founder re-enters the credential', async () => {
    // Re-entering IS the rotation: the new value arrives encrypted and the old
    // one is already gone. Nothing here can rotate on the founder's behalf —
    // the new value has to come from the provider.
    expect(await markSecretsRotated(P, 'preexisting')).toBe(1);
    expect((await quarantinedSecrets(P)).map((q) => q.key)).not.toContain('api_key');
    expect((await quarantinedSecrets(P, true)).find((q) => q.key === 'api_key')?.rotated).toBe(true);
  });

  it('are settled automatically by the ordinary connect path', async () => {
    await query(
      `INSERT INTO integrations (id,product_id,name,type,status,config_json)
       VALUES ('ics_pre2',?,'reconnected','inbound','active','{}')`, [P]);
    await query(
      `INSERT INTO integration_secret_quarantine
         (id,product_id,integration_id,integration_name,secret_key)
       VALUES ('q2',?,'ics_pre2','reconnected','auth_token')`, [P]);
    expect((await quarantinedSecrets(P)).map((q) => q.key)).toContain('auth_token');

    await connectIntegration(P, 'reconnected', {
      credentials_json: JSON.stringify({ auth_token: 'fresh-value' }),
      config_json: { host: 'https://x' },
    });
    expect((await quarantinedSecrets(P)).map((q) => q.key)).not.toContain('auth_token');
  });

  it('keeps one company\'s quarantine out of another\'s', async () => {
    expect(await quarantinedSecrets('ics_nobody')).toEqual([]);
  });
});

describe('the non-secret vocabulary is closed in both places', () => {
  it('the service and migration 140 name exactly the same keys', () => {
    // Drift here is the defect in slow motion: SQL would refuse a key the
    // service happily writes, or accept one the service treats as secret.
    const sql = readFileSync(
      resolve(ROOT, 'src/db/migrations/140_integration_secret_canonicalization.sql'), 'utf8')
      .replace(/--[^\n]*/g, '');
    const lists = [...sql.matchAll(/NOT IN \(([\s\S]*?)\)/g)]
      .map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort());
    expect(lists.length, 'the migration must name the vocabulary more than once').toBeGreaterThan(2);

    const expected = [...NON_SECRET_CONFIG_KEYS].sort();
    for (const list of lists) {
      expect(list, 'every list in migration 140 must match the service exactly').toEqual(expected);
    }
  });
});
