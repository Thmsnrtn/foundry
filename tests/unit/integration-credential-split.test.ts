process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  connectIntegration, getIntegrationCredentials, isNonSecretConfigKey,
  plaintextCredentialKeys, splitIntegrationFields,
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

  it('still finds one stored in the clear before the split was enforced', async () => {
    // Compatibility, not endorsement: an install configured through the old
    // path keeps working rather than breaking silently a second time.
    await connectIntegration(P, 'posthog', { config_json: { api_key: 'phc_legacy', host: 'https://x' } });
    expect(await getIntegrationCredentials(P, 'posthog')).toMatchObject({ api_key: 'phc_legacy' });
  });

  it('names the plaintext secrets an operator ought to rotate', async () => {
    const exposed = await plaintextCredentialKeys(P);
    const posthog = exposed.find((e) => e.integration === 'posthog');
    expect(posthog?.keys).toContain('api_key');
    // A genuine config value is not a secret and must not be reported as one.
    expect(posthog?.keys).not.toContain('host');
    expect(exposed.find((e) => e.integration === 'slack')).toBeUndefined();
  });

  it('prefers the encrypted value when both exist', async () => {
    await connectIntegration(P, 'linear', { config_json: { api_key: 'stale-plaintext' } });
    await connectIntegration(P, 'linear', {
      credentials_json: JSON.stringify({ api_key: 'current-encrypted' }),
      config_json: { api_key: 'stale-plaintext', team_id: 'T1' },
    });
    expect((await getIntegrationCredentials(P, 'linear')).api_key).toBe('current-encrypted');
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
