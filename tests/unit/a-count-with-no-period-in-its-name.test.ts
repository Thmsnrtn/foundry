process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A COUNT WITH NO PERIOD IN ITS NAME, RECORDED AS A WEEK.
//
// The public ingest door mapped `signups` to `signups_7d` and `support_volume`
// to `support_volume_7d`. A caller POSTing `{"signups": 400}` — the obvious
// name, the one every analytics tool uses, and a number that for most companies
// means "since we started" — had it recorded as SIGNUPS IN THE LAST SEVEN DAYS.
// Nothing said so: not an error, not a warning, not a different column. The
// marketing sweep then carried it as a graced `signups_7d` premise and the
// dashboard drew it under a label naming a week.
//
// This is the `mrr` level-vs-movement defect from a few lines above it in the
// same file, smaller. The settings page already states the principle in the
// founder's own words — "sending the total under the wrong name is not [fine],
// which is why they are spelled out here" — and its example payload uses
// `signups_7d`. The alias was the one door that let the unspelled name in.
//
// There is no correct period to guess, so the door refuses and names the field
// to send instead. Routing it to `custom_metrics` would have been the quieter
// answer and the worse one: the real number sitting unread beside a fabricated
// weekly one.
// =============================================================================

const P = 'p_ingest_period';
const TOKEN = 'ingest_token_period_test';

let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ip','c_ip','ip@example.com')");
  await query(
    "INSERT INTO products (id, name, owner_id, status, ingest_token) VALUES (?,'Acme','f_ip','active',?)",
    [P, TOKEN],
  );
  const { ingestRoutes } = await import('../../src/routes/ingest/index.js');
  app = new Hono();
  app.route('/', ingestRoutes);
});

beforeEach(async () => { await query('DELETE FROM metric_snapshots WHERE product_id = ?', [P]); });

const post = (body: unknown): Promise<Response> => app.request(`/ingest/${TOKEN}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

async function snapshot(): Promise<Record<string, unknown> | undefined> {
  const r = await query(
    'SELECT signups_7d, support_volume_7d, custom_metrics FROM metric_snapshots WHERE product_id = ?',
    [P]);
  return r.rows[0] as unknown as Record<string, unknown> | undefined;
}

describe('a field name has to say what period it covers', () => {
  it('refuses a bare signups and says what to send instead', async () => {
    const res = await post({ signups: 400 });
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string; fields: Array<{ sent: string; send_instead: string }> };
    expect(body.error).toMatch(/period/i);
    expect(body.fields).toEqual([{ sent: 'signups', send_instead: 'signups_7d' }]);
  });

  it('refuses a bare support_volume the same way', async () => {
    const res = await post({ support_volume: 90 });
    expect(res.status).toBe(422);
    const body = await res.json() as { fields: Array<{ sent: string; send_instead: string }> };
    expect(body.fields).toEqual([{ sent: 'support_volume', send_instead: 'support_volume_7d' }]);
  });

  it('writes nothing at all when it refuses — not the column, not custom_metrics', async () => {
    await post({ signups: 400, mrr: 52000 });
    expect(await snapshot()).toBeUndefined();
  });

  it('accepts the name that states its period, and records it there', async () => {
    const res = await post({ signups_7d: 23, support_volume_7d: 9 });
    expect(res.status).toBe(200);
    const row = await snapshot();
    expect(Number(row!.signups_7d)).toBe(23);
    expect(Number(row!.support_volume_7d)).toBe(9);
  });

  it('an unrelated unknown field is still a custom metric, not a refusal', async () => {
    // The refusal is for names that LOOK like a known metric and are missing
    // their period. A genuinely new name is a custom metric, as it always was.
    const res = await post({ trial_starts_today: 4 });
    expect(res.status).toBe(200);
    const row = await snapshot();
    expect(String(row!.custom_metrics)).toContain('trial_starts_today');
  });

  it('the accepted-fields list a caller is shown names no period-less count', async () => {
    const res = await post({ nothing_recognisable_here: true, and_another: 1 });
    const body = await res.json() as { accepted_fields?: string[] };
    // Unknown scalars become custom metrics, so this body is accepted; the
    // list is asserted from the source of truth instead.
    void body;
    const src = readFileSync('src/routes/ingest/index.ts', 'utf8');
    const map = src.slice(src.indexOf('const FIELD_MAP'), src.indexOf('const AMBIGUOUS_ALIASES'));
    expect(map).not.toMatch(/^\s*signups:\s/m);
    expect(map).not.toMatch(/^\s*support_volume:\s/m);
    expect(map).toMatch(/signups_7d:\s*'signups_7d'/);
  });
});
