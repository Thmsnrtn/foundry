process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getIngestCredentials, mintIngestCredential,
} from '../../src/services/institution/ingest-credentials.js';

// =============================================================================
// AN INTEGRATION THAT APPEARS TO WORK AND DOES NOTHING IS THE WORST KIND.
//
// `last_used_at` is written when a credential AUTHENTICATES. Nothing was
// written when the request that followed was thrown away. So a rota system
// posting a slightly wrong field, or a helpdesk naming an effect that does not
// exist, looked exactly like a system that was working: recently used, and
// every call discarded.
//
// The founder connected that system on the understanding that Foundry would
// hear from it. Nobody goes looking at an integration that appears healthy.
//
// ONLY THE SHAPE IS RECORDED. A refused body is external data and may carry
// customer information; none of it reaches the record. The reason comes from a
// closed vocabulary the database enforces, so a future caller cannot put a
// convenient error string there either.
// =============================================================================

const P = 'rf_product';
const OWNER = 'rf_owner';
let app: Hono;
let secret: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'rf_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Fold Street Dance',?,'active')`, [P, OWNER]);

  const minted = await mintIngestCredential({
    productId: P, founderId: OWNER, label: 'rota system', purposes: ['company_report'],
  });
  secret = (minted as { secret: string }).secret;

  const { ingestRoutes } = await import('../../src/routes/ingest/index.js');
  app = new Hono();
  app.route('/', ingestRoutes);
});

const post = (body: unknown): Promise<Response> => app.request(
  `/ingest/company-report/${secret}`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('a connected system whose calls are being thrown away', () => {
  it('is counted, named to its owner, and cleared when it gets through', async () => {
    // Nothing wrong yet.
    expect((await getIngestCredentials(P))[0]).toMatchObject({ refusalCount: 0, lastRefusalReason: null });

    // The field name is very slightly wrong. Every call is refused.
    for (let i = 0; i < 3; i += 1) {
      const res = await post({ obligation_kind: 'recurring-work', what: 'Every class has a teacher' });
      expect(res.status).toBe(422);
    }
    const failing = (await getIngestCredentials(P))[0];
    expect(failing.refusalCount).toBe(3);
    expect(failing.lastRefusalReason).toBe('fields_invalid');
    expect(failing.lastRefusedAt).not.toBeNull();
    // Authentication still succeeded every time, which is exactly why
    // last_used_at could not answer this.
    expect(failing.lastUsedAt).not.toBeNull();

    // Fixed. The streak is cleared by the request that got through, not by the
    // one that authenticated.
    const ok = await post({ obligation_kind: 'recurring_work', what: 'Every class has a teacher' });
    expect(ok.status).toBe(200);
    expect((await getIngestCredentials(P))[0]).toMatchObject({
      refusalCount: 0, lastRefusalReason: null, lastRefusedAt: null });
  });

  it('records unreadable input as its own thing, and never the input itself', async () => {
    const res = await app.request(`/ingest/company-report/${secret}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{ this is not json, and it mentions jo@fieldstone.example',
    });
    expect(res.status).toBe(400);
    const cred = (await getIngestCredentials(P))[0];
    expect(cred.lastRefusalReason).toBe('body_unreadable');
    // Nothing of what they sent is anywhere in the record.
    const raw = JSON.stringify((await query(
      'SELECT * FROM ingest_credentials WHERE product_id=?', [P])).rows);
    expect(raw).not.toContain('fieldstone');
  });

  it('refuses a reason the vocabulary does not contain, in the database', async () => {
    const id = (await getIngestCredentials(P))[0].id;
    await expect(query(
      "UPDATE ingest_credentials SET last_refusal_reason='connection refused by upstream' WHERE id=?",
      [id])).rejects.toThrow();
  });
});
